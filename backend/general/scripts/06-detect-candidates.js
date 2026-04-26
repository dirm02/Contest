#!/usr/bin/env node
/**
 * 06-detect-candidates.js — Find potential duplicate entity pairs for LLM review.
 *
 * Runs 5 tiers of candidate detection, each feeding entity_merge_candidates:
 *   Tier 1 — same norm_canonical (exact-after-normalization name match)
 *   Tier 2 — same bn_root (different entities sharing a registered BN)
 *   Tier 3 — TRADE NAME OF / DBA / O/A pattern extraction
 *   Tier 4 — trigram similarity (pg_trgm, threshold 0.65) — fuzzy name match
 *   Tier 5 — Splink probabilistic matches (run `npm run entities:splink` first)
 *
 * Tiers 1+2 auto-merge safely under --auto-merge (BN-conflict guards prevent
 * collapsing distinct CRA-registered charities that happen to share a name).
 *
 * Usage:
 *   node scripts/06-detect-candidates.js                  # all tiers, detect only
 *   node scripts/06-detect-candidates.js --auto-merge     # + auto-merge Tiers 1-2
 *   node scripts/06-detect-candidates.js --tier 5         # Splink tier only
 */
const { pool } = require('../lib/db');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(tier, msg) { console.log(`[${ts()}] [T${tier}] ${msg}`); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { autoMerge: false, tier: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auto-merge') opts.autoMerge = true;
    if (args[i] === '--tier' && args[i + 1]) opts.tier = parseInt(args[++i], 10);
  }
  return opts;
}

async function tier1_normName(client) {
  const t0 = Date.now();
  log(1, '── Same norm_name across entities ──');

  // Populate norm_canonical if missing
  const popRes = await client.query(`
    UPDATE general.entities SET norm_canonical = general.norm_name(canonical_name)
    WHERE norm_canonical IS NULL AND merged_into IS NULL
  `);
  if (popRes.rowCount > 0) log(1, `  Populated norm_canonical: ${popRes.rowCount.toLocaleString()}`);

  // Candidates pair up entities with the same normalized name.
  // BN conflict rule: if both sides have a bn_root and they differ, they are
  // distinct registered charities — short-circuit to status='different'
  // instead of generating an LLM candidate.
  // Short-circuit to 'different' only when BOTH entities are CRA-sourced and carry
  // different valid bn_roots. CRA assigns exactly one Business Number per registered
  // charity, so two distinct CRA BNs guarantee two distinct legal entities. For all
  // other cross-system pairs (e.g. FED corp number vs CRA BN for the same org),
  // defer to the LLM — the registration numbers may differ but the entity may not.
  const res = await client.query(`
    INSERT INTO general.entity_merge_candidates
      (entity_id_a, entity_id_b, candidate_method, similarity_score, status, llm_verdict, llm_reasoning)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'norm_name', 1.0,
           CASE WHEN 'cra' = ANY(a.dataset_sources) AND 'cra' = ANY(b.dataset_sources)
                 AND general.is_valid_bn_root(a.bn_root)
                 AND general.is_valid_bn_root(b.bn_root)
                 AND a.bn_root != b.bn_root
                THEN 'different' ELSE 'pending' END,
           CASE WHEN 'cra' = ANY(a.dataset_sources) AND 'cra' = ANY(b.dataset_sources)
                 AND general.is_valid_bn_root(a.bn_root)
                 AND general.is_valid_bn_root(b.bn_root)
                 AND a.bn_root != b.bn_root
                THEN 'DIFFERENT' ELSE NULL END,
           CASE WHEN 'cra' = ANY(a.dataset_sources) AND 'cra' = ANY(b.dataset_sources)
                 AND general.is_valid_bn_root(a.bn_root)
                 AND general.is_valid_bn_root(b.bn_root)
                 AND a.bn_root != b.bn_root
                THEN 'BN conflict: two distinct CRA-registered charities with different Business Numbers.' ELSE NULL END
    FROM general.entities a
    JOIN general.entities b ON a.norm_canonical = b.norm_canonical
    WHERE a.id < b.id
      AND a.merged_into IS NULL AND b.merged_into IS NULL
      AND a.norm_canonical IS NOT NULL AND a.norm_canonical != ''
      AND LENGTH(a.norm_canonical) >= 3
    ON CONFLICT DO NOTHING
  `);
  log(1, `  Candidates: ${res.rowCount.toLocaleString()} pairs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return res.rowCount;
}

async function tier2_sharedBN(client) {
  const t0 = Date.now();
  log(2, '── Same BN root, separate entities ──');

  // Exclude placeholder BNs via general.is_valid_bn_root() — placeholder BNs
  // are sentinel "no BN" values, not real shared identifiers. Joining on them
  // generates combinatorial false pairs (1107 × 1106 / 2 = 612K in earlier runs).
  const res = await client.query(`
    INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'shared_bn', 0.99
    FROM general.entities a
    JOIN general.entities b ON a.bn_root = b.bn_root
    WHERE a.id < b.id
      AND general.is_valid_bn_root(a.bn_root)
      AND a.merged_into IS NULL AND b.merged_into IS NULL
    ON CONFLICT DO NOTHING
  `);
  log(2, `  Candidates: ${res.rowCount.toLocaleString()} pairs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return res.rowCount;
}

async function tier3_tradeName(client) {
  const t0 = Date.now();
  log(3, '── TRADE NAME OF extraction ──');

  // First part of "X TRADE NAME OF Y" matches entity Y
  const res1 = await client.query(`
    INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'trade_name', 0.90
    FROM general.entities a
    JOIN general.entities b ON general.norm_name(split_part(UPPER(a.canonical_name), 'TRADE NAME OF', 2)) = b.norm_canonical
    WHERE a.id != b.id
      AND UPPER(a.canonical_name) LIKE '%TRADE NAME OF%'
      AND a.merged_into IS NULL AND b.merged_into IS NULL
      AND general.norm_name(split_part(UPPER(a.canonical_name), 'TRADE NAME OF', 2)) != ''
    ON CONFLICT DO NOTHING
  `);
  log(3, `  Trade-name (2nd part): ${res1.rowCount.toLocaleString()} pairs`);

  // First part matches another entity
  const res2 = await client.query(`
    INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'trade_name_fwd', 0.88
    FROM general.entities a
    JOIN general.entities b ON general.norm_name(split_part(UPPER(a.canonical_name), 'TRADE NAME OF', 1)) = b.norm_canonical
    WHERE a.id != b.id
      AND UPPER(a.canonical_name) LIKE '%TRADE NAME OF%'
      AND a.merged_into IS NULL AND b.merged_into IS NULL
      AND general.norm_name(split_part(UPPER(a.canonical_name), 'TRADE NAME OF', 1)) != ''
    ON CONFLICT DO NOTHING
  `);
  log(3, `  Trade-name (1st part): ${res2.rowCount.toLocaleString()} pairs`);

  // Also handle O/A and DBA patterns
  const res3 = await client.query(`
    INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score)
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'dba_oa', 0.88
    FROM general.entities a
    JOIN general.entities b ON general.norm_name(
      CASE
        WHEN UPPER(a.canonical_name) LIKE '% O/A %' THEN split_part(UPPER(a.canonical_name), ' O/A ', 2)
        WHEN UPPER(a.canonical_name) LIKE '% DBA %' THEN split_part(UPPER(a.canonical_name), ' DBA ', 2)
        ELSE NULL
      END
    ) = b.norm_canonical
    WHERE a.id != b.id
      AND (UPPER(a.canonical_name) LIKE '% O/A %' OR UPPER(a.canonical_name) LIKE '% DBA %')
      AND a.merged_into IS NULL AND b.merged_into IS NULL
    ON CONFLICT DO NOTHING
  `);
  log(3, `  DBA/O/A: ${res3.rowCount.toLocaleString()} pairs`);

  const total = res1.rowCount + res2.rowCount + res3.rowCount;
  log(3, `  Total: ${total.toLocaleString()} pairs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return total;
}

// Tier 5 — Splink probabilistic matches.
//
// Reads general.splink_predictions (populated by scripts/splink/run_splink.py)
// and maps each prediction's left/right records back to our entities via
// entity_source_links. Pairs where both sides resolve to our entities, the two
// entities differ, and the match_probability is in the [0.40, 0.95] review band
// become candidates with method='splink_match'. Pairs above 0.95 are high
// confidence (and would also typically appear in our deterministic tiers); pairs
// below 0.40 are noise.
//
// This tier fills the gap our trigram/exact cascade can't: hierarchical
// religious orgs, truncated FED variants, no-BN multi-dataset matches where
// Splink's probabilistic weighting of (name + city + postal_code + entity_type)
// surfaces a match we wouldn't see from name similarity alone.
async function tier5_splinkMatch(client) {
  const t0 = Date.now();
  log(5, '── Splink probabilistic matches ──');

  // Check splink_predictions is populated
  const { rows: [{ c }] } = await client.query(
    `SELECT COUNT(*)::int AS c FROM general.splink_predictions`
  );
  if (c === 0) {
    log(5, '  splink_predictions is empty — did you run `npm run splink`? (skipping tier)');
    return 0;
  }
  log(5, `  ${c.toLocaleString()} splink predictions available`);

  // Map splink source_dataset → (our source_schema, our source_table, pk-extraction expression)
  //
  // Splink's record_id on each side can be joined back to our
  // entity_source_links.source_pk JSONB. The key under which Splink stored the
  // id varies by dataset:
  //   - fed:               Splink id = make_id(fed, bn, name) — 12 char hash,
  //                        not directly comparable. Fallback via (source_schema,
  //                        source_name) → entity via entity_resolution_log.
  //   - cra:               Splink id = the 15-char BN (e.g. 118814391RR0001) →
  //                        source_pk->>'bn_root' matches LEFT(splink_id, 9).
  //   - ab_non_profit:     Splink id = ab_non_profit.id (uuid) →
  //                        source_pk->>'id' matches directly.
  //   - ab_grants:         Splink id = make_id hash of recipient name →
  //                        fallback via source_name.
  //   - ab_contracts:      same as ab_grants.
  //   - ab_sole_source:    same.
  //
  // For the hash-based datasets (fed, ab_grants, ab_contracts, ab_sole_source)
  // we match by source_name — Splink preserves the legal_name in the parquet
  // which is what our entity_source_links stores as source_name.

  const res = await client.query(`
    WITH splink_pairs AS (
      SELECT p.source_l, p.record_l, p.source_r, p.record_r,
             p.match_probability, p.cluster_id
      FROM general.splink_predictions p
      WHERE p.match_probability >= 0.40 AND p.match_probability <= 0.95
    ),
    -- Resolve left record → entity. CRA uses bn_root; AB non-profit uses uuid id;
    -- all others fall back to source_name lookup via the resolution log.
    resolved_l AS (
      SELECT sp.*, COALESCE(
        (SELECT entity_id FROM general.entity_source_links sl
         WHERE sl.source_schema = 'cra' AND sp.source_l = 'cra'
           AND sl.source_pk->>'bn_root' = LEFT(sp.record_l, 9)
         LIMIT 1),
        (SELECT entity_id FROM general.entity_source_links sl
         WHERE sl.source_schema = 'ab' AND sl.source_table = 'ab_non_profit'
           AND sp.source_l = 'ab_non_profit'
           AND sl.source_pk->>'id' = sp.record_l
         LIMIT 1),
        (SELECT rl.entity_id FROM general.entity_resolution_log rl
         WHERE rl.source_schema =
               CASE WHEN sp.source_l LIKE 'ab%' THEN 'ab' ELSE sp.source_l END
           AND rl.source_table =
               CASE WHEN sp.source_l = 'fed' THEN 'grants_contributions'
                    WHEN sp.source_l LIKE 'ab_%' THEN SUBSTRING(sp.source_l FROM 1)
                    ELSE sp.source_l END
           AND rl.entity_id IS NOT NULL
         LIMIT 1)
      ) AS entity_l
      FROM splink_pairs sp
    ),
    resolved AS (
      SELECT rl.*, COALESCE(
        (SELECT entity_id FROM general.entity_source_links sl
         WHERE sl.source_schema = 'cra' AND rl.source_r = 'cra'
           AND sl.source_pk->>'bn_root' = LEFT(rl.record_r, 9)
         LIMIT 1),
        (SELECT entity_id FROM general.entity_source_links sl
         WHERE sl.source_schema = 'ab' AND sl.source_table = 'ab_non_profit'
           AND rl.source_r = 'ab_non_profit'
           AND sl.source_pk->>'id' = rl.record_r
         LIMIT 1)
      ) AS entity_r
      FROM resolved_l rl
    )
    INSERT INTO general.entity_merge_candidates
      (entity_id_a, entity_id_b, candidate_method, similarity_score)
    SELECT LEAST(entity_l, entity_r), GREATEST(entity_l, entity_r),
           'splink_match', match_probability
    FROM resolved
    WHERE entity_l IS NOT NULL AND entity_r IS NOT NULL
      AND entity_l != entity_r
    ON CONFLICT DO NOTHING
  `);
  log(5, `  Candidates: ${res.rowCount.toLocaleString()} pairs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return res.rowCount;
}

async function tier4_trigram(client) {
  const t0 = Date.now();
  log(4, '── Trigram similarity on norm_canonical ──');

  await client.query('SET pg_trgm.similarity_threshold = 0.65');

  // Get ID range for batching
  const range = await client.query(`
    SELECT MIN(id) AS lo, MAX(id) AS hi
    FROM general.entities WHERE merged_into IS NULL
  `);
  const lo = range.rows[0].lo;
  const hi = range.rows[0].hi;
  const BATCH = 20000;
  let total = 0;

  for (let start = lo; start <= hi; start += BATCH) {
    const end = Math.min(start + BATCH - 1, hi);
    try {
      const res = await client.query(`
        INSERT INTO general.entity_merge_candidates (entity_id_a, entity_id_b, candidate_method, similarity_score)
        SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'trigram',
               similarity(a.norm_canonical, b.norm_canonical)
        FROM general.entities a
        JOIN general.entities b ON a.norm_canonical % b.norm_canonical
        WHERE a.id < b.id
          AND a.id BETWEEN $1 AND $2
          AND a.merged_into IS NULL AND b.merged_into IS NULL
          AND LENGTH(a.norm_canonical) >= 5
          AND LENGTH(b.norm_canonical) >= 5
        ON CONFLICT DO NOTHING
      `, [start, end]);
      total += res.rowCount;
      log(4, `  Batch ${start}-${end}: +${res.rowCount.toLocaleString()} (total: ${total.toLocaleString()})`);
    } catch (err) {
      log(4, `  Batch ${start}-${end}: ERROR ${err.message.slice(0, 80)}`);
    }
  }

  log(4, `  Total: ${total.toLocaleString()} pairs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return total;
}

async function autoMerge(client) {
  const t0 = Date.now();
  console.log(`\n[${ts()}] ── Auto-merging Tier 1+2 candidates ──`);

  // Get auto-mergeable candidates (norm_name and shared_bn)
  const candidates = await client.query(`
    SELECT mc.id, mc.entity_id_a, mc.entity_id_b, mc.candidate_method,
           a.canonical_name AS name_a, a.bn_root AS bn_a, a.source_count AS cnt_a,
               CASE WHEN 'cra' = ANY(a.dataset_sources) THEN 1 ELSE 0 END AS cra_a,
           b.canonical_name AS name_b, b.bn_root AS bn_b, b.source_count AS cnt_b,
               CASE WHEN 'cra' = ANY(b.dataset_sources) THEN 1 ELSE 0 END AS cra_b
    FROM general.entity_merge_candidates mc
    JOIN general.entities a ON a.id = mc.entity_id_a
    JOIN general.entities b ON b.id = mc.entity_id_b
    WHERE mc.status = 'pending'
      AND mc.candidate_method IN ('norm_name', 'shared_bn')
      AND a.merged_into IS NULL AND b.merged_into IS NULL
    ORDER BY mc.id
  `);

  console.log(`  ${candidates.rows.length.toLocaleString()} candidates to auto-merge`);
  let merged = 0, skipped = 0, bnConflicts = 0;

  // isValidBnRoot matches general.is_valid_bn_root() in bn_helpers.sql.
  // Keep these two in sync.
  const isValidBnRoot = (bn) => !!bn && bn.length >= 9
      && !/^[0-9]0{8}/.test(bn) && !/^0{3,}/.test(bn);
  for (const c of candidates.rows) {
    // CRA assigns one BN per registered charity. If both entities are CRA-sourced
    // with different real BNs, they are definitively distinct charities — never
    // auto-merge. Cross-system pairs (FED corp vs CRA) still flow to LLM review.
    const realBnA = isValidBnRoot(c.bn_a) ? c.bn_a : null;
    const realBnB = isValidBnRoot(c.bn_b) ? c.bn_b : null;
    if (c.cra_a && c.cra_b && realBnA && realBnB && realBnA !== realBnB) {
      await client.query(
        `UPDATE general.entity_merge_candidates
           SET status = 'different', llm_verdict = 'DIFFERENT',
               llm_reasoning = 'BN conflict: distinct registered charities with different CRA Business Numbers.',
               reviewed_at = NOW()
         WHERE id = $1`, [c.id]
      );
      bnConflicts++;
      continue;
    }

    // Determine survivor: prefer BN > CRA source > more links > lower ID
    let survivorId, absorbedId;
    if (c.bn_a && !c.bn_b) { survivorId = c.entity_id_a; absorbedId = c.entity_id_b; }
    else if (c.bn_b && !c.bn_a) { survivorId = c.entity_id_b; absorbedId = c.entity_id_a; }
    else if (c.cra_a > c.cra_b) { survivorId = c.entity_id_a; absorbedId = c.entity_id_b; }
    else if (c.cra_b > c.cra_a) { survivorId = c.entity_id_b; absorbedId = c.entity_id_a; }
    else if (c.cnt_a >= c.cnt_b) { survivorId = c.entity_id_a; absorbedId = c.entity_id_b; }
    else { survivorId = c.entity_id_b; absorbedId = c.entity_id_a; }

    try {
      // Check not already merged
      const check = await client.query(
        'SELECT merged_into FROM general.entities WHERE id = $1', [absorbedId]
      );
      if (check.rows[0]?.merged_into) { skipped++; continue; }

      // Merge alternate names
      await client.query(`
        UPDATE general.entities SET
          alternate_names = (
            SELECT array_agg(DISTINCT n) FROM (
              SELECT unnest(alternate_names) AS n FROM general.entities WHERE id = $1
              UNION SELECT unnest(alternate_names) FROM general.entities WHERE id = $2
              UNION SELECT canonical_name FROM general.entities WHERE id = $2
            ) sub WHERE n IS NOT NULL
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
          source_count = source_count + (SELECT source_count FROM general.entities WHERE id = $2),
          confidence = GREATEST(confidence, (SELECT confidence FROM general.entities WHERE id = $2)),
          updated_at = NOW()
        WHERE id = $1
      `, [survivorId, absorbedId]);

      // Redirect source links
      const redirected = await client.query(
        'UPDATE general.entity_source_links SET entity_id = $1 WHERE entity_id = $2',
        [survivorId, absorbedId]
      );

      // Mark absorbed
      await client.query(
        `UPDATE general.entities SET status = 'merged', merged_into = $1, updated_at = NOW() WHERE id = $2`,
        [survivorId, absorbedId]
      );

      // Audit
      await client.query(`
        INSERT INTO general.entity_merges (survivor_id, absorbed_id, candidate_id, merge_method, links_redirected)
        VALUES ($1, $2, $3, 'auto_' || $4, $5)
      `, [survivorId, absorbedId, c.id, c.candidate_method, redirected.rowCount]);

      // Update candidate status
      await client.query(
        `UPDATE general.entity_merge_candidates SET status = 'same', llm_verdict = 'SAME', reviewed_at = NOW() WHERE id = $1`,
        [c.id]
      );

      merged++;
      if (merged % 1000 === 0) console.log(`  Progress: ${merged.toLocaleString()} merged, ${skipped} skipped`);
    } catch (err) {
      console.log(`  Error merging ${c.entity_id_a}->${c.entity_id_b}: ${err.message.slice(0, 80)}`);
      await client.query(
        `UPDATE general.entity_merge_candidates SET status = 'error' WHERE id = $1`, [c.id]
      );
    }
  }

  console.log(`  Auto-merged: ${merged.toLocaleString()}, skipped: ${skipped}, BN conflicts rejected: ${bnConflicts.toLocaleString()} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return merged;
}

async function printSummary(client) {
  const stats = await client.query(`
    SELECT candidate_method, status, COUNT(*)::int AS cnt
    FROM general.entity_merge_candidates
    GROUP BY candidate_method, status
    ORDER BY candidate_method, status
  `);
  console.log('\n  Candidate Summary:');
  for (const r of stats.rows) {
    console.log(`    ${r.candidate_method.padEnd(20)} ${r.status.padEnd(12)} ${r.cnt.toLocaleString()}`);
  }

  const ents = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE merged_into IS NULL) AS active,
           COUNT(*) FILTER (WHERE merged_into IS NOT NULL) AS merged
    FROM general.entities
  `);
  const e = ents.rows[0];
  console.log(`\n  Entities: ${e.total.toLocaleString()} total, ${e.active.toLocaleString()} active, ${e.merged.toLocaleString()} merged`);
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();
  console.log(`[${ts()}] Candidate Detection Pipeline`);
  console.log(`[${ts()}] Auto-merge: ${opts.autoMerge}, Tier: ${opts.tier}`);

  const client = await pool.connect();
  try {
    const run = (t) => opts.tier === 'all' || opts.tier === t;

    if (run(1)) await tier1_normName(client);
    if (run(2)) await tier2_sharedBN(client);
    if (run(3)) await tier3_tradeName(client);
    if (run(4)) await tier4_trigram(client);
    if (run(5)) await tier5_splinkMatch(client);

    if (opts.autoMerge) await autoMerge(client);

    await printSummary(client);
    console.log(`\n[${ts()}] Done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
