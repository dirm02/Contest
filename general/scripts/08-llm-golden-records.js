#!/usr/bin/env node
/**
 * 08-llm-golden-records.js — Final LLM pass that AUTHORS golden records.
 *
 * Takes pending `entity_merge_candidates` (produced by 07-smart-match.js) and,
 * at 100 concurrency, asks Claude to decide SAME / RELATED / DIFFERENT AND to
 * author the resulting golden record content:
 *   - canonical_name (authored, tie-broken)
 *   - entity_type
 *   - merged aliases list
 *   - addresses
 *   - reasoning
 *   - chosen survivor
 *
 * On SAME: merges entities in general.entities, transfers source links,
 *          updates general.entity_golden_records for the survivor with
 *          LLM-authored fields, marks absorbed record as merged.
 * On RELATED: cross-links the two golden records in `related_entities`.
 * On DIFFERENT: records verdict only.
 *
 * Resilient to crashes: claims batches via FOR UPDATE SKIP LOCKED and resets
 * stale `llm_reviewing` rows on startup. 429 backoff (30-120s) plus network
 * retry (2-30s). Safe to re-run with --resume.
 *
 * Usage:
 *   node scripts/08-llm-golden-records.js                     # full run, concurrency 100
 *   node scripts/08-llm-golden-records.js --concurrency 50    # custom concurrency
 *   node scripts/08-llm-golden-records.js --limit 1000        # stop after N pairs
 *   node scripts/08-llm-golden-records.js --method smart_match
 *   node scripts/08-llm-golden-records.js --dry-run           # LLM only, no merges
 */
const { pool } = require('../lib/db');
const { callLLM } = require('../lib/llm-review');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { concurrency: 100, limit: 0, method: null, dryRun: false, maxRetries: 8, staleMinutes: 10, provider: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--concurrency' && args[i + 1]) opts.concurrency = parseInt(args[++i], 10);
    else if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (args[i] === '--method' && args[i + 1]) opts.method = args[++i];
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--max-retries' && args[i + 1]) opts.maxRetries = parseInt(args[++i], 10);
    else if (args[i] === '--stale-minutes' && args[i + 1]) opts.staleMinutes = parseInt(args[++i], 10);
    else if (args[i] === '--provider' && args[i + 1]) opts.provider = args[++i];
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
      const isNetwork = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|EAI_AGAIN|57P01|57P03|08006|08001|Connection terminated|connection error|fetch failed|network/i.test(msg);
      const isTransient = is429 || isNetwork || /\b5\d\d\b/.test(msg);
      if (!isTransient || attempt >= maxRetries) throw err;
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
//  ENTITY CONTEXT LOADER
// ═══════════════════════════════════════════════════════════════

async function loadEntityContext(entityId) {
  const r = await withRetry(() => pool.query(`
    SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
           e.bn_variants, e.alternate_names, e.dataset_sources, e.source_count,
           e.metadata, e.merged_into,
           -- Pull up to 30 DISTINCT-NAMED source samples so the LLM sees the
           -- full alias surface across all datasets, not just 8 dupes of the
           -- same name. DISTINCT ON (source_name) keeps one representative per
           -- unique variant — that's what the LLM actually needs to author the
           -- alias list.
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

// ═══════════════════════════════════════════════════════════════
//  PROMPT — ask LLM to VOTE and AUTHOR the golden record
// ═══════════════════════════════════════════════════════════════

function buildPrompt(a, b, similarity) {
  const fmt = (e) => {
    // Show up to 30 samples — enough for large entities (dioceses, universities)
    // to see the range of name variants without exploding the prompt.
    const samples = (e.link_samples || []).slice(0, 30).map(s =>
      `      "${(s.name || '').slice(0, 120)}" [${s.schema}.${s.table}] (${s.method})`
    ).join('\n');
    // Include all alternate_names (not just first 10) so the LLM has the full
    // alias surface to choose from when authoring the golden record.
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
//  APPLY LLM RESULT — single transaction per pair
// ═══════════════════════════════════════════════════════════════

async function applySame(survivorId, absorbedId, result, candidateId) {
  const client = await pool.connect();
  // Render DB occasionally drops pooled connections. Without this listener the
  // Client emits an unhandled 'error' event → node hard-exits. `once` avoids
  // the MaxListeners warning on pooled clients that get recycled across many
  // applySame() calls. The next query on this client rejects, handled below.
  client.once('error', (e) => { console.error(`  [applySame client error suppressed]: ${e.message}`); });
  try {
    await client.query('BEGIN');

    // Guard: re-check both still active (another worker may have merged already).
    const guard = await client.query(
      'SELECT id, merged_into FROM general.entities WHERE id = ANY($1::int[]) FOR UPDATE',
      [[survivorId, absorbedId]]
    );
    const byId = new Map(guard.rows.map(r => [r.id, r]));
    if (!byId.get(survivorId) || !byId.get(absorbedId)) { await client.query('ROLLBACK'); return 'missing'; }
    if (byId.get(survivorId).merged_into || byId.get(absorbedId).merged_into) { await client.query('ROLLBACK'); return 'already_merged'; }

    const authoredName = (result.canonical_name && String(result.canonical_name).trim()) || null;
    const authoredType = (result.entity_type && String(result.entity_type).trim()) || null;
    // Accept up to 100 aliases — matches the prompt's "no hard upper bound"
    // instruction. 100 is a safety ceiling against LLM hallucination.
    const aliasesFromLlm = Array.isArray(result.aliases) ? result.aliases.filter(Boolean).map(String).slice(0, 100) : [];

    // Merge survivor's fields with absorbed's, inject LLM-authored canonical + type.
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

    // Transfer source links.
    const linkRes = await client.query(
      'UPDATE general.entity_source_links SET entity_id = $1 WHERE entity_id = $2',
      [survivorId, absorbedId]
    );

    // Soft-delete absorbed.
    await client.query(
      `UPDATE general.entities SET status = 'merged', merged_into = $1, updated_at = NOW() WHERE id = $2`,
      [survivorId, absorbedId]
    );

    // Audit trail.
    await client.query(`
      INSERT INTO general.entity_merges
        (survivor_id, absorbed_id, candidate_id, merge_method, metadata_merged, links_redirected, merged_by)
      VALUES ($1, $2, $3, 'llm_golden_records', $4, $5, 'llm')
    `, [survivorId, absorbedId, candidateId, result, linkRes.rowCount]);

    // Golden record: UPSERT survivor with LLM-authored content.
    await client.query(`
      INSERT INTO general.entity_golden_records
        (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, aliases,
         dataset_sources, llm_authored, confidence, status, updated_at)
      SELECT
        e.id,
        COALESCE($2, e.canonical_name),
        COALESCE(e.norm_canonical, general.norm_name(COALESCE($2, e.canonical_name))),
        COALESCE($3, e.entity_type),
        e.bn_root,
        COALESCE(e.bn_variants, '{}'),
        (
          SELECT jsonb_agg(DISTINCT jsonb_build_object('name', n, 'source', 'llm'))
          FROM unnest($4::text[]) AS n WHERE n IS NOT NULL AND length(trim(n)) > 0
        ),
        COALESCE(e.dataset_sources, '{}'),
        $5::jsonb,
        GREATEST(COALESCE(e.confidence, 0), $6),
        'active',
        NOW()
      FROM general.entities e
      WHERE e.id = $1
      ON CONFLICT (id) DO UPDATE SET
        canonical_name = EXCLUDED.canonical_name,
        entity_type    = EXCLUDED.entity_type,
        bn_root        = EXCLUDED.bn_root,
        bn_variants    = EXCLUDED.bn_variants,
        dataset_sources = EXCLUDED.dataset_sources,
        aliases = (
          SELECT jsonb_agg(DISTINCT x) FROM (
            SELECT jsonb_array_elements(general.entity_golden_records.aliases) AS x
            UNION
            SELECT jsonb_array_elements(EXCLUDED.aliases)
          ) y WHERE x IS NOT NULL
        ),
        llm_authored   = EXCLUDED.llm_authored,
        confidence     = EXCLUDED.confidence,
        status         = 'active',
        updated_at     = NOW()
    `, [survivorId, authoredName, authoredType, aliasesFromLlm, result, Number(result.confidence) || 0]);

    // Mark absorbed's golden record as merged (soft delete — preserves
    // the audit trail inside the table itself). The final
    // `09-build-golden-records.js` refresh step collapses these via its
    // Step 0 DELETE when the pipeline completes.
    await client.query(`
      UPDATE general.entity_golden_records
         SET status = 'merged', updated_at = NOW()
       WHERE id = $1
    `, [absorbedId]);

    await client.query('COMMIT');
    return 'merged';
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function applyRelated(idA, idB, result) {
  const client = await pool.connect();
  client.once('error', (e) => { console.error(`  [applyRelated client error suppressed]: ${e.message}`); });
  try {
    await client.query('BEGIN');

    const names = await client.query(
      'SELECT id, canonical_name FROM general.entities WHERE id = ANY($1::int[])',
      [[idA, idB]]
    );
    const nm = new Map(names.rows.map(r => [r.id, r.canonical_name]));

    const addRelation = async (self, other) => {
      const rel = {
        entity_id: other,
        name: nm.get(other) || null,
        relationship: 'RELATED',
        reasoning: String(result.reasoning || '').slice(0, 500),
        confidence: Number(result.confidence) || 0,
      };
      // Ensure a golden record row exists (seed from entities if missing).
      await client.query(`
        INSERT INTO general.entity_golden_records (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, dataset_sources, confidence, status)
        SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
               COALESCE(e.bn_variants,'{}'), COALESCE(e.dataset_sources,'{}'), e.confidence, 'active'
        FROM general.entities e WHERE e.id = $1
        ON CONFLICT (id) DO NOTHING
      `, [self]);

      await client.query(`
        UPDATE general.entity_golden_records
           SET related_entities = COALESCE(related_entities, '[]'::jsonb) || $2::jsonb,
               updated_at = NOW()
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
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN WORKER LOOP
// ═══════════════════════════════════════════════════════════════

async function resetStale(staleMinutes, method) {
  const methodFilter = method ? `AND candidate_method = '${method}'` : '';
  const res = await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = 'pending'
     WHERE status = 'llm_reviewing'
       ${methodFilter}
       AND (reviewed_at IS NULL OR reviewed_at < NOW() - INTERVAL '${staleMinutes} minutes')
  `), 'reset-stale');
  if (res.rowCount > 0) log(`Reset ${res.rowCount.toLocaleString()} stale llm_reviewing -> pending`);
}

async function claimBatch(size, method) {
  const params = [size];
  let filter = `status = 'pending'`;
  if (method) { filter += ` AND candidate_method = $2`; params.push(method); }
  const res = await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates mc
       SET status = 'llm_reviewing', reviewed_at = NOW()
     WHERE id IN (
       SELECT id FROM general.entity_merge_candidates
        WHERE ${filter}
        ORDER BY similarity_score DESC NULLS LAST, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, entity_id_a, entity_id_b, similarity_score, candidate_method
  `, params), 'claim');
  return res.rows;
}

async function markCandidate(id, verdict, result, providerInfo) {
  const statusMap = { SAME: 'same', RELATED: 'related', DIFFERENT: 'different' };
  await withRetry(() => pool.query(`
    UPDATE general.entity_merge_candidates
       SET status = $1,
           llm_verdict = $2,
           llm_confidence = $3,
           llm_reasoning = $4,
           llm_response = $5,
           llm_provider = $6,
           llm_tokens_in = $7,
           llm_tokens_out = $8,
           reviewed_at = NOW()
     WHERE id = $9
  `, [
    statusMap[verdict] || 'uncertain',
    verdict,
    Number(result.confidence) || null,
    String(result.reasoning || '').slice(0, 500),
    result,
    providerInfo?.provider || null,
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

async function processPair(row, opts, stats) {
  const [a, b] = await Promise.all([
    loadEntityContext(row.entity_id_a),
    loadEntityContext(row.entity_id_b),
  ]);
  if (!a || !b) { await markError(row.id, 'entity not found'); stats.errored++; return; }
  if (a.merged_into || b.merged_into) {
    // One side already merged; just record as different to drop from queue.
    await markCandidate(row.id, 'DIFFERENT', { reasoning: 'one side already merged', confidence: 0 }, {});
    stats.stale++; return;
  }

  const prompt = buildPrompt(a, b, row.similarity_score || 0);
  // Higher maxTokens so the LLM can return the full deduplicated alias list for
  // large entities (universities, dioceses, federations) that accumulate 30-50+
  // name variants across datasets. 600 tokens truncated these responses.
  const llmOpts = { model: 'claude-sonnet-4-6', maxTokens: 8000 };
  if (opts.provider) llmOpts.forceProvider = opts.provider;
  const response = await withRetry(
    () => callLLM(prompt, llmOpts),
    `llm-${row.id}`,
    opts.maxRetries
  );

  let result;
  try { result = parseJson(response.text); }
  catch { result = { verdict: 'UNCERTAIN', confidence: 0.3, reasoning: 'parse error' }; }

  const verdict = String(result.verdict || '').toUpperCase();
  await markCandidate(row.id, verdict, result, response.usage);

  if (opts.dryRun) { stats.dryRun++; return; }

  if (verdict === 'SAME') {
    // Pick survivor based on LLM hint + deterministic tiebreak.
    let survivorId, absorbedId;
    const sHint = String(result.survivor || '').toUpperCase();
    if (sHint === 'A')      { survivorId = a.id; absorbedId = b.id; }
    else if (sHint === 'B') { survivorId = b.id; absorbedId = a.id; }
    else {
      // Deterministic tiebreak: has BN > more links > lower id.
      const score = (e) => (e.bn_root ? 2 : 0) + (e.link_count > (survivorId ? 0 : 0) ? 1 : 0);
      const aScore = (a.bn_root ? 2 : 0) + Math.min(a.link_count || 0, 1);
      const bScore = (b.bn_root ? 2 : 0) + Math.min(b.link_count || 0, 1);
      if (aScore > bScore) { survivorId = a.id; absorbedId = b.id; }
      else if (bScore > aScore) { survivorId = b.id; absorbedId = a.id; }
      else if ((a.link_count || 0) >= (b.link_count || 0)) { survivorId = a.id; absorbedId = b.id; }
      else { survivorId = b.id; absorbedId = a.id; }
    }

    try {
      const outcome = await applySame(survivorId, absorbedId, result, row.id);
      if (outcome === 'merged') stats.merged++;
      else stats.stale++;
    } catch (err) {
      stats.errored++;
      await markError(row.id, `merge failed: ${err.message}`);
    }
  } else if (verdict === 'RELATED') {
    try { await applyRelated(a.id, b.id, result); stats.related++; }
    catch (err) { stats.errored++; await markError(row.id, `related failed: ${err.message}`); }
  } else if (verdict === 'DIFFERENT') {
    stats.different++;
  } else {
    stats.uncertain++;
  }
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  log(`LLM Golden Records — concurrency: ${opts.concurrency}${opts.method ? ', method: ' + opts.method : ''}${opts.dryRun ? ' [DRY RUN]' : ''}`);

  await resetStale(opts.staleMinutes, opts.method);

  const countRes = await withRetry(() => pool.query(`
    SELECT COUNT(*)::int AS cnt FROM general.entity_merge_candidates
     WHERE status = 'pending'${opts.method ? ` AND candidate_method = '${opts.method}'` : ''}
  `));
  let totalPending = countRes.rows[0].cnt;
  if (opts.limit > 0) totalPending = Math.min(totalPending, opts.limit);
  log(`${totalPending.toLocaleString()} pending candidates to review`);
  if (totalPending === 0) { await pool.end(); return; }

  const sem = new Semaphore(opts.concurrency);
  const stats = { reviewed: 0, merged: 0, related: 0, different: 0, uncertain: 0, stale: 0, errored: 0, dryRun: 0 };
  let processed = 0;
  const CLAIM_SIZE = Math.max(opts.concurrency * 2, 200);

  while (true) {
    if (opts.limit && processed >= opts.limit) break;
    const remaining = opts.limit ? (opts.limit - processed) : CLAIM_SIZE;
    const claimSize = Math.min(CLAIM_SIZE, remaining);
    const batch = await claimBatch(claimSize, opts.method);
    if (batch.length === 0) break;

    const promises = batch.map(async (row) => {
      await sem.acquire();
      try {
        await processPair(row, opts, stats);
      } catch (err) {
        stats.errored++;
        await markError(row.id, err.message || String(err));
      } finally {
        stats.reviewed++;
        processed++;
        sem.release();
      }
    });
    await Promise.all(promises);

    const elapsed = (Date.now() - t0) / 1000;
    const velocity = elapsed > 0 ? (stats.reviewed / elapsed) : 0;
    const etaSec = velocity > 0 ? Math.round((totalPending - stats.reviewed) / velocity) : 0;
    const eta = etaSec > 60 ? `${Math.floor(etaSec / 60)}m${etaSec % 60}s` : `${etaSec}s`;
    log(`  ${stats.reviewed.toLocaleString()}/${totalPending.toLocaleString()} | merged:${stats.merged} related:${stats.related} diff:${stats.different} unc:${stats.uncertain} stale:${stats.stale} err:${stats.errored} | ${velocity.toFixed(1)}/s ETA:${eta}`);
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`\nDone in ${dur}s`);
  log(`  reviewed:   ${stats.reviewed.toLocaleString()}`);
  log(`  merged:     ${stats.merged.toLocaleString()}`);
  log(`  related:    ${stats.related.toLocaleString()}`);
  log(`  different:  ${stats.different.toLocaleString()}`);
  log(`  uncertain:  ${stats.uncertain.toLocaleString()}`);
  log(`  stale:      ${stats.stale.toLocaleString()}`);
  log(`  errored:    ${stats.errored.toLocaleString()}`);

  const active = await withRetry(() => pool.query(`SELECT COUNT(*)::int AS cnt FROM general.entities WHERE merged_into IS NULL`));
  const golden = await withRetry(() => pool.query(`SELECT COUNT(*)::int AS cnt FROM general.entity_golden_records WHERE status = 'active'`));
  log(`  active entities: ${active.rows[0].cnt.toLocaleString()}`);
  log(`  active golden:   ${golden.rows[0].cnt.toLocaleString()}`);

  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
