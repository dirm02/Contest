/**
 * 08-individual-recipients.js - Individual Grant Recipients Analysis
 *
 * Standalone report on individuals and sole proprietorships (type 'P')
 * receiving federal grants. Answers: why are individuals getting public money,
 * how much, from which departments, and for what purposes?
 *
 * Outputs: data/reports/individual-recipients.json + .csv + .txt
 *
 * Usage: npm run analyze:individuals
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function run() {
  log.section('Individual Grant Recipients Analysis');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. Overview ──────────────────────────────────────────────
    log.info('1. Individual recipients overview...');
    const overviewRes = await db.query(`
      SELECT
        COUNT(*) AS total_grants,
        COUNT(DISTINCT recipient_legal_name) AS unique_individuals,
        ROUND(SUM(agreement_value)::numeric / 1e9, 2) AS total_billions,
        ROUND(AVG(agreement_value)::numeric, 0) AS avg_value,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY agreement_value)::numeric, 0) AS median_value,
        MAX(agreement_value) AS max_value,
        COUNT(DISTINCT owner_org) AS departments,
        COUNT(DISTINCT prog_name_en) AS programs
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
    `);
    report.sections.overview = { title: 'Individual Recipients Overview', data: overviewRes.rows[0] };
    const ov = overviewRes.rows[0];
    log.info(`  ${ov.total_grants} grants to ${ov.unique_individuals} individuals`);
    log.info(`  Total: $${ov.total_billions}B | Avg: $${parseInt(ov.avg_value).toLocaleString()} | Median: $${parseInt(ov.median_value).toLocaleString()}`);

    // ── 2. By department ─────────────────────────────────────────
    log.info('2. Individual grants by department...');
    const byDeptRes = await db.query(`
      SELECT owner_org_title AS department,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT recipient_legal_name) AS individuals,
             ROUND(SUM(agreement_value)::numeric / 1e6, 1) AS total_millions,
             ROUND(AVG(agreement_value)::numeric, 0) AS avg_value,
             ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY agreement_value)::numeric, 0) AS median_value
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
      GROUP BY owner_org_title
      ORDER BY SUM(agreement_value) DESC
    `);
    report.sections.by_department = { title: 'Individual Grants by Department', data: byDeptRes.rows };

    // ── 3. By program (top 30) ───────────────────────────────────
    log.info('3. Top programs funding individuals...');
    const byProgramRes = await db.query(`
      SELECT prog_name_en AS program,
             owner_org_title AS department,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT recipient_legal_name) AS individuals,
             ROUND(SUM(agreement_value)::numeric / 1e6, 1) AS total_millions,
             ROUND(AVG(agreement_value)::numeric, 0) AS avg_value
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false AND prog_name_en IS NOT NULL
      GROUP BY prog_name_en, owner_org_title
      ORDER BY SUM(agreement_value) DESC
      LIMIT 30
    `);
    report.sections.top_programs = { title: 'Top 30 Programs Funding Individuals', data: byProgramRes.rows };

    // ── 4. Highest-funded individuals ────────────────────────────
    log.info('4. Highest-funded individuals...');
    const topIndividualsRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS dept_count,
             ROUND(SUM(agreement_value)::numeric, 2) AS total_value,
             ROUND(AVG(agreement_value)::numeric, 2) AS avg_value,
             ROUND(MAX(agreement_value)::numeric, 2) AS max_grant,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en)
               FILTER (WHERE prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_province, recipient_city
      ORDER BY SUM(agreement_value) DESC
      LIMIT 100
    `);
    report.sections.top_individuals = { title: 'Top 100 Highest-Funded Individuals', data: topIndividualsRes.rows };
    log.info(`  Top: ${topIndividualsRes.rows[0]?.name} ($${(parseFloat(topIndividualsRes.rows[0]?.total_value)/1e6).toFixed(1)}M)`);

    // ── 5. Individuals with many grants (repeat recipients) ──────
    log.info('5. Repeat individual recipients...');
    const repeatRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS dept_count,
             ROUND(SUM(agreement_value)::numeric / 1e6, 2) AS total_millions,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en)
               FILTER (WHERE prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
      GROUP BY recipient_legal_name, recipient_province
      HAVING COUNT(*) >= 10
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);
    report.sections.repeat_recipients = { title: 'Individuals with 10+ Grants', data: repeatRes.rows };
    log.info(`  ${repeatRes.rows.length} individuals with 10+ grants`);

    // ── 6. Individuals funded by multiple departments ─────────────
    log.info('6. Individuals funded by multiple departments...');
    const multiDeptRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             COUNT(DISTINCT owner_org) AS dept_count,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value)::numeric / 1e6, 2) AS total_millions,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
      GROUP BY recipient_legal_name, recipient_province
      HAVING COUNT(DISTINCT owner_org) >= 3
      ORDER BY COUNT(DISTINCT owner_org) DESC, SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.multi_department = { title: 'Individuals Funded by 3+ Departments', data: multiDeptRes.rows };

    // ── 7. By province ───────────────────────────────────────────
    log.info('7. Individual grants by province...');
    const byProvRes = await db.query(`
      SELECT pl.name_en AS province,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT gc.recipient_legal_name) AS individuals,
             ROUND(SUM(gc.agreement_value)::numeric / 1e6, 1) AS total_millions,
             ROUND(AVG(gc.agreement_value)::numeric, 0) AS avg_value
      FROM fed.grants_contributions gc
      JOIN fed.province_lookup pl ON gc.recipient_province = pl.code
      WHERE gc.recipient_type = 'P' AND gc.is_amendment = false
      GROUP BY pl.name_en
      ORDER BY SUM(gc.agreement_value) DESC
    `);
    report.sections.by_province = { title: 'Individual Grants by Province', data: byProvRes.rows };

    // ── 8. Value distribution ────────────────────────────────────
    log.info('8. Value distribution for individual grants...');
    const distRes = await db.query(`
      SELECT
        CASE
          WHEN agreement_value < 0 THEN '1. Negative'
          WHEN agreement_value = 0 THEN '2. Zero'
          WHEN agreement_value < 5000 THEN '3. $0-$5K'
          WHEN agreement_value < 25000 THEN '4. $5K-$25K'
          WHEN agreement_value < 100000 THEN '5. $25K-$100K'
          WHEN agreement_value < 500000 THEN '6. $100K-$500K'
          WHEN agreement_value < 1000000 THEN '7. $500K-$1M'
          ELSE '8. $1M+'
        END AS value_bucket,
        COUNT(*) AS grant_count,
        ROUND(SUM(agreement_value)::numeric / 1e6, 1) AS total_millions
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
      GROUP BY 1
      ORDER BY 1
    `);
    report.sections.value_distribution = { title: 'Value Distribution', data: distRes.rows };

    // ── 9. Large individual grants (>$500K) - flag for review ────
    log.info('9. Large individual grants (>$500K)...');
    const largeRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             owner_org_title AS department,
             prog_name_en AS program,
             agreement_value,
             agreement_start_date,
             agreement_title_en AS title,
             description_en AS description,
             ref_number
      FROM fed.grants_contributions
      WHERE recipient_type = 'P' AND is_amendment = false
        AND agreement_value >= 500000
      ORDER BY agreement_value DESC
      LIMIT 100
    `);
    report.sections.large_individual_grants = {
      title: 'Individual Grants Over $500K (Flag for Review)',
      count: largeRes.rows.length,
      data: largeRes.rows,
    };
    log.info(`  ${largeRes.rows.length} individual grants over $500K`);

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'individual-recipients.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON: ${jsonPath}`);

    // CSV of top individuals
    const csvCols = ['name', 'prov', 'city', 'grant_count', 'dept_count',
      'total_value', 'avg_value', 'max_grant', 'first_grant', 'last_grant'];
    let csv = csvCols.join(',') + '\n';
    for (const r of topIndividualsRes.rows) {
      csv += csvCols.map(c => csvEscape(r[c])).join(',') + '\n';
    }
    const csvPath = path.join(OUTPUT_DIR, 'individual-recipients-top100.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');
    log.info(`CSV: ${csvPath}`);

    // TXT summary
    let txt = `INDIVIDUAL GRANT RECIPIENTS ANALYSIS\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;
    txt += `OVERVIEW:\n  Grants: ${ov.total_grants} to ${ov.unique_individuals} individuals\n`;
    txt += `  Total: $${ov.total_billions}B | Avg: $${parseInt(ov.avg_value).toLocaleString()} | Median: $${parseInt(ov.median_value).toLocaleString()} | Max: $${parseFloat(ov.max_value).toLocaleString()}\n\n`;

    txt += `BY DEPARTMENT:\n`;
    byDeptRes.rows.forEach(r => {
      txt += `  $${r.total_millions}M | ${String(r.grant_count).padStart(7)} grants | ${String(r.individuals).padStart(6)} people | ${(r.department || '').slice(0, 50)}\n`;
    });

    txt += `\nTOP 20 PROGRAMS FUNDING INDIVIDUALS:\n`;
    byProgramRes.rows.slice(0, 20).forEach(r => {
      txt += `  $${r.total_millions}M | ${r.individuals} people | ${(r.program || '').slice(0, 40)} (${(r.department || '').slice(0, 30)})\n`;
    });

    txt += `\nTOP 25 HIGHEST-FUNDED INDIVIDUALS:\n`;
    topIndividualsRes.rows.slice(0, 25).forEach((r, i) => {
      txt += `  ${String(i+1).padStart(2)}. $${(parseFloat(r.total_value)/1e6).toFixed(2)}M | ${r.grant_count} grants | ${(r.name || '').slice(0, 40)} | ${r.prov || '?'}\n`;
    });

    txt += `\nLARGE INDIVIDUAL GRANTS (>$500K): ${largeRes.rows.length} grants\n`;
    largeRes.rows.slice(0, 20).forEach(r => {
      txt += `  $${(parseFloat(r.agreement_value)/1e6).toFixed(2)}M | ${(r.name || '').slice(0, 30)} | ${(r.program || '').slice(0, 30)} | ${(r.department || '').slice(0, 25)}\n`;
    });

    const txtPath = path.join(OUTPUT_DIR, 'individual-recipients.txt');
    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT: ${txtPath}`);

    log.section('Individual Recipients Analysis Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
