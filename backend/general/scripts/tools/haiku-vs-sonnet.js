#!/usr/bin/env node
/**
 * haiku-vs-sonnet.js - A/B comparison of Claude Haiku 4.5 vs Sonnet 4.6 on
 * the entity-resolution workload used by 08-llm-golden-records.js.
 *
 * Pulls a stratified random sample of already-reviewed candidate pairs from
 * general.entity_merge_candidates (Sonnet verdicts are persisted on the row),
 * rebuilds the exact same prompt, re-asks Haiku, and reports how often Haiku
 * agrees with Sonnet.
 *
 * READ-ONLY: does not write anywhere in the DB. Safe to run alongside the
 * main 08 script.
 *
 * Usage:
 *   node scripts/tools/haiku-vs-sonnet.js                       # default 500 pairs, concurrency 20
 *   node scripts/tools/haiku-vs-sonnet.js --sample 200 --concurrency 10
 *   node scripts/tools/haiku-vs-sonnet.js --haiku-model claude-haiku-4-5
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const { callLLM } = require('../../lib/llm-review');

function parseArgs() {
  const opts = {
    sample: 500,
    concurrency: 20,
    haikuModel: 'claude-haiku-4-5',
    sonnetModel: 'claude-sonnet-4-6',
    out: null,
    provider: 'vertex',
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i+1]) opts.sample = parseInt(args[++i], 10);
    else if (args[i] === '--concurrency' && args[i+1]) opts.concurrency = parseInt(args[++i], 10);
    else if (args[i] === '--haiku-model' && args[i+1]) opts.haikuModel = args[++i];
    else if (args[i] === '--sonnet-model' && args[i+1]) opts.sonnetModel = args[++i];
    else if (args[i] === '--provider' && args[i+1]) opts.provider = args[++i];
    else if (args[i] === '--out' && args[i+1]) opts.out = args[++i];
  }
  if (!opts.out) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    opts.out = path.join(__dirname, `haiku-vs-sonnet-${ts}.jsonl`);
  }
  return opts;
}

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

// ═══════════════════════════════════════════════════════════════
//  Entity loader + prompt builder — copied from 08-llm-golden-records.js
//  so the test sends the EXACT same prompt Sonnet saw.
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
//  Stratified sampling — grab roughly equal counts across the
//  three verdict categories so per-category agreement rates are
//  not dominated by whichever is most numerous (DIFFERENT is ~70%).
// ═══════════════════════════════════════════════════════════════

async function fetchSample(n) {
  // Aim for ~40/40/20 mix; fall back to whatever's available.
  const targets = [
    { verdict: 'SAME',      cap: Math.ceil(n * 0.40) },
    { verdict: 'DIFFERENT', cap: Math.ceil(n * 0.40) },
    { verdict: 'RELATED',   cap: Math.ceil(n * 0.20) },
  ];
  const out = [];
  for (const t of targets) {
    const r = await pool.query(`
      SELECT id, entity_id_a, entity_id_b, candidate_method, similarity_score,
             llm_verdict, llm_confidence, llm_provider, llm_tokens_in, llm_tokens_out,
             reviewed_at
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
//  Concurrency helper
// ═══════════════════════════════════════════════════════════════

class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() { if (this.count < this.max) { this.count++; return; } await new Promise(r => this.queue.push(r)); this.count++; }
  release() { this.count--; if (this.queue.length > 0) this.queue.shift()(); }
}

// ═══════════════════════════════════════════════════════════════
//  Per-pair test: rebuild prompt, call Haiku, record comparison.
// ═══════════════════════════════════════════════════════════════

async function testPair(row, opts, writer) {
  const [a, b] = await Promise.all([
    loadEntityContext(row.entity_id_a),
    loadEntityContext(row.entity_id_b),
  ]);
  if (!a || !b) return { id: row.id, error: 'entity not found' };

  const prompt = buildPrompt(a, b, row.similarity_score || 0);
  const t0 = Date.now();
  let haikuResult = null, haikuError = null, haikuUsage = null;
  try {
    const response = await callLLM(prompt, {
      model: opts.haikuModel,
      maxTokens: 2000,
      forceProvider: opts.provider,
    });
    haikuUsage = response.usage;
    try { haikuResult = parseJson(response.text); }
    catch { haikuResult = { verdict: 'UNCERTAIN', confidence: 0, reasoning: 'parse error', _raw: response.text?.slice(0, 300) }; }
  } catch (err) {
    haikuError = err.message.slice(0, 200);
  }
  const elapsedMs = Date.now() - t0;

  const sonnetVerdict = String(row.llm_verdict || '').toUpperCase();
  const haikuVerdict = String(haikuResult?.verdict || '').toUpperCase();
  const agree = !haikuError && sonnetVerdict === haikuVerdict;

  const record = {
    candidate_id: row.id,
    entity_id_a: row.entity_id_a,
    entity_id_b: row.entity_id_b,
    candidate_method: row.candidate_method,
    similarity_score: row.similarity_score,
    name_a: a.canonical_name,
    name_b: b.canonical_name,
    sonnet: {
      verdict: sonnetVerdict,
      confidence: row.llm_confidence !== null ? Number(row.llm_confidence) : null,
      provider: row.llm_provider,
      tokens_in: row.llm_tokens_in,
      tokens_out: row.llm_tokens_out,
    },
    haiku: haikuError ? { error: haikuError } : {
      verdict: haikuVerdict,
      confidence: haikuResult.confidence ?? null,
      reasoning: String(haikuResult.reasoning || '').slice(0, 240),
      tokens_in: haikuUsage?.input_tokens ?? null,
      tokens_out: haikuUsage?.output_tokens ?? null,
      elapsed_ms: elapsedMs,
    },
    agree,
  };
  writer.write(JSON.stringify(record) + '\n');
  return record;
}

// ═══════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  log(`sample=${opts.sample} concurrency=${opts.concurrency} haiku=${opts.haikuModel} sonnet_ref=${opts.sonnetModel} provider=${opts.provider}`);
  log(`writing details to: ${opts.out}`);

  log('Fetching stratified sample from entity_merge_candidates...');
  const sample = await fetchSample(opts.sample);
  log(`Got ${sample.length} reviewed pairs (requested ${opts.sample})`);
  if (sample.length === 0) { log('No sample rows — is 08 running? Need reviewed pairs.'); await pool.end(); process.exit(1); }

  const writer = fs.createWriteStream(opts.out, { flags: 'w' });
  const sem = new Semaphore(opts.concurrency);
  const results = [];
  let done = 0;
  const runStart = Date.now();

  const tasks = sample.map(row => (async () => {
    await sem.acquire();
    try {
      const r = await testPair(row, opts, writer);
      results.push(r);
      done++;
      if (done % 25 === 0 || done === sample.length) {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        log(`  ${done}/${sample.length} done (${elapsed}s elapsed)`);
      }
    } catch (e) {
      log(`  pair ${row.id} crashed: ${e.message.slice(0, 100)}`);
    } finally { sem.release(); }
  })());

  await Promise.all(tasks);
  writer.end();

  // ── Summary ──────────────────────────────────────────────────
  const withResult = results.filter(r => r.haiku && !r.haiku.error);
  const errors = results.filter(r => r.haiku?.error).length;
  const agreeCount = withResult.filter(r => r.agree).length;

  const byVerdict = {};
  for (const r of withResult) {
    const sv = r.sonnet.verdict;
    if (!byVerdict[sv]) byVerdict[sv] = { total: 0, agree: 0, flips: {} };
    byVerdict[sv].total++;
    if (r.agree) byVerdict[sv].agree++;
    else {
      const key = `${sv}→${r.haiku.verdict}`;
      byVerdict[sv].flips[key] = (byVerdict[sv].flips[key] || 0) + 1;
    }
  }

  const avgHaikuLatency = withResult.length
    ? Math.round(withResult.reduce((a, r) => a + r.haiku.elapsed_ms, 0) / withResult.length)
    : 0;
  const sumHaikuTokIn = withResult.reduce((a, r) => a + (r.haiku.tokens_in || 0), 0);
  const sumHaikuTokOut = withResult.reduce((a, r) => a + (r.haiku.tokens_out || 0), 0);
  const sumSonnetTokIn = withResult.reduce((a, r) => a + (r.sonnet.tokens_in || 0), 0);
  const sumSonnetTokOut = withResult.reduce((a, r) => a + (r.sonnet.tokens_out || 0), 0);

  // Model token prices (published 2026): Sonnet 4.6 $3/$15 per MTok, Haiku 4.5 $1/$5 per MTok.
  const cost = (tokIn, tokOut, inPrice, outPrice) =>
    (tokIn / 1_000_000) * inPrice + (tokOut / 1_000_000) * outPrice;
  const sonnetCost = cost(sumSonnetTokIn, sumSonnetTokOut, 3, 15);
  const haikuCost  = cost(sumHaikuTokIn,  sumHaikuTokOut,  1, 5);

  console.log('\n══════════════════════ SUMMARY ══════════════════════');
  console.log(`Sample                 : ${results.length} pairs (${withResult.length} scored, ${errors} errored)`);
  console.log(`Overall agreement      : ${agreeCount}/${withResult.length} = ${(agreeCount/withResult.length*100).toFixed(1)}%`);
  console.log(`Total elapsed          : ${((Date.now()-runStart)/1000).toFixed(0)}s`);
  console.log(`Haiku avg latency      : ${avgHaikuLatency}ms per call`);
  console.log(`\nPer-verdict breakdown (row = Sonnet said; col = Haiku said):`);
  for (const sv of ['SAME', 'RELATED', 'DIFFERENT']) {
    const v = byVerdict[sv];
    if (!v) continue;
    const agreePct = (v.agree / v.total * 100).toFixed(1);
    console.log(`  Sonnet=${sv.padEnd(9)} → Haiku agree: ${v.agree}/${v.total} (${agreePct}%)`);
    for (const [flip, c] of Object.entries(v.flips).sort((a,b) => b[1]-a[1])) {
      console.log(`    flip ${flip.padEnd(22)}: ${c}`);
    }
  }
  console.log(`\nToken usage (this sample):`);
  console.log(`  Sonnet  in=${sumSonnetTokIn.toLocaleString()} out=${sumSonnetTokOut.toLocaleString()} cost=$${sonnetCost.toFixed(4)}`);
  console.log(`  Haiku   in=${sumHaikuTokIn.toLocaleString()}  out=${sumHaikuTokOut.toLocaleString()}  cost=$${haikuCost.toFixed(4)}`);
  if (sonnetCost > 0) {
    console.log(`  Haiku cost ratio     : ${(haikuCost/sonnetCost*100).toFixed(1)}% of Sonnet`);
  }
  console.log(`\nDetails written to: ${opts.out}`);
  console.log('══════════════════════════════════════════════════════');

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
