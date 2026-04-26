#!/usr/bin/env node
/**
 * batch-worker.js — Complementary LLM worker using Anthropic Message Batches.
 *
 * Runs alongside the live 08-llm-golden-records.js (which uses Vertex at 100
 * concurrency from the TOP of the pending queue, highest similarity first).
 * This worker claims from the BOTTOM of the queue (lowest similarity first)
 * and submits those pairs via Anthropic's Message Batches API.
 *
 * Concurrency-safety design:
 *   - Claims use FOR UPDATE SKIP LOCKED with a distinct status value
 *     ('llm_batch_reviewing'). The live 08's resetStale() only touches
 *     'llm_reviewing' rows, so our in-flight claims are invisible to it.
 *   - Opposite ordering on similarity_score ensures the two workers chew
 *     through the queue from opposite ends and only meet in the middle.
 *   - Each pair is still exactly-once-processed — SKIP LOCKED guarantees
 *     this at the row-lock level.
 *   - applySame / applyRelated are unchanged — their transactional guards
 *     (FOR UPDATE + merged_into check) handle the race where the live worker
 *     merged one side before our batch result landed.
 *
 * Parallelism: up to N batches in flight at once. Each batch carries 10K
 * pairs (configurable). When one lands, its rows are applied one-by-one in
 * their own transactions and a new batch takes its slot.
 *
 * Startup safety: on start, any llm_batch_reviewing rows older than 3h are
 * reset to pending (covers crash recovery — longer than any real batch SLA).
 *
 * Usage:
 *   node scripts/tools/batch-worker.js                          # 3 parallel batches, 10K each
 *   node scripts/tools/batch-worker.js --parallel 5 --batch-size 10000
 *   node scripts/tools/batch-worker.js --max-batches 10         # cap total submitted
 *   node scripts/tools/batch-worker.js --model claude-sonnet-4-6
 */
const path = require('path');
const fs = require('fs');

const publicEnv = path.join(__dirname, '..', '..', '.env.public');
if (fs.existsSync(publicEnv)) require('dotenv').config({ path: publicEnv });
const adminEnv = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(adminEnv)) require('dotenv').config({ path: adminEnv, override: true });

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../../lib/db');

// ═══════════════════════════════════════════════════════════════
//  Args + logging
// ═══════════════════════════════════════════════════════════════

function parseArgs() {
  const opts = {
    parallel: 3,
    batchSize: 10_000,
    maxBatches: 0,           // 0 = run until pending is drained
    model: 'claude-sonnet-4-6',
    maxTokens: 2000,
    pollMs: 20_000,
    staleResetHours: 3,      // treat claims older than this as dead
    ctxConcurrency: 20,      // concurrency for entity-context SELECTs
    applyConcurrency: 5,     // concurrency for per-pair merge transactions
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--parallel' && args[i+1]) opts.parallel = parseInt(args[++i], 10);
    else if (args[i] === '--batch-size' && args[i+1]) opts.batchSize = parseInt(args[++i], 10);
    else if (args[i] === '--max-batches' && args[i+1]) opts.maxBatches = parseInt(args[++i], 10);
    else if (args[i] === '--model' && args[i+1]) opts.model = args[++i];
    else if (args[i] === '--max-tokens' && args[i+1]) opts.maxTokens = parseInt(args[++i], 10);
    else if (args[i] === '--poll-ms' && args[i+1]) opts.pollMs = parseInt(args[++i], 10);
  }
  return opts;
}

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
//  Retry + semaphore helpers (copied from 08)
// ═══════════════════════════════════════════════════════════════

async function withRetry(fn, label = 'op', maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = (err.message || '') + (err.code || '') + (err.status || '');
      const isTransient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|57P01|57P03|08006|08001|Connection terminated|connection error|fetch failed|\b5\d\d\b|429|rate.limit|overloaded/i.test(msg);
      if (!isTransient || attempt >= maxRetries) throw err;
      const delay = Math.min(2000 * Math.pow(1.5, attempt) + Math.random() * 2000, 30_000);
      console.warn(`  [retry] ${label}: ${err.message.slice(0, 80)} ... ${(delay/1000).toFixed(0)}s`);
      await sleep(delay);
    }
  }
}

class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() { if (this.count < this.max) { this.count++; return; } await new Promise(r => this.queue.push(r)); this.count++; }
  release() { this.count--; if (this.queue.length) this.queue.shift()(); }
}

// ═══════════════════════════════════════════════════════════════
//  Entity loader + prompt builder (copied verbatim from 08 — keep
//  in lockstep or the two workers will produce inconsistent verdicts)
// ═══════════════════════════════════════════════════════════════

async function loadEntityContext(entityId) {
  const r = await withRetry(() => pool.query(`
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
  `, [entityId]), 'load-entity');
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
//  Persistence — claim, mark, apply (all logic mirrors 08, with a
//  distinct status value so the two workers don't clobber each other)
// ═══════════════════════════════════════════════════════════════

const CLAIM_STATUS = 'llm_batch_reviewing';
const PROVIDER_LABEL = 'anthropic_batch';

// Batch-ID persistence: append each submitted batch to a log file so that a
// crashed worker's in-flight batches can be recovered via reattach-batch.js.
// Completed batches get removed from the log in finalizeBatch().
const BATCH_LOG = path.join(__dirname, '.batch-inflight.jsonl');
function persistBatch(batchId, candidateIds) {
  try {
    fs.appendFileSync(BATCH_LOG, JSON.stringify({
      event: 'submitted', batch_id: batchId, candidate_ids: candidateIds,
      submitted_at: new Date().toISOString(),
    }) + '\n');
  } catch (e) { console.warn(`  [persistBatch warn]: ${e.message}`); }
}
function finalizeBatch(batchId) {
  try {
    fs.appendFileSync(BATCH_LOG, JSON.stringify({
      event: 'applied', batch_id: batchId, finalized_at: new Date().toISOString(),
    }) + '\n');
  } catch {}
}

async function resetStaleBatchClaims(hours) {
  const r = await pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = 'pending'
     WHERE status = $1
       AND (reviewed_at IS NULL OR reviewed_at < NOW() - INTERVAL '${hours} hours')
  `, [CLAIM_STATUS]);
  if (r.rowCount > 0) log(`Reset ${r.rowCount} stale ${CLAIM_STATUS} rows older than ${hours}h → pending`);
}

async function claimBottomBatch(size) {
  // Lowest-similarity first (opposite of 08's DESC order). SKIP LOCKED
  // prevents collision if 08 ever works its way down to the bottom.
  const r = await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates mc
       SET status = $2, reviewed_at = NOW()
     WHERE id IN (
       SELECT id FROM general.entity_merge_candidates
        WHERE status = 'pending'
        ORDER BY similarity_score ASC NULLS LAST, id DESC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, entity_id_a, entity_id_b, similarity_score, candidate_method
  `, [size, CLAIM_STATUS]), 'claim-bottom');
  return r.rows;
}

async function releaseRowsToPending(ids) {
  if (!ids.length) return;
  await pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = 'pending'
     WHERE id = ANY($1::int[]) AND status = $2
  `, [ids, CLAIM_STATUS]);
}

async function markCandidate(id, verdict, result, providerInfo) {
  const statusMap = { SAME: 'same', RELATED: 'related', DIFFERENT: 'different' };
  await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = $1, llm_verdict = $2, llm_confidence = $3, llm_reasoning = $4,
           llm_response = $5, llm_provider = $6, llm_tokens_in = $7, llm_tokens_out = $8,
           reviewed_at = NOW()
     WHERE id = $9
  `, [
    statusMap[verdict] || 'uncertain',
    verdict,
    Number(result.confidence) || null,
    String(result.reasoning || '').slice(0, 500),
    result,
    providerInfo?.provider || PROVIDER_LABEL,
    providerInfo?.input_tokens || null,
    providerInfo?.output_tokens || null,
    id,
  ]), 'mark-candidate');
}

async function markError(id, errMsg) {
  try {
    await pool.query(`
      UPDATE general.entity_merge_candidates
         SET status = 'error', llm_reasoning = $1, reviewed_at = NOW()
       WHERE id = $2
    `, [String(errMsg).slice(0, 500), id]);
  } catch {}
}

// ── applySame — byte-for-byte parity with 08. Any drift here will produce
// different golden records depending on which worker happened to process
// the pair, so keep this in lockstep.
async function applySame(survivorId, absorbedId, result, candidateId) {
  const client = await pool.connect();
  client.once('error', (e) => { console.error(`  [client error suppressed]: ${e.message}`); });
  try {
    await client.query('BEGIN');

    const guard = await client.query(
      'SELECT id, merged_into FROM general.entities WHERE id = ANY($1::int[]) FOR UPDATE',
      [[survivorId, absorbedId]]
    );
    const byId = new Map(guard.rows.map(r => [r.id, r]));
    if (!byId.get(survivorId) || !byId.get(absorbedId)) { await client.query('ROLLBACK'); return 'missing'; }
    if (byId.get(survivorId).merged_into || byId.get(absorbedId).merged_into) {
      await client.query('ROLLBACK'); return 'already_merged';
    }

    const authoredName = (result.canonical_name && String(result.canonical_name).trim()) || null;
    const authoredType = (result.entity_type && String(result.entity_type).trim()) || null;
    const aliasesFromLlm = Array.isArray(result.aliases) ? result.aliases.filter(Boolean).map(String).slice(0, 100) : [];

    await client.query(`
      UPDATE general.entities SET
        canonical_name = COALESCE($3, canonical_name),
        entity_type    = COALESCE($4, entity_type),
        alternate_names = (
          SELECT array_agg(DISTINCT n) FROM (
            SELECT unnest(alternate_names) AS n FROM general.entities WHERE id = $1
            UNION SELECT unnest(alternate_names) FROM general.entities WHERE id = $2
            UNION SELECT canonical_name FROM general.entities WHERE id = $2
            UNION SELECT unnest($5::text[])
          ) sub WHERE n IS NOT NULL AND length(trim(n)) > 0
        ),
        bn_root = COALESCE(bn_root, (SELECT bn_root FROM general.entities WHERE id = $2)),
        bn_variants = (
          SELECT array_agg(DISTINCT v) FROM (
            SELECT unnest(bn_variants) AS v FROM general.entities WHERE id = $1
            UNION SELECT unnest(bn_variants) FROM general.entities WHERE id = $2
          ) sub WHERE v IS NOT NULL
        ),
        dataset_sources = (
          SELECT array_agg(DISTINCT s) FROM (
            SELECT unnest(dataset_sources) AS s FROM general.entities WHERE id = $1
            UNION SELECT unnest(dataset_sources) FROM general.entities WHERE id = $2
          ) sub WHERE s IS NOT NULL
        ),
        updated_at = NOW()
      WHERE id = $1
    `, [survivorId, absorbedId, authoredName, authoredType, aliasesFromLlm]);

    const linkRes = await client.query(
      'UPDATE general.entity_source_links SET entity_id = $1 WHERE entity_id = $2',
      [survivorId, absorbedId]
    );

    await client.query(
      `UPDATE general.entities SET status = 'merged', merged_into = $1, updated_at = NOW() WHERE id = $2`,
      [survivorId, absorbedId]
    );

    await client.query(`
      INSERT INTO general.entity_merges
        (survivor_id, absorbed_id, candidate_id, merge_method, metadata_merged, links_redirected, merged_by)
      VALUES ($1, $2, $3, 'llm_golden_records', $4, $5, 'llm_batch')
    `, [survivorId, absorbedId, candidateId, result, linkRes.rowCount]);

    await client.query(`
      INSERT INTO general.entity_golden_records
        (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, aliases,
         dataset_sources, llm_authored, confidence, status, updated_at)
      SELECT e.id, COALESCE($2, e.canonical_name),
             COALESCE(e.norm_canonical, general.norm_name(COALESCE($2, e.canonical_name))),
             COALESCE($3, e.entity_type), e.bn_root,
             COALESCE(e.bn_variants, '{}'),
             (SELECT jsonb_agg(DISTINCT jsonb_build_object('name', n, 'source', 'llm'))
              FROM unnest($4::text[]) AS n WHERE n IS NOT NULL AND length(trim(n)) > 0),
             COALESCE(e.dataset_sources, '{}'),
             $5::jsonb, GREATEST(COALESCE(e.confidence, 0), $6),
             'active', NOW()
      FROM general.entities e WHERE e.id = $1
      ON CONFLICT (id) DO UPDATE SET
        canonical_name = EXCLUDED.canonical_name,
        entity_type    = EXCLUDED.entity_type,
        bn_root        = EXCLUDED.bn_root,
        bn_variants    = EXCLUDED.bn_variants,
        dataset_sources = EXCLUDED.dataset_sources,
        aliases = (
          SELECT jsonb_agg(DISTINCT x) FROM (
            SELECT jsonb_array_elements(general.entity_golden_records.aliases) AS x
            UNION SELECT jsonb_array_elements(EXCLUDED.aliases)
          ) y WHERE x IS NOT NULL
        ),
        llm_authored = EXCLUDED.llm_authored,
        confidence = EXCLUDED.confidence,
        status = 'active',
        updated_at = NOW()
    `, [survivorId, authoredName, authoredType, aliasesFromLlm, result, Number(result.confidence) || 0]);

    await client.query(`UPDATE general.entity_golden_records SET status = 'merged', updated_at = NOW() WHERE id = $1`, [absorbedId]);

    await client.query('COMMIT');
    return 'merged';
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally { client.release(); }
}

async function applyRelated(idA, idB, result) {
  const client = await pool.connect();
  client.once('error', (e) => { console.error(`  [client error suppressed]: ${e.message}`); });
  try {
    await client.query('BEGIN');
    const names = await client.query('SELECT id, canonical_name FROM general.entities WHERE id = ANY($1::int[])', [[idA, idB]]);
    const nm = new Map(names.rows.map(r => [r.id, r.canonical_name]));

    const addRelation = async (self, other) => {
      const rel = {
        entity_id: other, name: nm.get(other) || null, relationship: 'RELATED',
        reasoning: String(result.reasoning || '').slice(0, 500),
        confidence: Number(result.confidence) || 0,
      };
      await client.query(`
        INSERT INTO general.entity_golden_records (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, dataset_sources, confidence, status)
        SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
               COALESCE(e.bn_variants,'{}'), COALESCE(e.dataset_sources,'{}'), e.confidence, 'active'
        FROM general.entities e WHERE e.id = $1
        ON CONFLICT (id) DO NOTHING
      `, [self]);
      await client.query(`
        UPDATE general.entity_golden_records
           SET related_entities = COALESCE(related_entities, '[]'::jsonb) || $2::jsonb, updated_at = NOW()
         WHERE id = $1
      `, [self, JSON.stringify([rel])]);
    };
    await addRelation(idA, idB);
    await addRelation(idB, idA);

    await client.query('COMMIT');
    return 'related';
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally { client.release(); }
}

function pickSurvivor(a, b, result) {
  const sHint = String(result.survivor || '').toUpperCase();
  if (sHint === 'A') return { survivorId: a.id, absorbedId: b.id };
  if (sHint === 'B') return { survivorId: b.id, absorbedId: a.id };
  // Tiebreak: has BN > more links > lower id
  const aScore = (a.bn_root ? 2 : 0) + Math.min(a.link_count || 0, 1);
  const bScore = (b.bn_root ? 2 : 0) + Math.min(b.link_count || 0, 1);
  if (aScore > bScore) return { survivorId: a.id, absorbedId: b.id };
  if (bScore > aScore) return { survivorId: b.id, absorbedId: a.id };
  if ((a.link_count || 0) >= (b.link_count || 0)) return { survivorId: a.id, absorbedId: b.id };
  return { survivorId: b.id, absorbedId: a.id };
}

// ═══════════════════════════════════════════════════════════════
//  One batch end-to-end: claim → prepare → submit → poll → apply
// ═══════════════════════════════════════════════════════════════

async function runBatch(slotId, client, opts, globalStats) {
  const rows = await claimBottomBatch(opts.batchSize);
  if (rows.length === 0) return { drained: true };

  log(`[slot ${slotId}] claimed ${rows.length} rows (sim range: ${rows[0]?.similarity_score} → ${rows[rows.length-1]?.similarity_score})`);

  // Load contexts with bounded concurrency.
  const ctxById = new Map();
  const ctxSem = new Semaphore(opts.ctxConcurrency);
  await Promise.all(rows.map(row => (async () => {
    await ctxSem.acquire();
    try {
      const [a, b] = await Promise.all([loadEntityContext(row.entity_id_a), loadEntityContext(row.entity_id_b)]);
      ctxById.set(row.id, { a, b });
    } finally { ctxSem.release(); }
  })()));

  const requests = [];
  const ctxMap = new Map();
  for (const row of rows) {
    const c = ctxById.get(row.id);
    if (!c?.a || !c?.b) { await markError(row.id, 'entity not found'); globalStats.errored++; continue; }
    if (c.a.merged_into || c.b.merged_into) {
      await markCandidate(row.id, 'DIFFERENT', { reasoning: 'one side already merged', confidence: 0 }, { provider: PROVIDER_LABEL });
      globalStats.stale++; continue;
    }
    const prompt = buildPrompt(c.a, c.b, row.similarity_score || 0);
    const customId = `cand-${row.id}`;
    ctxMap.set(customId, { row, a: c.a, b: c.b });
    requests.push({
      custom_id: customId,
      params: { model: opts.model, max_tokens: opts.maxTokens, messages: [{ role: 'user', content: prompt }] },
    });
  }

  if (requests.length === 0) {
    log(`[slot ${slotId}] all rows skipped (stale or missing) — nothing to submit`);
    return { drained: false, submitted: 0 };
  }

  log(`[slot ${slotId}] submitting batch of ${requests.length} prompts to Anthropic...`);
  let batch;
  try { batch = await client.messages.batches.create({ requests }); }
  catch (err) {
    log(`[slot ${slotId}] submit FAILED: ${err.message.slice(0, 180)} — releasing rows`);
    await releaseRowsToPending(rows.map(r => r.id));
    globalStats.batch_errors++;
    return { drained: false, submitted: 0 };
  }
  log(`[slot ${slotId}] batch id=${batch.id} status=${batch.processing_status}`);
  // Persist batch_id + candidate_ids so we can recover results via reattach
  // if this process crashes before results land.
  persistBatch(batch.id, Array.from(ctxMap.values()).map(v => v.row.id));

  const submitT = Date.now();
  let lastCounts = '';
  let final = batch;
  // Poll resilience: each iteration has its own try/catch so a transient
  // network/API blip just loses one poll cycle, not the whole batch. Only
  // after ~1h of consecutive failures do we give up (rows stay in
  // llm_batch_reviewing for reattach-batch.js to recover).
  let consecutiveFails = 0;
  const MAX_FAILS = Math.ceil(3_600_000 / opts.pollMs);  // 1 hour of poll cycles
  while (true) {
    let status;
    try {
      status = await client.messages.batches.retrieve(batch.id);
      consecutiveFails = 0;
    } catch (err) {
      consecutiveFails++;
      if (consecutiveFails >= MAX_FAILS) {
        log(`[slot ${slotId}] batch ${batch.id} poll gave up after ${MAX_FAILS} failures — batch_id persisted, recover via reattach-batch.js`);
        globalStats.batch_errors++;
        return { drained: false, submitted: 0 };
      }
      if (consecutiveFails % 10 === 1) {
        log(`[slot ${slotId}] poll fail #${consecutiveFails}: ${err.message.slice(0, 120)}`);
      }
      await sleep(opts.pollMs);
      continue;
    }
    const c = JSON.stringify(status.request_counts);
    if (c !== lastCounts) { log(`[slot ${slotId}] ${batch.id} counts=${c}`); lastCounts = c; }
    if (status.processing_status === 'ended') { final = status; break; }
    if (['canceled', 'expired'].includes(status.processing_status)) {
      log(`[slot ${slotId}] batch ${status.processing_status} — releasing rows`);
      await releaseRowsToPending(Array.from(ctxMap.values()).map(v => v.row.id));
      globalStats.batch_errors++;
      return { drained: false, submitted: 0 };
    }
    await sleep(opts.pollMs);
  }
  const elapsedS = ((Date.now() - submitT) / 1000).toFixed(0);
  log(`[slot ${slotId}] batch ${batch.id} ended in ${elapsedS}s — applying results`);

  // Stream + apply with bounded concurrency for merge transactions.
  const applySem = new Semaphore(opts.applyConcurrency);
  const iter = await client.messages.batches.results(batch.id);
  const applyTasks = [];
  for await (const item of iter) {
    applyTasks.push((async () => {
      await applySem.acquire();
      try {
        const src = ctxMap.get(item.custom_id);
        if (!src) return;
        const { row, a, b } = src;
        if (item.result?.type !== 'succeeded') {
          await markError(row.id, `batch result type=${item.result?.type}`);
          globalStats.errored++; return;
        }
        const msg = item.result.message;
        const text = msg.content?.[0]?.text || '';
        let result;
        try { result = parseJson(text); }
        catch { result = { verdict: 'UNCERTAIN', confidence: 0, reasoning: 'parse error' }; }
        const verdict = String(result.verdict || '').toUpperCase();
        const usage = {
          provider: PROVIDER_LABEL,
          input_tokens: msg.usage?.input_tokens,
          output_tokens: msg.usage?.output_tokens,
        };
        await markCandidate(row.id, verdict, result, usage);

        if (verdict === 'SAME') {
          const { survivorId, absorbedId } = pickSurvivor(a, b, result);
          try {
            const outcome = await applySame(survivorId, absorbedId, result, row.id);
            if (outcome === 'merged') globalStats.merged++;
            else globalStats.stale++;
          } catch (err) { globalStats.errored++; await markError(row.id, `merge: ${err.message}`); }
        } else if (verdict === 'RELATED') {
          try { await applyRelated(a.id, b.id, result); globalStats.related++; }
          catch (err) { globalStats.errored++; await markError(row.id, `related: ${err.message}`); }
        } else if (verdict === 'DIFFERENT') {
          globalStats.different++;
        } else {
          globalStats.uncertain++;
        }
      } finally { applySem.release(); }
    })());
  }
  await Promise.all(applyTasks);

  const { succeeded = 0, errored = 0 } = final.request_counts || {};
  log(`[slot ${slotId}] ✓ batch applied: succeeded=${succeeded} errored=${errored} — stats: merged=${globalStats.merged} rel=${globalStats.related} diff=${globalStats.different} unk=${globalStats.uncertain} err=${globalStats.errored}`);
  finalizeBatch(batch.id);
  globalStats.batches_completed++;
  return { drained: false, submitted: requests.length };
}

// ═══════════════════════════════════════════════════════════════
//  Main loop: keep N batches in flight until pending is drained
// ═══════════════════════════════════════════════════════════════

async function getPendingCount() {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM general.entity_merge_candidates WHERE status = 'pending'`);
  return r.rows[0].c;
}

async function main() {
  const opts = parseArgs();
  if (!process.env.ANTHROPIC_API_KEY) { log('FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  log(`batch-worker starting: parallel=${opts.parallel} batch_size=${opts.batchSize} model=${opts.model}`);
  await resetStaleBatchClaims(opts.staleResetHours);

  const pending = await getPendingCount();
  log(`pending rows available: ${pending.toLocaleString()}`);
  if (pending === 0) { log('nothing to do'); await pool.end(); return; }

  const stats = {
    batches_completed: 0, batch_errors: 0,
    merged: 0, related: 0, different: 0, uncertain: 0, errored: 0, stale: 0,
  };
  let batchesStarted = 0;
  let drainedSeen = false;

  const slots = new Array(opts.parallel).fill(null);
  const startedAt = Date.now();

  async function runSlot(slotId) {
    while (!drainedSeen && (opts.maxBatches === 0 || batchesStarted < opts.maxBatches)) {
      batchesStarted++;
      try {
        const r = await runBatch(slotId, client, opts, stats);
        if (r.drained) { drainedSeen = true; break; }
      } catch (err) {
        log(`[slot ${slotId}] batch CRASHED: ${err.message.slice(0, 180)}`);
        stats.batch_errors++;
        await sleep(5000);
      }
    }
    log(`[slot ${slotId}] exiting`);
  }

  // Stagger slot launches so they don't all hit claim + Anthropic at once.
  const slotPromises = slots.map((_, i) => (async () => {
    await sleep(i * 3000);
    return runSlot(i + 1);
  })());
  await Promise.all(slotPromises);

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log('\n══════════════════ BATCH WORKER SUMMARY ══════════════════');
  console.log(`Elapsed                 : ${elapsedMin} min`);
  console.log(`Batches completed       : ${stats.batches_completed}`);
  console.log(`Batch errors            : ${stats.batch_errors}`);
  console.log(`Applied verdicts        : merged=${stats.merged.toLocaleString()} related=${stats.related.toLocaleString()} different=${stats.different.toLocaleString()} uncertain=${stats.uncertain} stale=${stats.stale} errored=${stats.errored}`);
  console.log('═══════════════════════════════════════════════════════════');

  await pool.end();
}

process.on('SIGINT', async () => {
  log('SIGINT received — exiting (in-flight batches will continue server-side; restart to re-attach results)');
  try { await pool.end(); } catch {}
  process.exit(0);
});

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
