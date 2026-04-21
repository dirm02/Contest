#!/usr/bin/env node
/**
 * batch-prototype.js — Validate the Anthropic Message Batches API end-to-end
 * before migrating 08-llm-golden-records.js to batch mode.
 *
 * Flow:
 *   1. Pull a small stratified sample of already-reviewed pairs from
 *      general.entity_merge_candidates (so we have ground-truth Sonnet verdicts
 *      from the live run to compare against).
 *   2. Re-build the exact same prompt 08 would have sent.
 *   3. Submit them as a single batch via client.messages.batches.create().
 *   4. Poll until processing_status == "ended".
 *   5. Stream results; parse each succeeded message as our JSON verdict.
 *   6. Compare batch verdict to live-run verdict; print agreement + timing.
 *
 * READ-ONLY: does not modify entity_merge_candidates.
 *
 * Usage:
 *   node scripts/tools/batch-prototype.js                       # default 20 pairs
 *   node scripts/tools/batch-prototype.js --sample 100
 *   node scripts/tools/batch-prototype.js --poll-ms 15000 --timeout-ms 7200000
 */
const path = require('path');
const fs = require('fs');

// Env loading pattern matches lib/llm-review.js — .env.public then .env.
const publicEnv = path.join(__dirname, '..', '..', '.env.public');
if (fs.existsSync(publicEnv)) require('dotenv').config({ path: publicEnv });
const adminEnv = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(adminEnv)) require('dotenv').config({ path: adminEnv, override: true });

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../../lib/db');

function parseArgs() {
  const opts = {
    sample: 20,
    model: 'claude-sonnet-4-6',
    maxTokens: 2000,
    pollMs: 10000,
    timeoutMs: 7_200_000,  // 2h default — batch can take up to 24h but our sample is small
    out: null,
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i+1]) opts.sample = parseInt(args[++i], 10);
    else if (args[i] === '--model' && args[i+1]) opts.model = args[++i];
    else if (args[i] === '--max-tokens' && args[i+1]) opts.maxTokens = parseInt(args[++i], 10);
    else if (args[i] === '--poll-ms' && args[i+1]) opts.pollMs = parseInt(args[++i], 10);
    else if (args[i] === '--timeout-ms' && args[i+1]) opts.timeoutMs = parseInt(args[++i], 10);
    else if (args[i] === '--out' && args[i+1]) opts.out = args[++i];
  }
  if (!opts.out) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    opts.out = path.join(__dirname, `batch-prototype-${ts}.jsonl`);
  }
  return opts;
}

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
//  Entity loader + prompt builder — same logic as haiku-vs-sonnet.js
//  and 08-llm-golden-records.js. Keep them in lockstep.
// ═══════════════════════════════════════════════════════════════

async function loadEntityContext(entityId) {
  const r = await pool.query(`
    SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
           e.bn_variants, e.alternate_names, e.dataset_sources, e.source_count,
           e.metadata, e.merged_into,
           (SELECT jsonb_agg(jsonb_build_object(
              'name', esl.source_name, 'schema', esl.source_schema, 'table', esl.source_table,
              'method', esl.match_method
            ))
            FROM (
              SELECT DISTINCT ON (source_name)
                     source_name, source_schema, source_table, match_method
              FROM general.entity_source_links
              WHERE entity_id = e.id
              ORDER BY source_name, id
              LIMIT 30
            ) esl
           ) AS link_samples,
           (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
    FROM general.entities e
    WHERE e.id = $1
  `, [entityId]);
  return r.rows[0] || null;
}

function buildPrompt(a, b, similarity) {
  const fmt = (e) => {
    const samples = (e.link_samples || []).slice(0, 30).map(s =>
      `      "${(s.name || '').slice(0, 120)}" [${s.schema}.${s.table}] (${s.method})`
    ).join('\n');
    const altNames = (e.alternate_names || []).join(' | ') || 'none';
    return [
      `  id: ${e.id}`,
      `  canonical_name: "${e.canonical_name}"`,
      `  norm_name: "${e.norm_canonical || ''}"`,
      `  entity_type: ${e.entity_type || 'unknown'}`,
      `  BN root: ${e.bn_root || 'none'}`,
      `  BN variants: ${(e.bn_variants || []).join(', ') || 'none'}`,
      `  alternate_names: ${altNames}`,
      `  datasets: ${(e.dataset_sources || []).join(', ')}`,
      `  source_links: ${e.link_count}`,
      `  samples:\n${samples || '    (none)'}`,
    ].join('\n');
  };

  return `You are an entity resolution expert for Canadian government open data (CRA charities, FED grants, Alberta grants/contracts). Decide whether two candidate entities are the SAME legal organisation, RELATED (parent/subsidiary/affiliate), or DIFFERENT. When SAME, ALSO author the final golden record fields.

## Entity A
${fmt(a)}

## Entity B
${fmt(b)}

## Similarity hint
Keyword-overlap similarity: ${(similarity * 100).toFixed(0)}%

## Rules
- Same BN 9-digit root => SAME (different RR/RC/RT account suffixes don't matter).
- "TRADE NAME OF", "O/A", "DBA" phrasing => SAME (the underlying legal entity is one).
- French/English bilingual names (separated by "|" or parentheses) => SAME.
- Different cities / different BN roots / different categories => usually DIFFERENT even if names look alike.
- Parent vs. subsidiary, foundation vs. holding corp, regional chapter vs. national => RELATED.
- When in doubt between SAME and RELATED, prefer RELATED.

## Golden record authoring (required when verdict=SAME)
- canonical_name: Pick or compose the cleanest official-looking name. Prefer the non-abbreviated English legal name. Title Case (not ALL CAPS). Strip trailing punctuation.
- entity_type: one of charity | non_profit | company | government | grant_recipient | individual | unknown
- aliases: EXHAUSTIVE deduplicated list of every meaningful name variant across A and B, including: legal name variants, French/English translations, common abbreviations (e.g. "U of A"), former names, trade names, punctuation/spelling variants. Preserve original casing from the source. Exclude trivial casing/whitespace-only duplicates. No hard upper bound — output every variant worth preserving (typically 3–50 for large entities).
- survivor: "A" or "B" — the id whose row should absorb the other. Prefer the one with: more source_links, has BN, appears in CRA, lower id on ties.
- reasoning: <= 240 chars, why SAME/RELATED/DIFFERENT.

Respond with STRICT JSON ONLY (no markdown, no commentary):
{
  "verdict": "SAME" | "RELATED" | "DIFFERENT",
  "confidence": 0.0-1.0,
  "canonical_name": "string (required if SAME, else null)",
  "entity_type": "string (required if SAME, else null)",
  "aliases": ["string", ...],
  "survivor": "A" | "B" | null,
  "reasoning": "brief explanation"
}`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```\w*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════════════
//  Stratified sample
// ═══════════════════════════════════════════════════════════════

async function fetchSample(n) {
  const targets = [
    { verdict: 'SAME',      cap: Math.ceil(n * 0.40) },
    { verdict: 'DIFFERENT', cap: Math.ceil(n * 0.40) },
    { verdict: 'RELATED',   cap: Math.ceil(n * 0.20) },
  ];
  const out = [];
  for (const t of targets) {
    const r = await pool.query(`
      SELECT id, entity_id_a, entity_id_b, candidate_method, similarity_score,
             llm_verdict, llm_confidence, llm_provider, llm_tokens_in, llm_tokens_out
      FROM general.entity_merge_candidates
      WHERE llm_verdict = $1
        AND status IN ('same','related','different')
      ORDER BY random()
      LIMIT $2
    `, [t.verdict, t.cap]);
    out.push(...r.rows);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();

  if (!process.env.ANTHROPIC_API_KEY) {
    log('FATAL: ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  log(`sample=${opts.sample} model=${opts.model} poll=${opts.pollMs}ms timeout=${opts.timeoutMs}ms`);

  // ── Step 1. Sample + context load ──────────────────────────
  log('Fetching stratified sample from entity_merge_candidates...');
  const sample = await fetchSample(opts.sample);
  log(`Got ${sample.length} reviewed pairs (requested ${opts.sample})`);
  if (sample.length === 0) { log('No sample rows available.'); await pool.end(); process.exit(1); }

  log('Loading entity context + building prompts...');
  const ctxT0 = Date.now();
  const sampleByCustomId = new Map();
  const requests = [];
  for (const row of sample) {
    const [a, b] = await Promise.all([
      loadEntityContext(row.entity_id_a),
      loadEntityContext(row.entity_id_b),
    ]);
    if (!a || !b) { log(`  skip candidate ${row.id} — entity not found`); continue; }
    const prompt = buildPrompt(a, b, row.similarity_score || 0);
    const customId = `cand-${row.id}`;
    sampleByCustomId.set(customId, { row, a_name: a.canonical_name, b_name: b.canonical_name });
    requests.push({
      custom_id: customId,
      params: {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
    });
  }
  log(`Prepared ${requests.length} batch requests in ${((Date.now()-ctxT0)/1000).toFixed(1)}s`);

  // ── Step 2. Submit batch ───────────────────────────────────
  log('Submitting batch to Anthropic Messages Batches API...');
  const submitT0 = Date.now();
  let batch;
  try {
    batch = await client.messages.batches.create({ requests });
  } catch (err) {
    log(`FATAL batch create failed: ${err.message}`);
    if (err.response) log(`  response: ${JSON.stringify(err.response).slice(0, 500)}`);
    await pool.end(); process.exit(1);
  }
  log(`Batch created: id=${batch.id} status=${batch.processing_status}`);
  log(`  processing counts: ${JSON.stringify(batch.request_counts)}`);

  // ── Step 3. Poll ───────────────────────────────────────────
  const pollStart = Date.now();
  let lastCounts = '';
  let finalBatch = batch;
  while (true) {
    if (Date.now() - pollStart > opts.timeoutMs) {
      log(`TIMEOUT after ${((Date.now()-pollStart)/1000).toFixed(0)}s — aborting. batch id=${batch.id}`);
      await pool.end(); process.exit(2);
    }
    const status = await client.messages.batches.retrieve(batch.id);
    const countsStr = JSON.stringify(status.request_counts);
    if (countsStr !== lastCounts) {
      log(`  poll: status=${status.processing_status} counts=${countsStr}`);
      lastCounts = countsStr;
    }
    if (status.processing_status === 'ended') { finalBatch = status; break; }
    if (status.processing_status === 'canceled' || status.processing_status === 'expired') {
      log(`FATAL batch ${status.processing_status}: ${JSON.stringify(status).slice(0, 500)}`);
      await pool.end(); process.exit(1);
    }
    await sleep(opts.pollMs);
  }
  const batchElapsedS = ((Date.now()-submitT0)/1000).toFixed(1);
  log(`Batch ended after ${batchElapsedS}s — fetching results stream...`);

  // ── Step 4. Stream results ─────────────────────────────────
  const writer = fs.createWriteStream(opts.out, { flags: 'w' });
  const outcomes = [];
  const resultIter = await client.messages.batches.results(batch.id);
  for await (const item of resultIter) {
    const customId = item.custom_id;
    const src = sampleByCustomId.get(customId);
    if (!src) { log(`  ignored unknown custom_id ${customId}`); continue; }
    const { row, a_name, b_name } = src;

    let rec = {
      custom_id: customId,
      candidate_id: row.id,
      entity_id_a: row.entity_id_a,
      entity_id_b: row.entity_id_b,
      candidate_method: row.candidate_method,
      similarity_score: row.similarity_score,
      name_a: a_name,
      name_b: b_name,
      live_sonnet: {
        verdict: row.llm_verdict,
        confidence: row.llm_confidence,
        provider: row.llm_provider,
        tokens_in: row.llm_tokens_in,
        tokens_out: row.llm_tokens_out,
      },
      batch_sonnet: null,
      result_type: item.result?.type || null,
    };

    if (item.result?.type === 'succeeded') {
      const msg = item.result.message;
      const text = msg.content?.[0]?.text || '';
      let parsed;
      try { parsed = parseJson(text); }
      catch { parsed = { verdict: 'UNCERTAIN', confidence: 0, reasoning: 'parse error', _raw: text.slice(0, 200) }; }
      rec.batch_sonnet = {
        verdict: String(parsed.verdict || '').toUpperCase(),
        confidence: parsed.confidence ?? null,
        reasoning: String(parsed.reasoning || '').slice(0, 240),
        tokens_in: msg.usage?.input_tokens ?? null,
        tokens_out: msg.usage?.output_tokens ?? null,
      };
    } else if (item.result?.type === 'errored') {
      rec.batch_error = item.result.error;
    } else {
      rec.batch_note = `result type: ${item.result?.type}`;
    }

    writer.write(JSON.stringify(rec) + '\n');
    outcomes.push(rec);
  }
  writer.end();

  // ── Step 5. Report ─────────────────────────────────────────
  const succeeded = outcomes.filter(o => o.batch_sonnet);
  const errored   = outcomes.filter(o => o.batch_error);
  const other     = outcomes.filter(o => !o.batch_sonnet && !o.batch_error);
  const agreed    = succeeded.filter(o => String(o.live_sonnet.verdict).toUpperCase() === o.batch_sonnet.verdict);

  const byVerdict = {};
  for (const o of succeeded) {
    const live = String(o.live_sonnet.verdict).toUpperCase();
    if (!byVerdict[live]) byVerdict[live] = { total: 0, agree: 0, flips: {} };
    byVerdict[live].total++;
    if (live === o.batch_sonnet.verdict) byVerdict[live].agree++;
    else {
      const k = `${live}→${o.batch_sonnet.verdict}`;
      byVerdict[live].flips[k] = (byVerdict[live].flips[k] || 0) + 1;
    }
  }

  const sumBatchTokIn  = succeeded.reduce((a, o) => a + (o.batch_sonnet.tokens_in  || 0), 0);
  const sumBatchTokOut = succeeded.reduce((a, o) => a + (o.batch_sonnet.tokens_out || 0), 0);

  // Sonnet 4.6 pricing: $3 in / $15 out per MTok. Batch gets 50% off.
  const onlineCost = (sumBatchTokIn / 1e6) * 3 + (sumBatchTokOut / 1e6) * 15;
  const batchCost  = onlineCost * 0.5;

  console.log('\n══════════════════════ BATCH PROTOTYPE SUMMARY ══════════════════════');
  console.log(`Batch id                : ${finalBatch.id}`);
  console.log(`Processing status       : ${finalBatch.processing_status}`);
  console.log(`End-state counts        : ${JSON.stringify(finalBatch.request_counts)}`);
  console.log(`Wall-clock (submit→end) : ${batchElapsedS}s`);
  console.log(`Sample                  : ${outcomes.length} results (${succeeded.length} ok, ${errored.length} errored, ${other.length} other)`);
  console.log(`Verdict agreement       : ${agreed.length}/${succeeded.length} = ${succeeded.length ? (agreed.length/succeeded.length*100).toFixed(1) : '0'}% (batch Sonnet vs live Sonnet)`);
  for (const sv of ['SAME', 'RELATED', 'DIFFERENT']) {
    const v = byVerdict[sv]; if (!v) continue;
    const pct = (v.agree / v.total * 100).toFixed(1);
    console.log(`  live=${sv.padEnd(9)} agree: ${v.agree}/${v.total} (${pct}%)`);
    for (const [flip, c] of Object.entries(v.flips).sort((a,b) => b[1]-a[1])) {
      console.log(`    flip ${flip.padEnd(22)}: ${c}`);
    }
  }
  console.log(`\nTokens (batch calls only):`);
  console.log(`  in  = ${sumBatchTokIn.toLocaleString()}`);
  console.log(`  out = ${sumBatchTokOut.toLocaleString()}`);
  console.log(`  Cost if online        : $${onlineCost.toFixed(4)}`);
  console.log(`  Cost actual (50% off) : $${batchCost.toFixed(4)}`);

  // Full-workload extrapolation (1.6M pairs at typical ~800 in / ~150 out).
  const fullPairs = 1_643_060;
  const avgIn  = succeeded.length ? sumBatchTokIn  / succeeded.length : 0;
  const avgOut = succeeded.length ? sumBatchTokOut / succeeded.length : 0;
  const fullIn  = avgIn  * fullPairs;
  const fullOut = avgOut * fullPairs;
  const fullOnline = (fullIn / 1e6) * 3 + (fullOut / 1e6) * 15;
  const fullBatch  = fullOnline * 0.5;
  console.log(`\nExtrapolated cost for full 1.6M pairs (avg tokens from this sample):`);
  console.log(`  Online   : $${fullOnline.toFixed(2)}`);
  console.log(`  Batch    : $${fullBatch.toFixed(2)} (savings: $${(fullOnline-fullBatch).toFixed(2)})`);
  console.log(`  Anthropic batch limit is 100K/batch → ~17 batches for 1.6M pairs.`);

  console.log(`\nDetails: ${opts.out}`);
  console.log('═════════════════════════════════════════════════════════════════════');

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); if (e.stack) console.error(e.stack); process.exit(1); });
