/**
 * 06-entity-export.js - Export Enriched Entity Data for External Research
 *
 * Challenges supported: #6 Related Parties, #10 Adverse Media, #1 Zombie, #2 Ghost
 *
 * Produces structured entity lists designed for secondary source research:
 * - Brave Search, LinkedIn, social media, corporate registries
 * - Business number lookups, director cross-referencing
 * - Adverse media screening
 *
 * Exports entities with risk signals and enough metadata to drive external lookups.
 *
 * Outputs: data/reports/entity-export.json + entity-export-for-profit.csv + entity-export-flagged.csv
 *
 * Usage: node scripts/advanced/06-entity-export.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(obj, cols) {
  return cols.map(c => csvEscape(obj[c])).join(',');
}

async function run() {
  log.section('Entity Export for External Research');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), exports: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. All for-profit entities with enriched data ────────────
    log.info('1. Exporting all for-profit entities...');
    const forProfitRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS business_number,
             recipient_operating_name AS operating_name,
             recipient_type,
             recipient_province AS province,
             recipient_city AS city,
             recipient_postal_code AS postal_code,
             recipient_country AS country,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS department_count,
             ROUND(SUM(agreement_value)::numeric, 2) AS total_value,
             ROUND(AVG(agreement_value)::numeric, 2) AS avg_value,
             ROUND(MAX(agreement_value)::numeric, 2) AS max_single_grant,
             MIN(agreement_start_date) AS first_grant_date,
             MAX(agreement_start_date) AS last_grant_date,
             EXTRACT(YEAR FROM MAX(agreement_start_date))::int AS last_grant_year,
             COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en)
               FILTER (WHERE prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions
      WHERE recipient_type = 'F'
        AND recipient_legal_name IS NOT NULL
      GROUP BY recipient_legal_name, recipient_business_number, recipient_operating_name,
               recipient_type, recipient_province, recipient_city, recipient_postal_code, recipient_country
      HAVING SUM(agreement_value) >= 100000
      ORDER BY SUM(agreement_value) DESC
    `);

    // Add risk flags
    const forProfitEntities = forProfitRes.rows.map(r => {
      const flags = [];
      if (!r.business_number) flags.push('NO_BUSINESS_NUMBER');
      if (r.last_grant_year && r.last_grant_year < 2020) flags.push('DISAPPEARED');
      if (parseInt(r.grant_count) <= 2 && parseFloat(r.total_value) >= 1000000) flags.push('HIGH_DEPENDENCY');
      if (parseFloat(r.avg_value) >= 10000000) flags.push('PASS_THROUGH');
      if (parseInt(r.department_count) >= 5) flags.push('CROSS_DEPARTMENT');
      if (parseInt(r.amendment_count) > (parseInt(r.grant_count) - parseInt(r.amendment_count))) flags.push('HEAVY_AMENDMENTS');
      return { ...r, risk_flags: flags, flag_count: flags.length };
    });

    report.exports.for_profit = {
      title: 'For-Profit Entities (>$100K total)',
      count: forProfitEntities.length,
      flagged_count: forProfitEntities.filter(r => r.flag_count > 0).length,
    };
    log.info(`  ${forProfitEntities.length} for-profit entities exported`);
    log.info(`  ${forProfitEntities.filter(r => r.flag_count > 0).length} have risk flags`);

    // Write CSV - all for-profit
    const csvCols = ['name', 'business_number', 'operating_name', 'province', 'city',
      'postal_code', 'grant_count', 'department_count', 'total_value', 'avg_value',
      'max_single_grant', 'first_grant_date', 'last_grant_date', 'last_grant_year',
      'amendment_count', 'risk_flags', 'flag_count'];

    let csv = csvCols.join(',') + '\n';
    for (const r of forProfitEntities) {
      const row = { ...r, risk_flags: r.risk_flags.join(';') };
      csv += toCsvRow(row, csvCols) + '\n';
    }
    const csvPath = path.join(OUTPUT_DIR, 'entity-export-for-profit.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');
    log.info(`  CSV: ${csvPath}`);

    // ── 2. Flagged entities (any type) ───────────────────────────
    log.info('2. Exporting flagged entities (all types)...');
    const flaggedRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS business_number,
             recipient_operating_name AS operating_name,
             gc.recipient_type,
             rtl.name_en AS recipient_type_name,
             recipient_province AS province,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS department_count,
             ROUND(SUM(agreement_value)::numeric, 2) AS total_value,
             MIN(agreement_start_date) AS first_grant_date,
             MAX(agreement_start_date) AS last_grant_date,
             EXTRACT(YEAR FROM MAX(agreement_start_date))::int AS last_grant_year,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions gc
      LEFT JOIN fed.recipient_type_lookup rtl ON gc.recipient_type = rtl.code
      WHERE gc.is_amendment = false AND gc.recipient_legal_name IS NOT NULL
      GROUP BY gc.recipient_legal_name, gc.recipient_business_number, gc.recipient_operating_name,
               gc.recipient_type, rtl.name_en, gc.recipient_province, gc.recipient_city
      HAVING (
        -- No BN and >$500K
        (gc.recipient_business_number IS NULL OR gc.recipient_business_number = '') AND SUM(agreement_value) >= 500000
      ) OR (
        -- Last grant before 2020 and >$1M
        MAX(agreement_start_date) < '2020-01-01' AND SUM(agreement_value) >= 1000000
      ) OR (
        -- 1-2 grants and >$5M (high dependency)
        COUNT(*) <= 2 AND SUM(agreement_value) >= 5000000
      ) OR (
        -- 5+ departments (cross-cutting)
        COUNT(DISTINCT owner_org) >= 5 AND SUM(agreement_value) >= 1000000
      )
      ORDER BY SUM(agreement_value) DESC
    `);

    const flaggedEntities = flaggedRes.rows.map(r => {
      const flags = [];
      if (!r.business_number) flags.push('NO_BN');
      if (r.last_grant_year && r.last_grant_year < 2020) flags.push('DISAPPEARED');
      if (parseInt(r.grant_count) <= 2 && parseFloat(r.total_value) >= 5000000) flags.push('HIGH_DEPENDENCY');
      if (parseInt(r.department_count) >= 5) flags.push('CROSS_DEPT');
      return { ...r, risk_flags: flags, flag_count: flags.length };
    });

    report.exports.flagged = {
      title: 'Flagged Entities (All Types)',
      count: flaggedEntities.length,
    };
    log.info(`  ${flaggedEntities.length} flagged entities exported`);

    // Write flagged CSV
    const flagCsvCols = ['name', 'business_number', 'recipient_type_name', 'province', 'city',
      'grant_count', 'department_count', 'total_value', 'first_grant_date', 'last_grant_date',
      'last_grant_year', 'risk_flags', 'flag_count'];

    let flagCsv = flagCsvCols.join(',') + '\n';
    for (const r of flaggedEntities) {
      const row = { ...r, risk_flags: r.risk_flags.join(';') };
      flagCsv += toCsvRow(row, flagCsvCols) + '\n';
    }
    const flagCsvPath = path.join(OUTPUT_DIR, 'entity-export-flagged.csv');
    fs.writeFileSync(flagCsvPath, flagCsv, 'utf8');
    log.info(`  CSV: ${flagCsvPath}`);

    // ── 3. Full JSON report ──────────────────────────────────────
    report.for_profit_entities = forProfitEntities;
    report.flagged_entities = flaggedEntities;

    const jsonPath = path.join(OUTPUT_DIR, 'entity-export.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    log.section('Entity Export Complete');
    log.info(`For-profit CSV: ${csvPath}`);
    log.info(`Flagged CSV:    ${flagCsvPath}`);
    log.info(`Full JSON:      ${jsonPath}`);

  } catch (err) {
    log.error(`Export failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
