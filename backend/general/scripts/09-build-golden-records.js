#!/usr/bin/env node
/**
 * 09-build-golden-records.js — Build the final entity_golden_records table.
 *
 * Consolidates all resolved entity data into a single comprehensive table.
 * Each row is the complete, authoritative record for one real-world organization.
 *
 * Usage:
 *   node scripts/09-build-golden-records.js           # full rebuild
 *   node scripts/09-build-golden-records.js --refresh  # update existing records
 */
const { pool } = require('../lib/db');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

async function withRetry(fn, label = 'op', maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|Connection terminated|connection error/i.test(err.message + (err.code || ''));
      if (!transient || attempt >= maxRetries) throw err;
      const delay = Math.min(2000 * Math.pow(2, attempt) + Math.random() * 2000, 30000);
      console.warn(`  [retry] ${label}: ${err.message.slice(0, 60)}... ${(delay / 1000).toFixed(0)}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function createTable() {
  log('Creating entity_golden_records table...');
  await withRetry(() => pool.query(`
    CREATE TABLE IF NOT EXISTS general.entity_golden_records (
      id INTEGER PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      norm_name TEXT,
      entity_type TEXT,
      bn_root VARCHAR(9),
      bn_variants TEXT[] DEFAULT '{}',
      aliases JSONB DEFAULT '[]',
      dataset_sources TEXT[] DEFAULT '{}',
      source_summary JSONB DEFAULT '{}',
      source_link_count INTEGER DEFAULT 0,
      addresses JSONB DEFAULT '[]',
      cra_profile JSONB,
      fed_profile JSONB,
      ab_profile JSONB,
      related_entities JSONB DEFAULT '[]',
      merge_history JSONB DEFAULT '[]',
      confidence NUMERIC(4,3) DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `), 'create-table');

  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_canonical ON general.entity_golden_records(canonical_name)`), 'idx1');
  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_bn ON general.entity_golden_records(bn_root)`), 'idx2');
  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_norm ON general.entity_golden_records(norm_name)`), 'idx3');
  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_type ON general.entity_golden_records(entity_type)`), 'idx4');
  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_ds ON general.entity_golden_records USING GIN (dataset_sources)`), 'idx5');
  await withRetry(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_gr_trgm ON general.entity_golden_records USING GIN (UPPER(canonical_name) gin_trgm_ops)`), 'idx6');
  log('  Table + indexes created');
}

async function buildRecords() {
  const t0 = Date.now();

  // Step 0: Collapse the table — drop rows for absorbed entities so the
  // final golden record table contains ONLY surviving (active) entities.
  // LLM-authored canonical names + aliases already live on the survivor's
  // general.entities row (set during applySame), so nothing is lost.
  log('Step 0: Deleting golden records for absorbed (merged_into IS NOT NULL) entities...');
  let t0step = Date.now();
  const delRes = await withRetry(() => pool.query(`
    DELETE FROM general.entity_golden_records gr
     USING general.entities e
     WHERE gr.id = e.id AND e.merged_into IS NOT NULL
  `), 'delete-absorbed');
  log(`  ${delRes.rowCount.toLocaleString()} absorbed records deleted (${((Date.now() - t0step) / 1000).toFixed(1)}s)`);

  // Step 1: Insert base records from active entities
  log('Step 1: Inserting base records from active entities...');
  let t1 = Date.now();
  const baseRes = await withRetry(() => pool.query(`
    INSERT INTO general.entity_golden_records (id, canonical_name, norm_name, entity_type, bn_root, bn_variants, dataset_sources, confidence, status)
    SELECT e.id, e.canonical_name, e.norm_canonical, e.entity_type, e.bn_root,
           COALESCE(e.bn_variants, '{}'), COALESCE(e.dataset_sources, '{}'),
           e.confidence, 'active'
    FROM general.entities e
    WHERE e.merged_into IS NULL
    ON CONFLICT (id) DO UPDATE SET
      canonical_name = EXCLUDED.canonical_name,
      norm_name = EXCLUDED.norm_name,
      entity_type = EXCLUDED.entity_type,
      bn_root = EXCLUDED.bn_root,
      bn_variants = EXCLUDED.bn_variants,
      dataset_sources = EXCLUDED.dataset_sources,
      confidence = EXCLUDED.confidence,
      updated_at = NOW()
  `), 'base-insert');
  log(`  ${baseRes.rowCount.toLocaleString()} records (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 2: Build aliases with source provenance
  log('Step 2: Building aliases with provenance...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      aliases = sub.alias_json,
      source_link_count = sub.link_count
    FROM (
      SELECT esl.entity_id,
        jsonb_agg(DISTINCT jsonb_build_object(
          'name', esl.source_name,
          'schema', esl.source_schema,
          'table', esl.source_table,
          'method', esl.match_method,
          'confidence', esl.match_confidence,
          'status', esl.link_status
        )) AS alias_json,
        COUNT(*)::int AS link_count
      FROM general.entity_source_links esl
      GROUP BY esl.entity_id
    ) sub
    WHERE gr.id = sub.entity_id
  `), 'aliases');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 3: Source summary (count per schema/table)
  log('Step 3: Building source summary...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      source_summary = sub.summary
    FROM (
      SELECT esl.entity_id,
        jsonb_object_agg(esl.source_schema || '.' || esl.source_table, esl.cnt) AS summary
      FROM (
        SELECT entity_id, source_schema, source_table, COUNT(*)::int AS cnt
        FROM general.entity_source_links
        GROUP BY entity_id, source_schema, source_table
      ) esl
      GROUP BY esl.entity_id
    ) sub
    WHERE gr.id = sub.entity_id
  `), 'source-summary');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 4: CRA profile (designation, category, address, financials summary)
  log('Step 4: Enriching CRA profile...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      cra_profile = jsonb_build_object(
        'designation', ci.designation,
        'category', ci.category,
        'registration_date', ci.registration_date,
        'city', ci.city,
        'province', ci.province,
        'postal_code', ci.postal_code,
        'country', ci.country,
        'contact_email', ci.contact_email,
        'contact_phone', ci.contact_phone
      ),
      addresses = COALESCE(gr.addresses, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'city', ci.city, 'province', ci.province, 'postal_code', ci.postal_code,
        'country', ci.country, 'source', 'cra'
      )))
    FROM (
      SELECT DISTINCT ON (LEFT(bn, 9))
        LEFT(bn, 9) AS bn_root, designation, category, registration_date,
        city, province, postal_code, country, contact_email, contact_phone
      FROM cra.cra_identification
      ORDER BY LEFT(bn, 9), fiscal_year DESC
    ) ci
    WHERE gr.bn_root = ci.bn_root
  `), 'cra-profile');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 5: FED profile (top programs, total grants, province)
  log('Step 5: Enriching FED profile...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      fed_profile = sub.profile
    FROM (
      SELECT esl.entity_id,
        jsonb_build_object(
          'total_grants', SUM(gc.agreement_value),
          'grant_count', COUNT(*)::int,
          'province', MODE() WITHIN GROUP (ORDER BY gc.recipient_province),
          'city', MODE() WITHIN GROUP (ORDER BY gc.recipient_city),
          'top_departments', (
            SELECT jsonb_agg(DISTINCT gc2.owner_org_title)
            FROM fed.grants_contributions gc2
            JOIN general.entity_source_links esl2 ON gc2._id = (esl2.source_pk->>'_id')::int
            WHERE esl2.entity_id = esl.entity_id AND esl2.source_schema = 'fed'
            LIMIT 5
          )
        ) AS profile
      FROM general.entity_source_links esl
      JOIN fed.grants_contributions gc ON gc._id = (esl.source_pk->>'_id')::int
      WHERE esl.source_schema = 'fed' AND esl.source_table = 'grants_contributions'
      GROUP BY esl.entity_id
    ) sub
    WHERE gr.id = sub.entity_id
  `), 'fed-profile');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 6: AB profile (grants total, ministries, non-profit status)
  log('Step 6: Enriching AB profile...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      ab_profile = sub.profile
    FROM (
      SELECT esl.entity_id,
        jsonb_build_object(
          'total_grants', SUM(g.amount),
          'payment_count', COUNT(*)::int,
          'ministries', (SELECT jsonb_agg(DISTINCT g2.ministry) FROM ab.ab_grants g2
            JOIN general.entity_source_links esl2 ON g2.id = (esl2.source_pk->>'id')::int
            WHERE esl2.entity_id = esl.entity_id AND esl2.source_schema = 'ab' AND esl2.source_table = 'ab_grants')
        ) AS profile
      FROM general.entity_source_links esl
      JOIN ab.ab_grants g ON g.id = (esl.source_pk->>'id')::int
      WHERE esl.source_schema = 'ab' AND esl.source_table = 'ab_grants'
      GROUP BY esl.entity_id
    ) sub
    WHERE gr.id = sub.entity_id
  `), 'ab-profile');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 7: Related entities (from LLM RELATED verdicts)
  log('Step 7: Linking related entities...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      related_entities = sub.related
    FROM (
      SELECT entity_id, jsonb_agg(jsonb_build_object(
        'entity_id', related_id, 'name', related_name,
        'relationship', verdict, 'reasoning', reasoning
      )) AS related
      FROM (
        SELECT mc.entity_id_a AS entity_id,
          mc.entity_id_b AS related_id, b.canonical_name AS related_name,
          mc.llm_verdict AS verdict, mc.llm_reasoning AS reasoning
        FROM general.entity_merge_candidates mc
        JOIN general.entities b ON b.id = mc.entity_id_b
        WHERE mc.llm_verdict = 'RELATED'
        UNION ALL
        SELECT mc.entity_id_b AS entity_id,
          mc.entity_id_a AS related_id, a.canonical_name AS related_name,
          mc.llm_verdict AS verdict, mc.llm_reasoning AS reasoning
        FROM general.entity_merge_candidates mc
        JOIN general.entities a ON a.id = mc.entity_id_a
        WHERE mc.llm_verdict = 'RELATED'
      ) pairs
      GROUP BY entity_id
    ) sub
    WHERE gr.id = sub.entity_id
  `), 'related');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Step 8: Merge history (what was absorbed into this entity)
  log('Step 8: Building merge history...');
  t1 = Date.now();
  await withRetry(() => pool.query(`
    UPDATE general.entity_golden_records gr SET
      merge_history = sub.history
    FROM (
      SELECT em.survivor_id,
        jsonb_agg(jsonb_build_object(
          'absorbed_name', absorbed.canonical_name,
          'absorbed_id', em.absorbed_id,
          'method', em.merge_method,
          'merged_at', em.merged_at
        ) ORDER BY em.merged_at) AS history
      FROM general.entity_merges em
      JOIN general.entities absorbed ON absorbed.id = em.absorbed_id
      GROUP BY em.survivor_id
    ) sub
    WHERE gr.id = sub.survivor_id
  `), 'merge-history');
  log(`  Done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

  // Final stats
  const stats = await withRetry(() => pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE bn_root IS NOT NULL)::int AS with_bn,
      COUNT(*) FILTER (WHERE cra_profile IS NOT NULL)::int AS with_cra,
      COUNT(*) FILTER (WHERE fed_profile IS NOT NULL)::int AS with_fed,
      COUNT(*) FILTER (WHERE ab_profile IS NOT NULL)::int AS with_ab,
      COUNT(*) FILTER (WHERE array_length(dataset_sources, 1) > 1)::int AS cross_ds,
      COUNT(*) FILTER (WHERE array_length(dataset_sources, 1) = 3)::int AS all_three,
      COUNT(*) FILTER (WHERE jsonb_array_length(related_entities) > 0)::int AS with_related,
      COUNT(*) FILTER (WHERE jsonb_array_length(merge_history) > 0)::int AS with_merges
    FROM general.entity_golden_records
  `), 'stats');
  const s = stats.rows[0];

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  Golden Records Complete                           ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║  Total records:      ${String(s.total).padStart(10).padEnd(28)} ║`);
  console.log(`║  With BN:            ${String(s.with_bn).padStart(10).padEnd(28)} ║`);
  console.log(`║  With CRA profile:   ${String(s.with_cra).padStart(10).padEnd(28)} ║`);
  console.log(`║  With FED profile:   ${String(s.with_fed).padStart(10).padEnd(28)} ║`);
  console.log(`║  With AB profile:    ${String(s.with_ab).padStart(10).padEnd(28)} ║`);
  console.log(`║  Cross-dataset:      ${String(s.cross_ds).padStart(10).padEnd(28)} ║`);
  console.log(`║  In all 3 datasets:  ${String(s.all_three).padStart(10).padEnd(28)} ║`);
  console.log(`║  With related:       ${String(s.with_related).padStart(10).padEnd(28)} ║`);
  console.log(`║  With merge history: ${String(s.with_merges).padStart(10).padEnd(28)} ║`);
  console.log('╚═══════════════════════════════════════════════════╝');
  log(`Total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main() {
  const t0 = Date.now();
  log('Building Golden Records');
  await createTable();
  await buildRecords();
  await pool.end();
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
