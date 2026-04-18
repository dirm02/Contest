#!/usr/bin/env node
/**
 * 04-resolve-entities.js - Cross-dataset entity resolution pipeline v2.
 *
 * Match-first, create-last: aggressively matches before creating new entities.
 * Uses BN anchoring, exact match, normalized match, trigram fuzzy, THEN bulk create.
 * Followed by deterministic dedup merge (BN root + norm_name).
 *
 * Usage:
 *   node scripts/04-resolve-entities.js                # all phases
 *   node scripts/04-resolve-entities.js --phase 1      # CRA identification seed
 *   node scripts/04-resolve-entities.js --phase 1b     # CRA qualified_donees
 *   node scripts/04-resolve-entities.js --phase 2      # FED grants
 *   node scripts/04-resolve-entities.js --phase 3      # AB (non-profit/grants/contracts/sole-source)
 *   node scripts/04-resolve-entities.js --phase 4      # Deterministic dedup merge
 *   node scripts/04-resolve-entities.js --phase 5      # Enrichment pass
 */
const { pool } = require('../lib/db');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(p, step, msg) { console.log(`[${ts()}] [P${p}] ${step ? step + ': ' : ''}${msg}`); }
function logC(p, step, label, count, t0) {
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const rate = sec > 0 ? Math.round(count / parseFloat(sec)) : '∞';
  log(p, step, `${label}: ${count.toLocaleString()} (${sec}s, ${rate}/s)`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { phase: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase' && args[i + 1]) opts.phase = args[++i];
  }
  // Phase numbers are integers except the CRA qualified_donees sub-phase '1b',
  // which needs to remain a string token.
  if (opts.phase !== 'all' && opts.phase !== '1b') {
    opts.phase = parseInt(opts.phase, 10);
  }
  return opts;
}

const BATCH = 50000;

// Batched entity creation (avoids Render timeouts).
// Placeholder BNs (all-zeros like "000000000") are NOT stored as bn_root — they
// are sentinel "no-BN" markers in the source data, not real identifiers. Writing
// them causes two bugs: (1) the Phase 4 BN-dedup collapses unrelated entities
// sharing the placeholder, (2) candidate detection tier 2 emits combinatorial
// false pairs. We reject them at write time rather than trying to clean up later.
async function batchCreate(client, phase, step, schema, table, entityType, hasBN = false) {
  let total = 0;
  const t0 = Date.now();
  const bnCols = hasBN ? ', bn_root, bn_variants' : '';
  const bnExprs = hasBN ? `,
    general.extract_bn_root(b.bn),
    CASE WHEN general.extract_bn_root(b.bn) IS NOT NULL THEN ARRAY[b.bn] ELSE '{}' END` : '';

  while (true) {
    const res = await client.query(`
      WITH batch AS (
        SELECT id, source_name ${hasBN ? ', bn' : ''}
        FROM general.entity_resolution_log
        WHERE source_schema = $1 AND source_table = $2 AND status = 'pending'
        LIMIT ${BATCH}
      ),
      new_ents AS (
        INSERT INTO general.entities
          (canonical_name, entity_type, norm_canonical, source_count, dataset_sources, confidence, status ${bnCols})
        SELECT b.source_name, $3, general.norm_name(b.source_name), 1, ARRAY[$1], 0.70, 'draft' ${bnExprs}
        FROM batch b
        RETURNING id, canonical_name
      )
      UPDATE general.entity_resolution_log rl SET
        status = 'created', entity_id = ne.id, match_confidence = 1.0,
        match_method = 'new_entity', updated_at = NOW()
      FROM new_ents ne
      WHERE rl.id IN (SELECT id FROM batch)
        AND rl.source_name = ne.canonical_name
    `, [schema, table, entityType]);

    if (res.rowCount === 0) break;
    total += res.rowCount;
    log(phase, step, `  batch: +${res.rowCount.toLocaleString()} (total: ${total.toLocaleString()})`);
  }
  logC(phase, step, 'New entities created', total, t0);
  return total;
}

// Standard matching cascade for a source table
async function matchCascade(client, phase, schema, table) {
  // 1. Exact name match
  let t1 = Date.now();
  const exactRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.95, match_method = 'exact_name', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = $1 AND rl.source_table = $2
      AND rl.status = 'pending' AND e.merged_into IS NULL
      AND UPPER(e.canonical_name) = rl.source_name
  `, [schema, table]);
  logC(phase, 'exact', 'Exact matched', exactRes.rowCount, t1);

  // 2. Normalized match (norm_name function, indexed)
  t1 = Date.now();
  const normRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.90, match_method = 'normalized', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = $1 AND rl.source_table = $2
      AND rl.status = 'pending' AND e.merged_into IS NULL
      AND general.norm_name(rl.source_name) = e.norm_canonical
      AND general.norm_name(rl.source_name) != ''
      AND LENGTH(general.norm_name(rl.source_name)) >= 3
  `, [schema, table]);
  logC(phase, 'norm', 'Normalized matched', normRes.rowCount, t1);

  // 3. Pipe-split (second half of "NAME_EN|NAME_FR")
  t1 = Date.now();
  const pipeRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.88, match_method = 'pipe_split', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = $1 AND rl.source_table = $2
      AND rl.status = 'pending' AND e.merged_into IS NULL
      AND rl.source_name LIKE '%|%'
      AND general.norm_name(split_part(rl.source_name, '|', 2)) = e.norm_canonical
      AND general.norm_name(split_part(rl.source_name, '|', 2)) != ''
  `, [schema, table]);
  logC(phase, 'pipe', 'Pipe-split matched', pipeRes.rowCount, t1);

  // 4. Trade name (second part of "X TRADE NAME OF Y")
  t1 = Date.now();
  const tradeRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.88, match_method = 'trade_name', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = $1 AND rl.source_table = $2
      AND rl.status = 'pending' AND e.merged_into IS NULL
      AND UPPER(rl.source_name) LIKE '%TRADE NAME OF%'
      AND general.norm_name(split_part(UPPER(rl.source_name), 'TRADE NAME OF', 2)) = e.norm_canonical
      AND general.norm_name(split_part(UPPER(rl.source_name), 'TRADE NAME OF', 2)) != ''
  `, [schema, table]);
  logC(phase, 'trade', 'Trade-name matched', tradeRes.rowCount, t1);

  return exactRes.rowCount + normRes.rowCount + pipeRes.rowCount + tradeRes.rowCount;
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 1: CRA SEED
// ═══════════════════════════════════════════════════════════════

async function phase1(client) {
  const P = 1, t0 = Date.now();
  log(P, null, '══ Phase 1: Seed from CRA ══');

  const existing = (await client.query(
    `SELECT COUNT(*)::int AS cnt FROM general.entities WHERE bn_root IS NOT NULL`
  )).rows[0].cnt;
  if (existing > 0) { log(P, null, `Already seeded: ${existing.toLocaleString()}. Skipping.`); return; }

  // Use general.extract_bn_root() so malformed BNs ("88933 204" with spaces,
  // "12975471R" with letters, "0841-0189" with dashes) become NULL rather than
  // corrupt bn_root values that later slip past is_valid_bn_root() checks.
  let t1 = Date.now();
  const ins = await client.query(`
    WITH latest AS (
      SELECT DISTINCT ON (general.extract_bn_root(bn))
        general.extract_bn_root(bn) AS bn_root,
        bn, legal_name, account_name,
        designation, category, city, province, postal_code, country, registration_date
      FROM cra.cra_identification
      WHERE legal_name IS NOT NULL
        AND general.extract_bn_root(bn) IS NOT NULL
      ORDER BY general.extract_bn_root(bn), fiscal_year DESC
    )
    INSERT INTO general.entities
      (canonical_name, entity_type, bn_root, norm_canonical, metadata, dataset_sources, confidence, status, source_count)
    SELECT latest.legal_name,
      CASE latest.designation WHEN 'A' THEN 'public_foundation' WHEN 'B' THEN 'private_foundation' WHEN 'C' THEN 'charitable_org' ELSE 'charity' END,
      latest.bn_root, general.norm_name(latest.legal_name),
      jsonb_build_object('cra', jsonb_build_object('designation', latest.designation, 'category', latest.category, 'registration_date', latest.registration_date),
        'addresses', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('city', latest.city, 'province', latest.province, 'postal_code', latest.postal_code, 'country', latest.country, 'source', 'cra')))),
      ARRAY['cra'], 0.95, 'confirmed', 1
    FROM latest ON CONFLICT DO NOTHING
  `);
  logC(P, 'seed', 'Created CRA entities', ins.rowCount, t1);

  // Name + BN variants. Match extracted bn_root so this aligns with the INSERT
  // above — malformed CRA BNs shouldn't contaminate bn_variants.
  t1 = Date.now();
  await client.query(`
    UPDATE general.entities e SET alternate_names = sub.names, bn_variants = sub.bns
    FROM (
      SELECT general.extract_bn_root(ci.bn) AS bn_root,
             array_agg(DISTINCT n ORDER BY n) AS names,
             array_agg(DISTINCT ci.bn ORDER BY ci.bn) AS bns
      FROM cra.cra_identification ci,
           LATERAL (VALUES (ci.legal_name), (ci.account_name)) AS t(n)
      WHERE n IS NOT NULL
        AND general.extract_bn_root(ci.bn) IS NOT NULL
      GROUP BY general.extract_bn_root(ci.bn)
    ) sub WHERE e.bn_root = sub.bn_root
  `);
  logC(P, 'variants', 'Collected variants', ins.rowCount, t1);

  // Source links
  t1 = Date.now();
  const links = await client.query(`
    INSERT INTO general.entity_source_links (entity_id, source_schema, source_table, source_pk, source_name, match_confidence, match_method, link_status)
    SELECT e.id, 'cra', 'cra_identification', jsonb_build_object('bn_root', e.bn_root),
      e.canonical_name, 0.99, 'bn_anchor', 'confirmed'
    FROM general.entities e WHERE e.bn_root IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM general.entity_source_links esl WHERE esl.entity_id = e.id AND esl.source_schema = 'cra')
  `);
  logC(P, 'links', 'CRA source links', links.rowCount, t1);
  log(P, null, `Phase 1 complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 1b: CRA QUALIFIED DONEES
//
//  cra.cra_qualified_donees records gifts FROM one CRA charity TO another,
//  as declared on the donor's T3010. Each row has:
//    - bn         = donor's BN (already covered via cra_identification)
//    - donee_bn   = recipient's BN (same 15-char format as cra_identification.bn)
//    - donee_name = the name the donor WROTE for the recipient on their T3010
//
//  That last field is gold: it captures how OTHER organisations refer to the
//  entity in the wild. Boyle Street alone picks up 7+ extra name variants
//  ("STREETWORKS - BOYLE STREET SERVICE SOCIETY", "1743 THE BOYLE STREET
//  SERVICE SOCIETY", etc.) from donor-filed T3010s that don't appear in any
//  other source table.
//
//  Strategy (mirrors Phase 2 FED):
//    1. BN-anchor donee_bn → existing entity from Phase 1
//    2. Create new entity per unmatched donee_bn (for deregistered / stale charities)
//    3. Name cascade for null-bn rows
//    4. Bulk create for truly unmatched
//    5. Augment alternate_names, add 'cra' dataset source
//    6. Source links back to (bn, fpe, sequence_number) PK
// ═══════════════════════════════════════════════════════════════

async function phase1b(client) {
  const P = '1b', t0 = Date.now();
  log(P, null, '══ Phase 1b: Match CRA qualified_donees ══');

  // Extract distinct (donee_name, donee_bn) pairs.
  let t1 = Date.now();
  const ext = await client.query(`
    INSERT INTO general.entity_resolution_log (source_schema, source_table, source_name, bn, record_count)
    SELECT 'cra', 'cra_qualified_donees', UPPER(TRIM(donee_name)),
           MAX(donee_bn), COUNT(*)
    FROM cra.cra_qualified_donees
    WHERE donee_name IS NOT NULL AND TRIM(donee_name) != ''
    GROUP BY UPPER(TRIM(donee_name))
    ON CONFLICT (source_schema, source_table, source_name) DO NOTHING
  `);
  logC(P, 'extract', 'Distinct donee names', ext.rowCount, t1);

  // BN anchor by donee_bn.
  t1 = Date.now();
  const bnRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.99, match_method = 'bn_anchor', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = 'cra' AND rl.source_table = 'cra_qualified_donees'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
      AND e.bn_root = general.extract_bn_root(rl.bn) AND e.merged_into IS NULL
  `);
  logC(P, 'bn', 'Donee BN anchored', bnRes.rowCount, t1);

  // Create new entities for unmatched BNs (deregistered / stale donees).
  t1 = Date.now();
  const bnInsert = await client.query(`
    INSERT INTO general.entities (canonical_name, entity_type, bn_root, norm_canonical, source_count, dataset_sources, confidence, status)
    SELECT MAX(rl.source_name), 'charity',
           general.extract_bn_root(rl.bn),
           general.norm_name(MAX(rl.source_name)),
           1, ARRAY['cra'], 0.85, 'draft'
    FROM general.entity_resolution_log rl
    WHERE rl.source_schema = 'cra' AND rl.source_table = 'cra_qualified_donees'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
    GROUP BY general.extract_bn_root(rl.bn)
  `);
  logC(P, 'bn_create', 'Donee BN entities created', bnInsert.rowCount, t1);

  t1 = Date.now();
  const bnLink = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.99, match_method = 'bn_new', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = 'cra' AND rl.source_table = 'cra_qualified_donees'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
      AND e.bn_root = general.extract_bn_root(rl.bn) AND e.merged_into IS NULL
  `);
  logC(P, 'bn_link', 'Donee BN names linked', bnLink.rowCount, t1);

  // Cascade name match for entries without a usable BN.
  const cascade = await matchCascade(client, P, 'cra', 'cra_qualified_donees');
  log(P, 'cascade', `Cascade matches: ${cascade.toLocaleString()}`);

  // Create entities for truly unmatched names (donees that weren't in
  // cra_identification and had no valid donee_bn — rare but possible).
  await batchCreate(client, P, 'create', 'cra', 'cra_qualified_donees', 'charity', true);

  // Augment alternate_names with every donee-name variant we linked.
  t1 = Date.now();
  const aug = await client.query(`
    UPDATE general.entities e SET
      alternate_names = array_cat(e.alternate_names, ARRAY[rl.source_name]),
      dataset_sources = CASE WHEN 'cra' = ANY(e.dataset_sources) THEN e.dataset_sources ELSE array_append(e.dataset_sources, 'cra') END,
      source_count = e.source_count + 1, updated_at = NOW()
    FROM general.entity_resolution_log rl
    WHERE rl.source_schema = 'cra' AND rl.source_table = 'cra_qualified_donees'
      AND rl.status = 'matched' AND rl.entity_id IS NOT NULL AND e.id = rl.entity_id
  `);
  logC(P, 'augment', 'Augmented', aug.rowCount, t1);

  // Source links — one row per (bn, fpe, sequence_number) in qualified_donees.
  // Source_pk preserves the full composite key for traceability.
  t1 = Date.now();
  const sl = await client.query(`
    INSERT INTO general.entity_source_links (entity_id, source_schema, source_table, source_pk, source_name, match_confidence, match_method, link_status)
    SELECT rl.entity_id, 'cra', 'cra_qualified_donees',
           jsonb_build_object('bn', qd.bn, 'fpe', qd.fpe::text, 'seq', qd.sequence_number),
           qd.donee_name, rl.match_confidence, rl.match_method,
           CASE WHEN rl.match_confidence >= 0.85 THEN 'confirmed' ELSE 'tentative' END
    FROM general.entity_resolution_log rl
    JOIN cra.cra_qualified_donees qd ON UPPER(TRIM(qd.donee_name)) = rl.source_name
    WHERE rl.source_schema = 'cra' AND rl.source_table = 'cra_qualified_donees'
      AND rl.status IN ('matched', 'created') AND rl.entity_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
  logC(P, 'links', 'Donee source links', sl.rowCount, t1);
  log(P, null, `Phase 1b complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 2: FED — BN-first, then name matching
// ═══════════════════════════════════════════════════════════════

async function phase2(client) {
  const P = 2, t0 = Date.now();
  log(P, null, '══ Phase 2: Match FED ══');

  // Extract distinct names
  let t1 = Date.now();
  const ext = await client.query(`
    INSERT INTO general.entity_resolution_log (source_schema, source_table, source_name, bn, record_count)
    SELECT 'fed', 'grants_contributions', UPPER(TRIM(recipient_legal_name)),
      MAX(recipient_business_number), COUNT(*)
    FROM fed.grants_contributions
    WHERE recipient_legal_name IS NOT NULL AND TRIM(recipient_legal_name) != ''
    GROUP BY UPPER(TRIM(recipient_legal_name))
    ON CONFLICT (source_schema, source_table, source_name) DO NOTHING
  `);
  logC(P, 'extract', 'Distinct FED names', ext.rowCount, t1);

  // BN anchor to existing CRA entities. general.extract_bn_root() normalizes +
  // rejects placeholder BNs (000*, X00000000) in one place.
  t1 = Date.now();
  const bnRes = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.99, match_method = 'bn_anchor', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = 'fed' AND rl.source_table = 'grants_contributions'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
      AND e.bn_root = general.extract_bn_root(rl.bn) AND e.merged_into IS NULL
  `);
  logC(P, 'bn', 'BN anchor matched', bnRes.rowCount, t1);

  // Create ONE entity per unmatched BN root
  t1 = Date.now();
  const bnInsert = await client.query(`
    INSERT INTO general.entities (canonical_name, entity_type, bn_root, norm_canonical, source_count, dataset_sources, confidence, status)
    SELECT MAX(rl.source_name), 'organization',
           general.extract_bn_root(rl.bn),
           general.norm_name(MAX(rl.source_name)),
           1, ARRAY['fed'], 0.85, 'draft'
    FROM general.entity_resolution_log rl
    WHERE rl.source_schema = 'fed' AND rl.source_table = 'grants_contributions'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
    GROUP BY general.extract_bn_root(rl.bn)
  `);
  logC(P, 'bn_create', 'FED BN entities created', bnInsert.rowCount, t1);

  // Link resolution log entries to those new BN entities
  t1 = Date.now();
  const bnLink = await client.query(`
    UPDATE general.entity_resolution_log rl SET
      status = 'matched', entity_id = e.id,
      match_confidence = 0.99, match_method = 'bn_new', updated_at = NOW()
    FROM general.entities e
    WHERE rl.source_schema = 'fed' AND rl.source_table = 'grants_contributions'
      AND rl.status = 'pending'
      AND general.extract_bn_root(rl.bn) IS NOT NULL
      AND e.bn_root = general.extract_bn_root(rl.bn) AND e.merged_into IS NULL
  `);
  logC(P, 'bn_link', 'FED BN names linked', bnLink.rowCount, t1);

  // Name matching cascade on remaining (no BN)
  const totalMatched = await matchCascade(client, P, 'fed', 'grants_contributions');
  log(P, 'cascade', `Total cascade matches: ${totalMatched.toLocaleString()}`);

  // Bulk create for truly unmatched
  await batchCreate(client, P, 'create', 'fed', 'grants_contributions', 'organization', true);

  // Augment
  t1 = Date.now();
  const aug = await client.query(`
    UPDATE general.entities e SET
      alternate_names = array_cat(e.alternate_names, ARRAY[rl.source_name]),
      dataset_sources = CASE WHEN 'fed' = ANY(e.dataset_sources) THEN e.dataset_sources ELSE array_append(e.dataset_sources, 'fed') END,
      source_count = e.source_count + 1, updated_at = NOW()
    FROM general.entity_resolution_log rl
    WHERE rl.source_schema = 'fed' AND rl.source_table = 'grants_contributions'
      AND rl.status = 'matched' AND rl.entity_id IS NOT NULL AND e.id = rl.entity_id
  `);
  logC(P, 'augment', 'Augmented', aug.rowCount, t1);

  // Source links
  t1 = Date.now();
  const sl = await client.query(`
    INSERT INTO general.entity_source_links (entity_id, source_schema, source_table, source_pk, source_name, match_confidence, match_method, link_status)
    SELECT rl.entity_id, 'fed', 'grants_contributions', jsonb_build_object('_id', gc._id),
      gc.recipient_legal_name, rl.match_confidence, rl.match_method,
      CASE WHEN rl.match_confidence >= 0.85 THEN 'confirmed' ELSE 'tentative' END
    FROM general.entity_resolution_log rl
    JOIN fed.grants_contributions gc ON UPPER(TRIM(gc.recipient_legal_name)) = rl.source_name
    WHERE rl.source_schema = 'fed' AND rl.source_table = 'grants_contributions'
      AND rl.status IN ('matched', 'created') AND rl.entity_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
  logC(P, 'links', 'FED source links', sl.rowCount, t1);
  log(P, null, `Phase 2 complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 3: AB — match against growing entity table
// ═══════════════════════════════════════════════════════════════

const AB_SOURCES = [
  { table: 'ab_non_profit', col: 'legal_name', pkCol: 'id', pkType: 'uuid', entityType: 'non_profit' },
  { table: 'ab_sole_source', col: 'vendor', pkCol: 'id', pkType: 'uuid', entityType: 'business' },
  { table: 'ab_grants', col: 'recipient', pkCol: 'id', pkType: 'int', entityType: 'organization' },
  { table: 'ab_contracts', col: 'recipient', pkCol: 'id', pkType: 'uuid', entityType: 'organization' },
];

async function phase3(client) {
  const P = 3, t0 = Date.now();
  log(P, null, '══ Phase 3: Match AB ══');

  for (const src of AB_SOURCES) {
    const st = Date.now();
    log(P, src.table, `── ${src.table}.${src.col} ──`);

    // Check if already extracted
    const existing = (await client.query(
      `SELECT COUNT(*)::int AS cnt FROM general.entity_resolution_log WHERE source_schema = 'ab' AND source_table = $1`, [src.table]
    )).rows[0].cnt;

    if (existing === 0) {
      let t1 = Date.now();
      const ext = await client.query(`
        INSERT INTO general.entity_resolution_log (source_schema, source_table, source_name, record_count)
        SELECT 'ab', $1, UPPER(TRIM(${src.col})), COUNT(*)
        FROM ab.${src.table}
        WHERE ${src.col} IS NOT NULL AND TRIM(${src.col}) != '' AND LENGTH(TRIM(${src.col})) >= 3
        GROUP BY UPPER(TRIM(${src.col}))
        ON CONFLICT (source_schema, source_table, source_name) DO NOTHING
      `, [src.table]);
      logC(P, src.table, 'Extracted', ext.rowCount, t1);
    } else {
      log(P, src.table, `Already extracted: ${existing.toLocaleString()}`);
    }

    const pending = (await client.query(
      `SELECT COUNT(*)::int AS cnt FROM general.entity_resolution_log WHERE source_schema = 'ab' AND source_table = $1 AND status = 'pending'`, [src.table]
    )).rows[0].cnt;

    if (pending > 0) {
      const matched = await matchCascade(client, P, 'ab', src.table);
      log(P, src.table, `Cascade total: ${matched.toLocaleString()}`);
      await batchCreate(client, P, src.table, 'ab', src.table, src.entityType);
    }

    // Augment
    let t1 = Date.now();
    const aug = await client.query(`
      UPDATE general.entities e SET
        alternate_names = array_cat(e.alternate_names, ARRAY[rl.source_name]),
        dataset_sources = CASE WHEN 'ab' = ANY(e.dataset_sources) THEN e.dataset_sources ELSE array_append(e.dataset_sources, 'ab') END,
        source_count = e.source_count + 1, updated_at = NOW()
      FROM general.entity_resolution_log rl
      WHERE rl.source_schema = 'ab' AND rl.source_table = $1
        AND rl.status = 'matched' AND rl.entity_id IS NOT NULL AND e.id = rl.entity_id
    `, [src.table]);
    logC(P, src.table, 'Augmented', aug.rowCount, t1);

    // Source links
    const linkExists = (await client.query(
      `SELECT COUNT(*)::int AS cnt FROM general.entity_source_links WHERE source_schema = 'ab' AND source_table = $1`, [src.table]
    )).rows[0].cnt;

    if (linkExists === 0) {
      t1 = Date.now();
      const pkExpr = src.pkType === 'uuid'
        ? `jsonb_build_object('id', t.${src.pkCol}::text)` : `jsonb_build_object('id', t.${src.pkCol})`;
      const sl = await client.query(`
        INSERT INTO general.entity_source_links (entity_id, source_schema, source_table, source_pk, source_name, match_confidence, match_method, link_status)
        SELECT rl.entity_id, 'ab', $1, ${pkExpr}, t.${src.col}, rl.match_confidence, rl.match_method,
          CASE WHEN rl.match_confidence >= 0.85 THEN 'confirmed' ELSE 'tentative' END
        FROM general.entity_resolution_log rl
        JOIN ab.${src.table} t ON UPPER(TRIM(t.${src.col})) = rl.source_name
        WHERE rl.source_schema = 'ab' AND rl.source_table = $1
          AND rl.status IN ('matched', 'created') AND rl.entity_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `, [src.table]);
      logC(P, src.table, 'Source links', sl.rowCount, t1);
    }

    log(P, src.table, `Done (${((Date.now() - st) / 1000).toFixed(1)}s)`);
  }
  log(P, null, `Phase 3 complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 4: DETERMINISTIC DEDUP MERGE
// ═══════════════════════════════════════════════════════════════

async function phase4(client) {
  const P = 4, t0 = Date.now();
  log(P, null, '══ Phase 4: Deterministic dedup merge ══');

  // Ensure norm_canonical populated
  let t1 = Date.now();
  const normPop = await client.query(`
    UPDATE general.entities SET norm_canonical = general.norm_name(canonical_name)
    WHERE norm_canonical IS NULL AND merged_into IS NULL
  `);
  logC(P, 'norm', 'Populated norm_canonical', normPop.rowCount, t1);

  // BN dedup: collapse entities sharing same BN root. general.is_valid_bn_root()
  // already excludes placeholders — written invalid values shouldn't exist in
  // bn_root anymore thanks to write-time rejection, but guard defensively.
  t1 = Date.now();
  await client.query(`
    CREATE TEMP TABLE _bn_merge AS
    SELECT bn_root, survivor_id, absorbed_id FROM (
      SELECT e.bn_root,
        FIRST_VALUE(e.id) OVER (PARTITION BY e.bn_root ORDER BY
          CASE WHEN 'cra' = ANY(e.dataset_sources) THEN 0 ELSE 1 END, e.source_count DESC, e.id) AS survivor_id,
        e.id AS absorbed_id
      FROM general.entities e
      WHERE e.bn_root IS NOT NULL AND e.merged_into IS NULL
        AND general.is_valid_bn_root(e.bn_root)
    ) sub WHERE survivor_id != absorbed_id
  `);
  const bnCount = (await client.query('SELECT COUNT(*)::int AS cnt FROM _bn_merge')).rows[0].cnt;
  logC(P, 'bn_dedup', 'BN duplicates found', bnCount, t1);

  if (bnCount > 0) {
    t1 = Date.now();
    await client.query(`UPDATE general.entity_source_links esl SET entity_id = m.survivor_id FROM _bn_merge m WHERE esl.entity_id = m.absorbed_id`);
    await client.query(`UPDATE general.entities e SET status = 'merged', merged_into = m.survivor_id, updated_at = NOW() FROM _bn_merge m WHERE e.id = m.absorbed_id AND e.merged_into IS NULL`);
    logC(P, 'bn_dedup', 'BN merge executed', bnCount, t1);
  }
  await client.query('DROP TABLE IF EXISTS _bn_merge');

  // Norm-name dedup: collapse entities with identical norm_canonical.
  // BN is the primary identifier — only merge groups that have at most ONE distinct bn_root,
  // so different registered charities sharing a name (e.g. "ST. ANDREW'S PRESBYTERIAN CHURCH"
  // with 100+ distinct BNs across Canada) are never collapsed.
  t1 = Date.now();
  await client.query(`
    CREATE TEMP TABLE _norm_merge AS
    WITH safe_groups AS (
      SELECT norm_canonical
      FROM general.entities
      WHERE merged_into IS NULL
        AND norm_canonical IS NOT NULL AND norm_canonical != ''
        AND LENGTH(norm_canonical) >= 3
      GROUP BY norm_canonical
      -- Only merge groups where at most ONE distinct real bn_root appears.
      -- Groups with 2+ different real BNs = distinct registered entities that
      -- happen to share a name (different Canadian charities, different
      -- registrations of similarly-named orgs).
      HAVING COUNT(DISTINCT bn_root) FILTER (WHERE general.is_valid_bn_root(bn_root)) <= 1
    )
    SELECT norm_canonical, survivor_id, absorbed_id FROM (
      SELECT e.norm_canonical,
        FIRST_VALUE(e.id) OVER (PARTITION BY e.norm_canonical ORDER BY
          CASE WHEN e.bn_root IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN 'cra' = ANY(e.dataset_sources) THEN 0 ELSE 1 END,
          e.source_count DESC, e.id) AS survivor_id,
        e.id AS absorbed_id
      FROM general.entities e
      JOIN safe_groups sg ON sg.norm_canonical = e.norm_canonical
      WHERE e.merged_into IS NULL
    ) sub WHERE survivor_id != absorbed_id
  `);
  const normCount = (await client.query('SELECT COUNT(*)::int AS cnt FROM _norm_merge')).rows[0].cnt;
  logC(P, 'norm_dedup', 'Norm duplicates found', normCount, t1);

  if (normCount > 0) {
    t1 = Date.now();
    await client.query(`UPDATE general.entity_source_links esl SET entity_id = m.survivor_id FROM _norm_merge m WHERE esl.entity_id = m.absorbed_id`);
    await client.query(`UPDATE general.entities e SET status = 'merged', merged_into = m.survivor_id, updated_at = NOW() FROM _norm_merge m WHERE e.id = m.absorbed_id AND e.merged_into IS NULL`);
    logC(P, 'norm_dedup', 'Norm merge executed', normCount, t1);
  }
  await client.query('DROP TABLE IF EXISTS _norm_merge');

  log(P, null, `Phase 4 complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 5: ENRICH
// ═══════════════════════════════════════════════════════════════

async function phase5(client) {
  const P = 5, t0 = Date.now();
  log(P, null, '══ Phase 5: Enrich golden records ══');

  // Update source_count
  let t1 = Date.now();
  await client.query(`
    UPDATE general.entities e SET source_count = sub.cnt
    FROM (SELECT entity_id, COUNT(*)::int AS cnt FROM general.entity_source_links GROUP BY entity_id) sub
    WHERE e.id = sub.entity_id AND e.merged_into IS NULL AND e.source_count != sub.cnt
  `);
  logC(P, 'counts', 'Source counts updated', 0, t1);

  // Refresh norm_canonical
  t1 = Date.now();
  await client.query(`
    UPDATE general.entities SET norm_canonical = general.norm_name(canonical_name)
    WHERE merged_into IS NULL AND (norm_canonical IS NULL OR norm_canonical != general.norm_name(canonical_name))
  `);
  logC(P, 'norm', 'Norm refreshed', 0, t1);

  log(P, null, `Phase 5 complete (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY + MAIN
// ═══════════════════════════════════════════════════════════════

async function printSummary(client) {
  const s = (await client.query(`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE merged_into IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE merged_into IS NOT NULL)::int AS merged,
      COUNT(*) FILTER (WHERE merged_into IS NULL AND array_length(dataset_sources, 1) > 1)::int AS cross_ds,
      COUNT(*) FILTER (WHERE merged_into IS NULL AND bn_root IS NOT NULL)::int AS with_bn
    FROM general.entities
  `)).rows[0];
  const links = (await client.query('SELECT COUNT(*)::int AS cnt FROM general.entity_source_links')).rows[0].cnt;
  const log = await client.query(`SELECT status, COUNT(*)::int AS cnt FROM general.entity_resolution_log GROUP BY status ORDER BY status`);

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  Entity Resolution Summary                  ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Active:       ${String(s.active).padStart(10).padEnd(26)} ║`);
  console.log(`║  Merged:       ${String(s.merged).padStart(10).padEnd(26)} ║`);
  console.log(`║  Cross-ds:     ${String(s.cross_ds).padStart(10).padEnd(26)} ║`);
  console.log(`║  With BN:      ${String(s.with_bn).padStart(10).padEnd(26)} ║`);
  console.log(`║  Source links: ${String(links).padStart(10).padEnd(26)} ║`);
  console.log('║  Resolution:                                ║');
  for (const r of log.rows) {
    console.log(`║    ${r.status.padEnd(12)} ${String(r.cnt).padStart(10).padEnd(24)} ║`);
  }
  console.log('╚════════════════════════════════════════════╝');
}

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();
  console.log(`[${ts()}] Entity Resolution Pipeline v2`);
  console.log(`[${ts()}] Phase: ${opts.phase}`);

  await pool.query('SET pg_trgm.similarity_threshold = 0.25');
  const client = await pool.connect();

  try {
    const run = (p) => opts.phase === 'all' || opts.phase === p;
    if (run(1))    await phase1(client);
    if (run('1b')) await phase1b(client);
    if (run(2))    await phase2(client);
    if (run(3))    await phase3(client);
    if (run(4))    await phase4(client);
    if (run(5))    await phase5(client);
    await printSummary(client);
    console.log(`\n[${ts()}] Total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`\n[${ts()}] FATAL: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
