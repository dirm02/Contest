/**
 * 02-for-profit-deep-dive.js - Deep Analysis of For-Profit Grant Recipients
 *
 * Challenges supported: #1 Zombie Recipients, #2 Ghost Capacity, #5 Vendor Concentration
 *
 * Analyzes for-profit entities receiving federal grants to identify:
 * - Largest for-profit recipients and their funding patterns
 * - Industry concentration (NAICS codes)
 * - For-profit recipients by department and program
 * - Entities receiving grants from many departments (cross-cutting influence)
 * - High-value single grants to for-profit entities
 * - For-profit entities with no business number (ghost capacity signal)
 *
 * Outputs: data/reports/for-profit-deep-dive.json + .txt
 *
 * Usage: node scripts/advanced/02-for-profit-deep-dive.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('For-Profit Grant Recipient Deep Dive');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. For-profit overview ───────────────────────────────────
    log.info('1. For-profit overview...');
    const overviewRes = await db.query(`
      SELECT
        COUNT(*) AS total_grants,
        COUNT(DISTINCT recipient_legal_name) AS unique_recipients,
        ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
        ROUND(AVG(agreement_value), 0) AS avg_value,
        COUNT(DISTINCT owner_org) AS departments,
        COUNT(DISTINCT prog_name_en) AS programs,
        COUNT(*) FILTER (WHERE recipient_business_number IS NULL OR recipient_business_number = '') AS missing_bn_count,
        ROUND(COUNT(*) FILTER (WHERE recipient_business_number IS NULL OR recipient_business_number = '')::numeric / COUNT(*) * 100, 1) AS missing_bn_pct
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
    `);
    report.sections.overview = { title: 'For-Profit Grant Overview', data: overviewRes.rows[0] };
    log.info(`  ${overviewRes.rows[0].total_grants} grants, $${overviewRes.rows[0].total_billions}B total`);
    log.info(`  ${overviewRes.rows[0].unique_recipients} unique recipients`);
    log.info(`  ${overviewRes.rows[0].missing_bn_pct}% missing business numbers`);

    // ── 2. Top 50 for-profit recipients ──────────────────────────
    log.info('2. Top 50 for-profit recipients...');
    const topRecipientsRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_province AS prov,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT owner_org) AS dept_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             ROUND(AVG(agreement_value), 0) AS avg_value,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en) FILTER (WHERE prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_business_number, recipient_province, recipient_city
      ORDER BY SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.top_recipients = {
      title: 'Top 50 For-Profit Recipients by Total Value',
      data: topRecipientsRes.rows,
    };
    log.info(`  Top recipient: ${topRecipientsRes.rows[0]?.name} ($${topRecipientsRes.rows[0]?.total_millions}M)`);

    // ── 3. For-profit by department ──────────────────────────────
    log.info('3. For-profit spending by department...');
    const byDeptRes = await db.query(`
      SELECT owner_org_title AS department,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT recipient_legal_name) AS unique_recipients,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(agreement_value), 0) AS avg_value,
             ROUND(SUM(agreement_value)::numeric / NULLIF(
               (SELECT SUM(agreement_value) FROM fed.grants_contributions WHERE owner_org_title = gc.owner_org_title AND is_amendment = false), 0
             ) * 100, 1) AS pct_of_dept_total
      FROM fed.grants_contributions gc
      WHERE recipient_type = 'F' AND is_amendment = false
      GROUP BY owner_org_title
      ORDER BY SUM(agreement_value) DESC
      LIMIT 25
    `);
    report.sections.by_department = {
      title: 'For-Profit Grants by Department',
      data: byDeptRes.rows,
    };

    // ── 4. High-value single grants (> $10M) ────────────────────
    log.info('4. High-value single for-profit grants (>$10M)...');
    const highValueRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_province AS prov,
             owner_org_title AS department,
             prog_name_en AS program,
             agreement_value,
             agreement_start_date,
             agreement_title_en AS title,
             description_en,
             ref_number
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
        AND agreement_value >= 10000000
      ORDER BY agreement_value DESC
      LIMIT 100
    `);
    report.sections.high_value_grants = {
      title: 'For-Profit Grants Over $10M',
      count: highValueRes.rows.length,
      data: highValueRes.rows,
    };
    log.info(`  ${highValueRes.rows.length} grants over $10M`);

    // ── 5. For-profit with NO business number (Ghost signal) ────
    log.info('5. For-profit recipients without business numbers...');
    const noBnRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             COUNT(DISTINCT owner_org) AS dept_count,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
        AND (recipient_business_number IS NULL OR recipient_business_number = '')
        AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_province, recipient_city
      HAVING SUM(agreement_value) >= 100000
      ORDER BY SUM(agreement_value) DESC
      LIMIT 100
    `);
    report.sections.no_business_number = {
      title: 'For-Profit Recipients Without Business Numbers (>$100K, Ghost Capacity Signal)',
      count: noBnRes.rows.length,
      data: noBnRes.rows,
    };
    log.info(`  ${noBnRes.rows.length} for-profit recipients >$100K with no BN`);

    // ── 6. For-profit funded by many departments ─────────────────
    log.info('6. For-profit recipients spanning multiple departments...');
    const multiDeptRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_province AS prov,
             COUNT(DISTINCT owner_org) AS dept_count,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
      GROUP BY recipient_legal_name, recipient_business_number, recipient_province
      HAVING COUNT(DISTINCT owner_org) >= 3
      ORDER BY COUNT(DISTINCT owner_org) DESC, SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.multi_department = {
      title: 'For-Profit Recipients Funded by 3+ Departments',
      count: multiDeptRes.rows.length,
      data: multiDeptRes.rows,
    };
    log.info(`  ${multiDeptRes.rows.length} for-profit entities funded by 3+ departments`);

    // ── 7. NAICS industry breakdown ──────────────────────────────
    log.info('7. For-profit by industry (NAICS)...');
    const naicsRes = await db.query(`
      SELECT naics_identifier AS naics,
             COUNT(*) AS grant_count,
             COUNT(DISTINCT recipient_legal_name) AS recipients,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             ROUND(AVG(agreement_value), 0) AS avg_value
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
        AND naics_identifier IS NOT NULL AND naics_identifier != ''
      GROUP BY naics_identifier
      ORDER BY SUM(agreement_value) DESC
      LIMIT 30
    `);
    report.sections.by_naics = {
      title: 'For-Profit Grants by NAICS Industry Code',
      data: naicsRes.rows,
    };

    // ── 8. Year-over-year for-profit spending trend ──────────────
    log.info('8. For-profit spending trend...');
    const trendRes = await db.query(`
      SELECT EXTRACT(YEAR FROM agreement_start_date)::int AS year,
             COUNT(*) AS grants,
             ROUND(SUM(agreement_value) / 1e9, 2) AS total_billions,
             COUNT(DISTINCT recipient_legal_name) AS unique_recipients
      FROM fed.grants_contributions
      WHERE recipient_type = 'F' AND is_amendment = false
        AND agreement_start_date IS NOT NULL
        AND EXTRACT(YEAR FROM agreement_start_date) BETWEEN 2006 AND 2025
      GROUP BY EXTRACT(YEAR FROM agreement_start_date)
      ORDER BY year
    `);
    report.sections.trend = {
      title: 'For-Profit Funding Trend by Year',
      data: trendRes.rows,
    };

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'for-profit-deep-dive.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    // TXT summary
    const txtPath = path.join(OUTPUT_DIR, 'for-profit-deep-dive.txt');
    let txt = `FOR-PROFIT GRANT RECIPIENT DEEP DIVE\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;
    const ov = report.sections.overview.data;
    txt += `OVERVIEW:\n  Grants: ${ov.total_grants} | Recipients: ${ov.unique_recipients} | Total: $${ov.total_billions}B\n`;
    txt += `  Avg value: $${parseInt(ov.avg_value).toLocaleString()} | Missing BN: ${ov.missing_bn_pct}%\n\n`;

    txt += `TOP 20 FOR-PROFIT RECIPIENTS:\n`;
    txt += `${'Rank'.padStart(4)} ${'Name'.padEnd(50)} ${'$M'.padStart(10)} ${'Grants'.padStart(7)} ${'Depts'.padStart(5)} ${'Province'.padStart(5)}\n`;
    txt += `${'-'.repeat(82)}\n`;
    topRecipientsRes.rows.slice(0, 20).forEach((r, i) => {
      txt += `${String(i+1).padStart(4)} ${(r.name || '').slice(0, 49).padEnd(50)} ${r.total_millions.padStart(10)} ${String(r.grant_count).padStart(7)} ${String(r.dept_count).padStart(5)} ${(r.prov || '').padStart(5)}\n`;
    });

    txt += `\nHIGH-VALUE FOR-PROFIT GRANTS (>$10M): ${highValueRes.rows.length} grants\n`;
    highValueRes.rows.slice(0, 15).forEach(r => {
      txt += `  $${(parseFloat(r.agreement_value)/1e6).toFixed(1)}M | ${(r.name || '').slice(0, 40)} | ${(r.department || '').slice(0, 40)}\n`;
    });

    txt += `\nGHOST CAPACITY SIGNALS (For-profit, no BN, >$100K): ${noBnRes.rows.length} entities\n`;
    noBnRes.rows.slice(0, 15).forEach(r => {
      txt += `  $${r.total_millions}M | ${(r.name || '').slice(0, 50)} | ${r.prov || 'N/A'}\n`;
    });

    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT report: ${txtPath}`);

    log.section('For-Profit Deep Dive Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
