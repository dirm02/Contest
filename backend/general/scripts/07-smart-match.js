#!/usr/bin/env node
/**
 * 07-smart-match.js — Keyword-overlap entity matching + concurrent LLM resolution.
 *
 * Strategy:
 *   1. Load entities, extract keywords (strip stop words, legal suffixes)
 *   2. Build inverted index: keyword → [entity IDs]
 *   3. For each entity, find others sharing ≥30% of its keywords
 *   4. Insert candidates, then LLM-review with 20+ concurrent workers
 *   5. Execute confirmed merges
 *
 * Usage:
 *   node scripts/07-smart-match.js                         # full run
 *   node scripts/07-smart-match.js --overlap 0.4           # keyword overlap threshold
 *   node scripts/07-smart-match.js --concurrency 30        # LLM workers
 *   node scripts/07-smart-match.js --skip-llm              # detect only
 *   node scripts/07-smart-match.js --merge                 # detect + LLM + merge
 */
const { pool } = require('../lib/db');
const { callLLM, availableProviders } = require('../lib/llm-review');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { overlap: 0.5, concurrency: 100, skipLlm: false, merge: false, minKeywords: 3, minShared: 2, llmOnly: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--overlap' && args[i + 1]) opts.overlap = parseFloat(args[++i]);
    if (args[i] === '--concurrency' && args[i + 1]) opts.concurrency = parseInt(args[++i], 10);
    if (args[i] === '--skip-llm') opts.skipLlm = true;
    if (args[i] === '--merge') opts.merge = true;
    if (args[i] === '--min-keywords' && args[i + 1]) opts.minKeywords = parseInt(args[++i], 10);
    if (args[i] === '--llm-only') opts.llmOnly = true;
  }
  return opts;
}

// ═══════════════════════════════════════════════════════════════
//  RETRY + SEMAPHORE
// ═══════════════════════════════════════════════════════════════

async function withRetry(fn, label = 'op', maxRetries = 8) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = (err.message || '') + (err.code || '') + (err.status || '');
      const is429 = /429|rate.limit|too.many.requests|overloaded|529/i.test(msg);
      const isNetwork = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|EAI_AGAIN|57P01|57P03|08006|08001|Connection terminated|connection error|read ECONNRESET|fetch failed|network/i.test(msg);
      const isTransient = is429 || isNetwork || /500|502|503|504/i.test(msg);
      if (!isTransient || attempt >= maxRetries) throw err;
      // 429: longer backoff (30-120s). Network: shorter (2-30s)
      const baseDelay = is429 ? 30000 : 2000;
      const maxDelay = is429 ? 120000 : 30000;
      const delay = Math.min(baseDelay * Math.pow(1.5, attempt) + Math.random() * 5000, maxDelay);
      if (is429) {
        console.warn(`  [429 backoff] ${label}: rate limited, waiting ${(delay / 1000).toFixed(0)}s (attempt ${attempt + 1}/${maxRetries})`);
      } else {
        console.warn(`  [retry] ${label}: ${err.message.slice(0, 60)}... ${(delay / 1000).toFixed(0)}s (attempt ${attempt + 1})`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() { if (this.count < this.max) { this.count++; return; } await new Promise(r => this.queue.push(r)); this.count++; }
  release() { this.count--; if (this.queue.length > 0) this.queue.shift()(); }
}

// ═══════════════════════════════════════════════════════════════
//  KEYWORD EXTRACTION
// ═══════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  'THE', 'A', 'AN', 'OF', 'AND', 'FOR', 'IN', 'TO', 'BY', 'AT', 'ON', 'OR', 'DE', 'LA', 'LE', 'LES', 'DU', 'DES', 'ET',
  'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY',
  'LP', 'LLP', 'GP', 'ULC', 'SOCIETY', 'ASSOCIATION', 'ASSN', 'FOUNDATION', 'FUND',
  'ALBERTA', 'CANADA', 'CANADIAN', 'PROVINCE', 'GOVERNMENT',
]);

function extractKeywords(normName) {
  if (!normName) return [];
  return normName.split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

// ═══════════════════════════════════════════════════════════════
//  STEP 1: LOAD + INDEX
// ═══════════════════════════════════════════════════════════════

async function loadAndIndex(minKeywords) {
  const t0 = Date.now();
  log('Loading entities...');

  const res = await withRetry(() => pool.query(`
    SELECT id, canonical_name, norm_canonical, bn_root, entity_type,
           dataset_sources, source_count
    FROM general.entities
    WHERE merged_into IS NULL AND norm_canonical IS NOT NULL AND LENGTH(norm_canonical) >= 3
    ORDER BY id
  `), 'load');

  // First pass: count keyword frequencies
  const kwFreq = new Map();
  for (const e of res.rows) {
    const keywords = extractKeywords(e.norm_canonical);
    for (const kw of keywords) kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
  }

  // Identify rare keywords (appear in < 200 entities — discriminating)
  const MAX_FREQ = 200;
  const rareKeywords = new Set();
  for (const [kw, freq] of kwFreq) {
    if (freq < MAX_FREQ && freq >= 2) rareKeywords.add(kw); // freq >= 2 means at least one possible pair
  }
  log(`  ${rareKeywords.size.toLocaleString()} rare keywords (freq 2-${MAX_FREQ}) out of ${kwFreq.size.toLocaleString()} total`);

  // Second pass: index entities using only rare keywords
  const entities = new Map();
  const invertedIndex = new Map(); // rare keyword → entityId[]
  let skipped = 0;

  for (const e of res.rows) {
    const allKeywords = extractKeywords(e.norm_canonical);
    const rareKws = allKeywords.filter(kw => rareKeywords.has(kw));
    if (rareKws.length < 1) { skipped++; continue; } // need at least 1 rare keyword

    entities.set(e.id, {
      id: e.id, canonical_name: e.canonical_name, norm_canonical: e.norm_canonical,
      bn_root: e.bn_root, entity_type: e.entity_type,
      dataset_sources: e.dataset_sources, source_count: e.source_count,
      keywords: allKeywords, rareKeywords: rareKws,
    });
    for (const kw of rareKws) {
      if (!invertedIndex.has(kw)) invertedIndex.set(kw, []);
      invertedIndex.get(kw).push(e.id);
    }
  }
  // Free raw result, keep kwFreq for IDF scoring
  res.rows.length = 0;

  log(`  ${entities.size.toLocaleString()} entities indexed, ${skipped.toLocaleString()} skipped (<${minKeywords} keywords)`);
  log(`  ${invertedIndex.size.toLocaleString()} unique keywords`);
  log(`  Loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { entities, invertedIndex, kwFreq };
}

// ═══════════════════════════════════════════════════════════════
//  STEP 2: FIND CANDIDATES VIA KEYWORD OVERLAP
// ═══════════════════════════════════════════════════════════════

async function findAndInsertCandidates(entities, invertedIndex, reviewed, overlapThreshold, opts = {}, kwFreqRef) {
  const minShared = opts.minShared || 2;
  const t0 = Date.now();
  log(`Finding + inserting candidates (overlap ≥ ${(overlapThreshold * 100).toFixed(0)}%)...`);

  let processed = 0, totalCandidates = 0, inserted = 0;
  const total = entities.size;
  const FLUSH_SIZE = 500;
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    const values = []; const params = []; let pi = 1;
    for (const c of batch) {
      values.push(`($${pi}, $${pi+1}, 'smart_match', $${pi+2})`);
      params.push(c.entity_id_a, c.entity_id_b, c.similarity);
      pi += 3;
    }
    try {
      const res = await withRetry(() => pool.query(
        `INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
        params
      ), 'insert-batch');
      inserted += res.rowCount;
    } catch (err) { log(`  Insert error: ${err.message.slice(0, 80)}`); }
    batch = [];
  }

  for (const [id, entity] of entities) {
    processed++;
    if (processed % 1000 === 0) {
      log(`  ${processed.toLocaleString()}/${total.toLocaleString()} scanned, ${totalCandidates.toLocaleString()} candidates, ${inserted.toLocaleString()} inserted`);
    }

    const rareKws = entity.rareKeywords;
    if (rareKws.length === 0) continue;

    // Use rare keywords to find candidate entities (small buckets = fast)
    const candidateIds = new Set();
    for (const kw of rareKws) {
      const bucket = invertedIndex.get(kw);
      if (!bucket) continue;
      for (const otherId of bucket) {
        if (otherId > id) candidateIds.add(otherId);
      }
    }

    // Score each candidate using IDF-weighted keyword overlap
    for (const otherId of candidateIds) {
      const other = entities.get(otherId);
      if (!other) continue;
      if (entity.bn_root && other.bn_root && entity.bn_root === other.bn_root) continue;

      // IDF-weighted overlap: rare shared keywords score higher
      const otherKwSet = new Set(other.keywords);
      let sharedWeight = 0, totalWeight = 0, sharedCount = 0;
      for (const kw of entity.keywords) {
        const freq = kwFreqRef.get(kw) || 1;
        const idf = 1 / Math.log2(freq + 1); // rare = high weight
        totalWeight += idf;
        if (otherKwSet.has(kw)) { sharedWeight += idf; sharedCount++; }
      }
      const overlap = totalWeight > 0 ? sharedWeight / totalWeight : 0;
      if (overlap < overlapThreshold) continue;
      if (sharedCount < minShared) continue;

      const lo = Math.min(id, otherId);
      const hi = Math.max(id, otherId);
      if (reviewed.has(`${lo}:${hi}`)) continue;

      totalCandidates++;
      batch.push({
        entity_id_a: lo, entity_id_b: hi,
        name_a: entity.canonical_name, name_b: other.canonical_name,
        bn_a: entity.bn_root, bn_b: other.bn_root,
        type_a: entity.entity_type, type_b: other.entity_type,
        ds_a: entity.dataset_sources, ds_b: other.dataset_sources,
        cnt_a: entity.source_count, cnt_b: other.source_count,
        similarity: Math.round(overlap * 1000) / 1000,
        shared_keywords: sharedCount,
      });

      if (batch.length >= FLUSH_SIZE) await flushBatch();
    }
    candidateIds.clear(); // free memory immediately
  }

  await flushBatch(); // final batch
  log(`  ${totalCandidates.toLocaleString()} candidates, ${inserted.toLocaleString()} inserted (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return totalCandidates;
}

// ═══════════════════════════════════════════════════════════════
//  STEP 3: LOAD REVIEWED, INSERT, LLM, MERGE (same as before)
// ═══════════════════════════════════════════════════════════════

async function loadReviewedPairs() {
  const res = await withRetry(() => pool.query(`
    SELECT LEAST(entity_id_a, entity_id_b) AS lo, GREATEST(entity_id_a, entity_id_b) AS hi
    FROM general.entity_merge_candidates
  `), 'load-reviewed');
  const reviewed = new Set();
  for (const r of res.rows) reviewed.add(`${r.lo}:${r.hi}`);
  log(`${reviewed.size.toLocaleString()} pairs already reviewed`);
  return reviewed;
}

async function insertCandidates(candidates) {
  const t0 = Date.now();
  log(`Inserting ${candidates.length.toLocaleString()} candidates...`);
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const values = []; const params = []; let pi = 1;
    for (const c of batch) {
      values.push(`($${pi}, $${pi+1}, 'smart_match', $${pi+2})`);
      params.push(c.entity_id_a, c.entity_id_b, c.similarity);
      pi += 3;
    }
    try {
      await withRetry(() => pool.query(
        `INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
        params
      ), `insert-${i}`);
      inserted += batch.length;
    } catch (err) { log(`  Insert error: ${err.message.slice(0, 80)}`); }
    if ((i + BATCH) % 5000 === 0) log(`  ${inserted.toLocaleString()} / ${candidates.length.toLocaleString()}`);
  }
  log(`  Inserted (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

function buildPrompt(c) {
  return `You are an entity resolution expert for Canadian government data. Are these the SAME organization, RELATED (parent/subsidiary), or DIFFERENT?

Entity A: "${c.name_a}"
  BN: ${c.bn_a || 'none'}, Type: ${c.type_a}, Datasets: ${(c.ds_a||[]).join(',')}, Sources: ${c.cnt_a}

Entity B: "${c.name_b}"
  BN: ${c.bn_b || 'none'}, Type: ${c.type_b}, Datasets: ${(c.ds_b||[]).join(',')}, Sources: ${c.cnt_b}

Shared keywords: ${c.shared_keywords}, Overlap: ${(c.similarity*100).toFixed(0)}%

Rules: Same BN root = SAME. "TRADE NAME OF"/"O/A"/"DBA" = SAME. Location variants = DIFFERENT unless shared BN. Parent/subsidiary = RELATED. French/English bilingual = SAME.

JSON only: {"verdict":"SAME"|"RELATED"|"DIFFERENT","confidence":0.0-1.0,"reasoning":"brief","survivor":"A"|"B"|"either"}`;
}

async function llmReview(candidates, opts) {
  const t0 = Date.now();
  const pendingRes = await withRetry(() => pool.query(
    `SELECT COUNT(*)::int AS cnt FROM general.entity_merge_candidates WHERE status = 'pending' AND candidate_method = 'smart_match'`
  ));
  const totalPending = pendingRes.rows[0].cnt;
  log(`LLM review: ${totalPending.toLocaleString()} pending`);
  if (totalPending === 0) return;

  await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates SET status = 'pending'
    WHERE status = 'llm_reviewing' AND candidate_method = 'smart_match'
      AND (reviewed_at IS NULL OR reviewed_at < NOW() - INTERVAL '5 minutes')
  `));

  const sem = new Semaphore(opts.concurrency);
  const candMap = new Map();
  for (const c of candidates) candMap.set(`${c.entity_id_a}:${c.entity_id_b}`, c);
  let reviewed = 0, same = 0, related = 0, different = 0, errored = 0;

  while (true) {
    const batch = await withRetry(() => pool.query(`
      UPDATE general.entity_merge_candidates SET status = 'llm_reviewing'
      WHERE id IN (
        SELECT id FROM general.entity_merge_candidates
        WHERE status = 'pending' AND candidate_method = 'smart_match'
        ORDER BY similarity_score DESC LIMIT 200 FOR UPDATE SKIP LOCKED
      ) RETURNING id, entity_id_a, entity_id_b, similarity_score
    `), 'claim');
    if (batch.rows.length === 0) break;

    const promises = batch.rows.map(async (row) => {
      await sem.acquire();
      try {
        const key = `${Math.min(row.entity_id_a, row.entity_id_b)}:${Math.max(row.entity_id_a, row.entity_id_b)}`;
        let c = candMap.get(key);
        if (!c) {
          const [ra, rb] = await Promise.all([
            withRetry(() => pool.query('SELECT * FROM general.entities WHERE id = $1', [row.entity_id_a])),
            withRetry(() => pool.query('SELECT * FROM general.entities WHERE id = $1', [row.entity_id_b])),
          ]);
          if (!ra.rows[0] || !rb.rows[0]) return;
          c = { name_a: ra.rows[0].canonical_name, name_b: rb.rows[0].canonical_name,
            bn_a: ra.rows[0].bn_root, bn_b: rb.rows[0].bn_root,
            type_a: ra.rows[0].entity_type, type_b: rb.rows[0].entity_type,
            ds_a: ra.rows[0].dataset_sources, ds_b: rb.rows[0].dataset_sources,
            cnt_a: ra.rows[0].source_count, cnt_b: rb.rows[0].source_count,
            similarity: row.similarity_score, shared_keywords: 0 };
        }
        const response = await withRetry(() => callLLM(buildPrompt(c), { model: 'claude-sonnet-4-6', maxTokens: 300 }), `llm-${row.id}`, 3);
        let result;
        try { result = JSON.parse(response.text.replace(/^```\w*\n?/m, '').replace(/\n?```\s*$/m, '').trim()); result._usage = response.usage; }
        catch { result = { verdict: 'UNCERTAIN', confidence: 0.5, reasoning: 'Parse error', survivor: 'either' }; }
        const statusMap = { SAME: 'same', RELATED: 'related', DIFFERENT: 'different' };
        await withRetry(() => pool.query(`
          UPDATE general.entity_merge_candidates SET status = $1, llm_verdict = $2, llm_confidence = $3, llm_reasoning = $4, llm_response = $5, llm_provider = $6, reviewed_at = NOW()
          WHERE id = $7
        `, [statusMap[result.verdict] || 'uncertain', result.verdict, result.confidence, result.reasoning, result, result._usage?.provider, row.id]));
        reviewed++;
        if (result.verdict === 'SAME') same++; else if (result.verdict === 'RELATED') related++; else if (result.verdict === 'DIFFERENT') different++;
      } catch (err) {
        errored++;
        try { await pool.query(`UPDATE general.entity_merge_candidates SET status = 'error', llm_reasoning = $1, reviewed_at = NOW() WHERE id = $2`, [err.message.slice(0, 500), row.id]); } catch {}
      } finally { sem.release(); }
    });
    await Promise.all(promises);
    const vel = ((Date.now() - t0) / 1000) > 0 ? (reviewed / ((Date.now() - t0) / 1000)).toFixed(1) : '∞';
    const eta = parseFloat(vel) > 0 ? Math.round((totalPending - reviewed) / parseFloat(vel)) : 0;
    log(`  ${reviewed}/${totalPending} (${same} same, ${related} rel, ${different} diff, ${errored} err) ${vel}/s ETA:${eta > 60 ? Math.floor(eta/60)+'m'+eta%60+'s' : eta+'s'}`);
  }
  log(`LLM complete: ${reviewed} reviewed, ${same} SAME, ${related} RELATED, ${different} DIFFERENT (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function executeMerges() {
  const t0 = Date.now();
  log('Executing merges...');
  const cands = await withRetry(() => pool.query(`
    SELECT mc.id, mc.entity_id_a, mc.entity_id_b, mc.llm_response,
      a.bn_root AS bn_a, a.source_count AS cnt_a, CASE WHEN 'cra' = ANY(a.dataset_sources) THEN 1 ELSE 0 END AS cra_a,
      b.bn_root AS bn_b, b.source_count AS cnt_b, CASE WHEN 'cra' = ANY(b.dataset_sources) THEN 1 ELSE 0 END AS cra_b
    FROM general.entity_merge_candidates mc
    JOIN general.entities a ON a.id = mc.entity_id_a
    JOIN general.entities b ON b.id = mc.entity_id_b
    WHERE mc.status = 'same' AND mc.candidate_method = 'smart_match'
      AND a.merged_into IS NULL AND b.merged_into IS NULL
      AND NOT EXISTS (SELECT 1 FROM general.entity_merges em WHERE em.candidate_id = mc.id)
  `));
  log(`  ${cands.rows.length} pairs`);
  let merged = 0, skipped = 0;
  for (const c of cands.rows) {
    const s = c.llm_response?.survivor;
    let surv, absorb;
    if (s === 'A') { surv = c.entity_id_a; absorb = c.entity_id_b; }
    else if (s === 'B') { surv = c.entity_id_b; absorb = c.entity_id_a; }
    else if (c.bn_a && !c.bn_b) { surv = c.entity_id_a; absorb = c.entity_id_b; }
    else if (c.bn_b && !c.bn_a) { surv = c.entity_id_b; absorb = c.entity_id_a; }
    else if (c.cra_a > c.cra_b) { surv = c.entity_id_a; absorb = c.entity_id_b; }
    else if (c.cnt_a >= c.cnt_b) { surv = c.entity_id_a; absorb = c.entity_id_b; }
    else { surv = c.entity_id_b; absorb = c.entity_id_a; }
    try {
      const check = await pool.query('SELECT merged_into FROM general.entities WHERE id = $1', [absorb]);
      if (check.rows[0]?.merged_into) { skipped++; continue; }
      await withRetry(async () => {
        await pool.query('BEGIN');
        await pool.query(`UPDATE general.entities SET alternate_names = (SELECT array_agg(DISTINCT n) FROM (SELECT unnest(alternate_names) AS n FROM general.entities WHERE id = $1 UNION SELECT unnest(alternate_names) FROM general.entities WHERE id = $2 UNION SELECT canonical_name FROM general.entities WHERE id = $2) sub WHERE n IS NOT NULL), bn_root = COALESCE(bn_root, (SELECT bn_root FROM general.entities WHERE id = $2)), dataset_sources = (SELECT array_agg(DISTINCT s) FROM (SELECT unnest(dataset_sources) AS s FROM general.entities WHERE id = $1 UNION SELECT unnest(dataset_sources) FROM general.entities WHERE id = $2) sub WHERE s IS NOT NULL), updated_at = NOW() WHERE id = $1`, [surv, absorb]);
        await pool.query('UPDATE general.entity_source_links SET entity_id = $1 WHERE entity_id = $2', [surv, absorb]);
        await pool.query(`UPDATE general.entities SET status = 'merged', merged_into = $1, updated_at = NOW() WHERE id = $2`, [surv, absorb]);
        await pool.query(`INSERT INTO general.entity_merges (survivor_id, absorbed_id, candidate_id, merge_method) VALUES ($1, $2, $3, 'smart_match')`, [surv, absorb, c.id]);
        await pool.query('COMMIT');
      }, `merge-${c.id}`);
      merged++;
      if (merged % 100 === 0) log(`  ${merged} merged, ${skipped} skipped`);
    } catch (err) { try { await pool.query('ROLLBACK'); } catch {} log(`  Error: ${err.message.slice(0, 80)}`); }
  }
  log(`  ${merged} merged, ${skipped} skipped (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();
  log(`Smart Match v2 — Keyword overlap ≥ ${(opts.overlap*100).toFixed(0)}%, concurrency: ${opts.concurrency}`);

  if (!opts.llmOnly) {
    const { entities, invertedIndex, kwFreq } = await loadAndIndex(opts.minKeywords);
    const reviewed = await loadReviewedPairs();
    const totalCandidates = await findAndInsertCandidates(entities, invertedIndex, reviewed, opts.overlap, opts, kwFreq);
    invertedIndex.clear();
  }

  if (!opts.skipLlm) {
    // LLM review — doesn't need entities in memory, fetches from DB per-pair
    await llmReview([], opts);
  }
  if (opts.merge) await executeMerges();

  const stats = await withRetry(() => pool.query(`SELECT status, COUNT(*)::int AS cnt FROM general.entity_merge_candidates WHERE candidate_method = 'smart_match' GROUP BY status ORDER BY status`));
  log('\nSmart Match Summary:');
  for (const r of (stats?.rows || [])) log(`  ${r.status.padEnd(12)} ${r.cnt.toLocaleString()}`);
  const active = await withRetry(() => pool.query(`SELECT COUNT(*)::int AS cnt FROM general.entities WHERE merged_into IS NULL`));
  log(`Active entities: ${active.rows[0].cnt.toLocaleString()}`);
  log(`Total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
