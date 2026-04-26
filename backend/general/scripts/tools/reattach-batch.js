#!/usr/bin/env node
/**
 * reattach-batch.js — Recover orphaned Anthropic batch results.
 *
 * If batch-worker.js crashed or was killed before fetching a batch's results,
 * the rows stay in status='llm_batch_reviewing' forever (08's resetStale only
 * touches 'llm_reviewing'). This tool:
 *
 *   1. Reads .batch-inflight.jsonl (batch-worker writes this on submit) to
 *      find any batch_ids that were submitted but not yet applied.
 *   2. Also accepts explicit --batch-id <id> args for manual recovery.
 *   3. For each orphan: polls until ended, streams results, applies verdicts.
 *
 * Usage:
 *   node scripts/tools/reattach-batch.js                       # auto-discover from log
 *   node scripts/tools/reattach-batch.js --batch-id msgbatch_X --batch-id msgbatch_Y
 *   node scripts/tools/reattach-batch.js --dry-run             # show what would be done
 */
const path = require('path');
const fs = require('fs');

const publicEnv = path.join(__dirname, '..', '..', '.env.public');
if (fs.existsSync(publicEnv)) require('dotenv').config({ path: publicEnv });
const adminEnv = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(adminEnv)) require('dotenv').config({ path: adminEnv, override: true });

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../../lib/db');

const BATCH_LOG = path.join(__dirname, '.batch-inflight.jsonl');

function parseArgs() {
  const opts = { batchIds: [], dryRun: false, pollMs: 20_000 };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-id' && args[i+1]) opts.batchIds.push(args[++i]);
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--poll-ms' && args[i+1]) opts.pollMs = parseInt(args[++i], 10);
  }
  return opts;
}

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Scan the inflight log for batches that were 'submitted' but never 'applied'.
function scanOrphanBatches() {
  if (!fs.existsSync(BATCH_LOG)) return [];
  const lines = fs.readFileSync(BATCH_LOG, 'utf8').split('\n').filter(Boolean);
  const state = new Map();  // batch_id → { submitted, applied }
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const s = state.get(obj.batch_id) || {};
    s[obj.event] = obj;
    state.set(obj.batch_id, s);
  }
  const orphans = [];
  for (const [batch_id, s] of state) {
    if (s.submitted && !s.applied) {
      orphans.push({ batch_id, submitted_at: s.submitted.submitted_at, candidate_ids: s.submitted.candidate_ids });
    }
  }
  return orphans;
}

// ═══════════════════════════════════════════════════════════════
//  Same DB helpers as batch-worker.js — we need to apply verdicts.
// ═══════════════════════════════════════════════════════════════

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```\w*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

async function markCandidate(id, verdict, result, providerInfo) {
  const statusMap = { SAME: 'same', RELATED: 'related', DIFFERENT: 'different' };
  await pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = $1, llm_verdict = $2, llm_confidence = $3, llm_reasoning = $4,
           llm_response = $5, llm_provider = $6, llm_tokens_in = $7, llm_tokens_out = $8,
           reviewed_at = NOW()
     WHERE id = $9
  `, [
    statusMap[verdict] || 'uncertain', verdict,
    Number(result.confidence) || null,
    String(result.reasoning || '').slice(0, 500),
    result, providerInfo?.provider || 'anthropic_batch',
    providerInfo?.input_tokens || null, providerInfo?.output_tokens || null, id,
  ]);
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

async function loadPair(candidateId) {
  const r = await pool.query(`
    SELECT c.id, c.entity_id_a, c.entity_id_b, c.similarity_score,
           a.merged_into AS a_merged, b.merged_into AS b_merged,
           a.bn_root AS a_bn, b.bn_root AS b_bn,
           (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = a.id) AS a_links,
           (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = b.id) AS b_links
    FROM general.entity_merge_candidates c
    JOIN general.entities a ON a.id = c.entity_id_a
    JOIN general.entities b ON b.id = c.entity_id_b
    WHERE c.id = $1
  `, [candidateId]);
  return r.rows[0] || null;
}

// applySame / applyRelated copied verbatim from batch-worker.js (same logic)
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
    if (byId.get(survivorId).merged_into || byId.get(absorbedId).merged_into) { await client.query('ROLLBACK'); return 'already_merged'; }

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
      [survivorId, absorbedId]);
    await client.query(`UPDATE general.entities SET status = 'merged', merged_into = $1, updated_at = NOW() WHERE id = $2`, [survivorId, absorbedId]);
    await client.query(`
      INSERT INTO general.entity_merges
        (survivor_id, absorbed_id, candidate_id, merge_method, metadata_merged, links_redirected, merged_by)
      VALUES ($1, $2, $3, 'llm_golden_records', $4, $5, 'llm_batch_reattach')
    `, [survivorId, absorbedId, candidateId, result, linkRes.rowCount]);
    await client.query(`
      INSERT INTO general.entity_golden_records
        (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, aliases,
         dataset_sources, llm_authored, confidence, status, updated_at)
      SELECT e.id, COALESCE($2, e.canonical_name),
             COALESCE(e.norm_canonical, general.norm_name(COALESCE($2, e.canonical_name))),
             COALESCE($3, e.entity_type), e.bn_root, COALESCE(e.bn_variants, '{}'),
             (SELECT jsonb_agg(DISTINCT jsonb_build_object('name', n, 'source', 'llm'))
              FROM unnest($4::text[]) AS n WHERE n IS NOT NULL AND length(trim(n)) > 0),
             COALESCE(e.dataset_sources, '{}'),
             $5::jsonb, GREATEST(COALESCE(e.confidence, 0), $6),
             'active', NOW()
      FROM general.entities e WHERE e.id = $1
      ON CONFLICT (id) DO UPDATE SET
        canonical_name = EXCLUDED.canonical_name,
        entity_type = EXCLUDED.entity_type,
        bn_root = EXCLUDED.bn_root,
        bn_variants = EXCLUDED.bn_variants,
        dataset_sources = EXCLUDED.dataset_sources,
        aliases = (SELECT jsonb_agg(DISTINCT x) FROM (
          SELECT jsonb_array_elements(general.entity_golden_records.aliases) AS x
          UNION SELECT jsonb_array_elements(EXCLUDED.aliases)
        ) y WHERE x IS NOT NULL),
        llm_authored = EXCLUDED.llm_authored,
        confidence = EXCLUDED.confidence, status = 'active', updated_at = NOW()
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
      const rel = { entity_id: other, name: nm.get(other) || null, relationship: 'RELATED',
        reasoning: String(result.reasoning || '').slice(0, 500), confidence: Number(result.confidence) || 0 };
      await client.query(`
        INSERT INTO general.entity_golden_records (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, dataset_sources, confidence, status)
        SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
               COALESCE(e.bn_variants,'{}'), COALESCE(e.dataset_sources,'{}'), e.confidence, 'active'
        FROM general.entities e WHERE e.id = $1 ON CONFLICT (id) DO NOTHING
      `, [self]);
      await client.query(`
        UPDATE general.entity_golden_records
           SET related_entities = COALESCE(related_entities, '[]'::jsonb) || $2::jsonb, updated_at = NOW()
         WHERE id = $1
      `, [self, JSON.stringify([rel])]);
    };
    await addRelation(idA, idB); await addRelation(idB, idA);
    await client.query('COMMIT'); return 'related';
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally { client.release(); }
}

function pickSurvivorFromPair(p, result) {
  const sHint = String(result.survivor || '').toUpperCase();
  if (sHint === 'A') return { survivorId: p.entity_id_a, absorbedId: p.entity_id_b };
  if (sHint === 'B') return { survivorId: p.entity_id_b, absorbedId: p.entity_id_a };
  const aScore = (p.a_bn ? 2 : 0) + Math.min(p.a_links || 0, 1);
  const bScore = (p.b_bn ? 2 : 0) + Math.min(p.b_links || 0, 1);
  if (aScore > bScore) return { survivorId: p.entity_id_a, absorbedId: p.entity_id_b };
  if (bScore > aScore) return { survivorId: p.entity_id_b, absorbedId: p.entity_id_a };
  if ((p.a_links || 0) >= (p.b_links || 0)) return { survivorId: p.entity_id_a, absorbedId: p.entity_id_b };
  return { survivorId: p.entity_id_b, absorbedId: p.entity_id_a };
}

// ═══════════════════════════════════════════════════════════════
//  Recover one batch
// ═══════════════════════════════════════════════════════════════

async function recoverBatch(client, batchId, opts) {
  log(`── Recovering ${batchId} ──`);

  // Poll until ended (tolerate transient poll failures).
  let lastCounts = '';
  while (true) {
    let status;
    try { status = await client.messages.batches.retrieve(batchId); }
    catch (err) { log(`  poll err: ${err.message.slice(0,80)} — retry in ${opts.pollMs/1000}s`); await sleep(opts.pollMs); continue; }
    const c = JSON.stringify(status.request_counts);
    if (c !== lastCounts) { log(`  status=${status.processing_status} counts=${c}`); lastCounts = c; }
    if (status.processing_status === 'ended') break;
    if (['canceled', 'expired'].includes(status.processing_status)) {
      log(`  batch ${status.processing_status} — cannot recover results`);
      return { applied: 0 };
    }
    await sleep(opts.pollMs);
  }

  if (opts.dryRun) { log(`  dry-run: would fetch + apply results now`); return { applied: 0 }; }

  const stats = { merged: 0, related: 0, different: 0, uncertain: 0, errored: 0, stale: 0 };
  const iter = await client.messages.batches.results(batchId);
  for await (const item of iter) {
    const match = /^cand-(\d+)$/.exec(item.custom_id || '');
    if (!match) { log(`  skipping unknown custom_id: ${item.custom_id}`); continue; }
    const candidateId = parseInt(match[1], 10);

    const pair = await loadPair(candidateId);
    if (!pair) { log(`  candidate ${candidateId} not found — skipping`); continue; }
    if (pair.a_merged || pair.b_merged) {
      await markCandidate(candidateId, 'DIFFERENT', { reasoning: 'one side already merged', confidence: 0 }, { provider: 'anthropic_batch' });
      stats.stale++; continue;
    }

    if (item.result?.type !== 'succeeded') {
      await markError(candidateId, `reattach: result type=${item.result?.type}`);
      stats.errored++; continue;
    }
    const msg = item.result.message;
    const text = msg.content?.[0]?.text || '';
    let result;
    try { result = parseJson(text); }
    catch { result = { verdict: 'UNCERTAIN', confidence: 0, reasoning: 'parse error' }; }
    const verdict = String(result.verdict || '').toUpperCase();
    await markCandidate(candidateId, verdict, result, {
      provider: 'anthropic_batch',
      input_tokens: msg.usage?.input_tokens, output_tokens: msg.usage?.output_tokens,
    });

    if (verdict === 'SAME') {
      const { survivorId, absorbedId } = pickSurvivorFromPair(pair, result);
      try {
        const outcome = await applySame(survivorId, absorbedId, result, candidateId);
        if (outcome === 'merged') stats.merged++; else stats.stale++;
      } catch (err) { stats.errored++; await markError(candidateId, `merge: ${err.message}`); }
    } else if (verdict === 'RELATED') {
      try { await applyRelated(pair.entity_id_a, pair.entity_id_b, result); stats.related++; }
      catch (err) { stats.errored++; await markError(candidateId, `related: ${err.message}`); }
    } else if (verdict === 'DIFFERENT') { stats.different++; }
    else { stats.uncertain++; }
  }

  // Append 'applied' event so future scans ignore this batch.
  fs.appendFileSync(BATCH_LOG, JSON.stringify({
    event: 'applied', batch_id: batchId, finalized_at: new Date().toISOString(),
    via: 'reattach', stats,
  }) + '\n');

  log(`  ✓ applied: merged=${stats.merged} rel=${stats.related} diff=${stats.different} unk=${stats.uncertain} stale=${stats.stale} err=${stats.errored}`);
  return { applied: stats.merged + stats.related + stats.different + stats.uncertain };
}

// ═══════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  if (!process.env.ANTHROPIC_API_KEY) { log('FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }

  let targets;
  if (opts.batchIds.length > 0) {
    targets = opts.batchIds.map(id => ({ batch_id: id, candidate_ids: [] }));
    log(`Recovering ${targets.length} explicit batch_id(s) from CLI.`);
  } else {
    targets = scanOrphanBatches();
    log(`Found ${targets.length} orphan batch(es) in ${BATCH_LOG}`);
  }
  if (targets.length === 0) { log('Nothing to reattach.'); await pool.end(); return; }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalApplied = 0;
  for (const t of targets) {
    try {
      const r = await recoverBatch(client, t.batch_id, opts);
      totalApplied += r.applied || 0;
    } catch (err) {
      log(`  ${t.batch_id} recovery CRASHED: ${err.message.slice(0, 180)}`);
    }
  }
  log(`Done: ${totalApplied} rows applied in ${((Date.now()-t0)/1000).toFixed(0)}s`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
