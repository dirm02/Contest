/**
 * 04-sole-source-deep-dive.js - 5 Advanced Sole-Source Analysis Scenarios
 *
 * Scenario 1: Repeat sole-source vendors - vendors receiving multiple sole-source
 *             contracts from the same ministry (pattern of dependency)
 * Scenario 2: Sole-source to competitive pipeline - vendors who started sole-source
 *             then also won competitive contracts (or vice versa)
 * Scenario 3: Contract splitting suspicion - multiple sole-source contracts to same
 *             vendor near threshold dates that could indicate splitting
 * Scenario 4: Geographic concentration - sole-source vendor locations vs department
 *             locations (local bias analysis)
 * Scenario 5: Duration and value outliers - contracts with unusually long durations
 *             or high $/day rates compared to ministry averages
 *
 * Outputs: data/reports/sole-source-deep-dive.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  const report = { generated: new Date().toISOString() };
  const lines = ['SOLE-SOURCE DEEP DIVE - 5 ADVANCED SCENARIOS', '='.repeat(70), ''];

  try {
    log.section('Sole-Source Deep Dive');

    // ── Scenario 1: Repeat Sole-Source Vendors ────────────────────
    log.info('Scenario 1: Repeat sole-source vendors...');
    lines.push('SCENARIO 1: REPEAT SOLE-SOURCE VENDORS', '-'.repeat(60));
    lines.push('Vendors receiving 3+ sole-source contracts from the same ministry\n');

    const repeats = await pool.query(`
      SELECT vendor, ministry,
             COUNT(*) AS contract_count,
             SUM(amount) AS total_value,
             MIN(start_date) AS first_contract,
             MAX(start_date) AS last_contract,
             COUNT(DISTINCT display_fiscal_year) AS fiscal_years_span,
             ARRAY_AGG(DISTINCT permitted_situations) AS justifications
      FROM ab.ab_sole_source
      WHERE vendor IS NOT NULL AND ministry IS NOT NULL
      GROUP BY vendor, ministry
      HAVING COUNT(*) >= 3
      ORDER BY total_value DESC
      LIMIT 30
    `);
    report.scenario1_repeat_vendors = repeats.rows;
    lines.push(`Found ${repeats.rows.length} vendor-ministry pairs with 3+ sole-source contracts:\n`);
    lines.push(`${'Vendor'.padEnd(40)} ${'Ministry'.padEnd(30)} ${'Contracts'.padStart(10)} ${'Total Value'.padStart(16)} ${'FYs'.padStart(5)}`);
    for (const r of repeats.rows) {
      lines.push(`${(r.vendor || '').slice(0, 40).padEnd(40)} ${(r.ministry || '').slice(0, 30).padEnd(30)} ${r.contract_count.toString().padStart(10)} $${parseFloat(r.total_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} ${r.fiscal_years_span.toString().padStart(5)}`);
    }

    // ── Scenario 2: Sole-Source to Competitive Pipeline ───────────
    log.info('Scenario 2: Sole-source to competitive pipeline...');
    lines.push('\n\nSCENARIO 2: SOLE-SOURCE TO COMPETITIVE CONTRACT PIPELINE', '-'.repeat(60));
    lines.push('Vendors appearing in BOTH sole-source AND Blue Book contracts\n');

    const pipeline = await pool.query(`
      WITH ss_vendors AS (
        SELECT UPPER(TRIM(vendor)) AS entity,
               COUNT(*) AS ss_count,
               SUM(amount) AS ss_value,
               MIN(display_fiscal_year) AS ss_first_fy,
               MAX(display_fiscal_year) AS ss_last_fy
        FROM ab.ab_sole_source
        WHERE vendor IS NOT NULL
        GROUP BY UPPER(TRIM(vendor))
      ),
      contract_vendors AS (
        SELECT UPPER(TRIM(recipient)) AS entity,
               COUNT(*) AS c_count,
               SUM(amount) AS c_value,
               MIN(display_fiscal_year) AS c_first_fy,
               MAX(display_fiscal_year) AS c_last_fy
        FROM ab.ab_contracts
        WHERE recipient IS NOT NULL
        GROUP BY UPPER(TRIM(recipient))
      )
      SELECT s.entity,
             s.ss_count, s.ss_value, s.ss_first_fy, s.ss_last_fy,
             c.c_count, c.c_value, c.c_first_fy, c.c_last_fy,
             s.ss_value + c.c_value AS combined_value,
             ROUND(100.0 * s.ss_value / NULLIF(s.ss_value + c.c_value, 0), 1) AS ss_pct
      FROM ss_vendors s
      INNER JOIN contract_vendors c ON s.entity = c.entity
      ORDER BY combined_value DESC
      LIMIT 25
    `);
    report.scenario2_pipeline = pipeline.rows;
    lines.push(`${'Entity'.padEnd(45)} ${'SS Value'.padStart(16)} ${'Contract Value'.padStart(16)} ${'SS%'.padStart(6)}`);
    for (const r of pipeline.rows) {
      lines.push(`${(r.entity || '').slice(0, 45).padEnd(45)} $${parseFloat(r.ss_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} $${parseFloat(r.c_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} ${r.ss_pct}%`);
    }

    // ── Scenario 3: Contract Splitting Suspicion ──────────────────
    log.info('Scenario 3: Contract splitting suspicion...');
    lines.push('\n\nSCENARIO 3: POTENTIAL CONTRACT SPLITTING', '-'.repeat(60));
    lines.push('Multiple sole-source contracts to same vendor in same fiscal year (possible threshold avoidance)\n');

    const splitting = await pool.query(`
      SELECT vendor, ministry, display_fiscal_year,
             COUNT(*) AS contracts_in_fy,
             SUM(amount) AS fy_total,
             MIN(amount) AS min_contract,
             MAX(amount) AS max_contract,
             ROUND(AVG(amount), 2) AS avg_contract,
             ROUND(STDDEV(amount), 2) AS stddev_amount
      FROM ab.ab_sole_source
      WHERE vendor IS NOT NULL AND display_fiscal_year IS NOT NULL
      GROUP BY vendor, ministry, display_fiscal_year
      HAVING COUNT(*) >= 3 AND SUM(amount) > 100000
      ORDER BY contracts_in_fy DESC, fy_total DESC
      LIMIT 25
    `);
    report.scenario3_splitting = splitting.rows;
    lines.push(`Found ${splitting.rows.length} cases of 3+ sole-source to same vendor in same FY (>$100K total):\n`);
    for (const r of splitting.rows) {
      const stddev = r.stddev_amount ? parseFloat(r.stddev_amount) : 0;
      const avg = parseFloat(r.avg_contract);
      const cv = avg > 0 ? (stddev / avg * 100).toFixed(0) : 'n/a';
      lines.push(`  ${(r.vendor || '').slice(0, 35).padEnd(35)} ${r.display_fiscal_year} | ${r.contracts_in_fy} contracts | $${parseFloat(r.fy_total).toLocaleString(undefined, {maximumFractionDigits: 0})} total | CV: ${cv}%`);
      lines.push(`    Ministry: ${r.ministry} | Range: $${parseFloat(r.min_contract).toLocaleString()} - $${parseFloat(r.max_contract).toLocaleString()}`);
    }

    // ── Scenario 4: Geographic Concentration ──────────────────────
    log.info('Scenario 4: Geographic concentration...');
    lines.push('\n\nSCENARIO 4: GEOGRAPHIC CONCENTRATION OF SOLE-SOURCE VENDORS', '-'.repeat(60));

    const geoConcentration = await pool.query(`
      SELECT vendor_province, vendor_city,
             COUNT(*) AS contracts,
             SUM(amount) AS total_value,
             COUNT(DISTINCT vendor) AS unique_vendors,
             COUNT(DISTINCT ministry) AS ministries
      FROM ab.ab_sole_source
      WHERE vendor_province IS NOT NULL
      GROUP BY vendor_province, vendor_city
      ORDER BY total_value DESC
      LIMIT 20
    `);
    report.scenario4_geography = geoConcentration.rows;
    lines.push(`${'Province'.padEnd(12)} ${'City'.padEnd(25)} ${'Contracts'.padStart(10)} ${'Total Value'.padStart(18)} ${'Vendors'.padStart(8)}`);
    for (const r of geoConcentration.rows) {
      lines.push(`${(r.vendor_province || '').padEnd(12)} ${(r.vendor_city || '').slice(0, 25).padEnd(25)} ${parseInt(r.contracts).toLocaleString().padStart(10)} $${parseFloat(r.total_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(17)} ${parseInt(r.unique_vendors).toLocaleString().padStart(8)}`);
    }

    // Out-of-province analysis
    const outOfProvince = await pool.query(`
      SELECT vendor_province,
             COUNT(*) AS contracts,
             SUM(amount) AS total_value,
             COUNT(DISTINCT vendor) AS vendors,
             ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM ab.ab_sole_source), 2) AS pct_of_all
      FROM ab.ab_sole_source
      WHERE vendor_province IS NOT NULL
        AND UPPER(TRIM(vendor_province)) NOT IN ('AB', 'ALBERTA')
      GROUP BY vendor_province
      ORDER BY total_value DESC
    `);
    lines.push('\n  Out-of-province sole-source contracts:');
    for (const r of outOfProvince.rows) {
      lines.push(`    ${(r.vendor_province || '').padEnd(20)} ${parseInt(r.contracts).toLocaleString().padStart(6)} contracts  $${parseFloat(r.total_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(16)}  (${r.pct_of_all}% of all)`);
    }

    // ── Scenario 5: Duration & Value Outliers ─────────────────────
    log.info('Scenario 5: Duration and value outliers...');
    lines.push('\n\nSCENARIO 5: DURATION AND VALUE OUTLIERS', '-'.repeat(60));

    // Longest sole-source contracts
    const longest = await pool.query(`
      SELECT vendor, ministry, amount,
             start_date, end_date,
             (end_date - start_date) AS duration_days,
             CASE WHEN (end_date - start_date) > 0
                  THEN ROUND(amount / (end_date - start_date), 2)
                  ELSE NULL END AS daily_rate,
             display_fiscal_year
      FROM ab.ab_sole_source
      WHERE start_date IS NOT NULL AND end_date IS NOT NULL
        AND end_date > start_date
      ORDER BY (end_date - start_date) DESC
      LIMIT 15
    `);
    report.scenario5_longest = longest.rows;
    lines.push('\n  Longest duration sole-source contracts:');
    for (const r of longest.rows) {
      const years = (parseInt(r.duration_days) / 365).toFixed(1);
      lines.push(`  ${years} yrs (${r.duration_days} days) | $${parseFloat(r.amount).toLocaleString(undefined, {maximumFractionDigits: 0})} | ${(r.vendor || '').slice(0, 35)} | ${r.ministry}`);
    }

    // Highest daily rate sole-source contracts
    const highestRate = await pool.query(`
      SELECT vendor, ministry, amount,
             start_date, end_date,
             (end_date - start_date) AS duration_days,
             ROUND(amount / NULLIF(end_date - start_date, 0), 2) AS daily_rate
      FROM ab.ab_sole_source
      WHERE start_date IS NOT NULL AND end_date IS NOT NULL
        AND end_date > start_date
        AND (end_date - start_date) >= 30
      ORDER BY amount / NULLIF(end_date - start_date, 0) DESC
      LIMIT 15
    `);
    report.scenario5_highest_rate = highestRate.rows;
    lines.push('\n  Highest daily rate sole-source contracts (min 30 days):');
    for (const r of highestRate.rows) {
      lines.push(`  $${parseFloat(r.daily_rate).toLocaleString()}/day | $${parseFloat(r.amount).toLocaleString(undefined, {maximumFractionDigits: 0})} over ${r.duration_days} days | ${(r.vendor || '').slice(0, 35)} | ${r.ministry}`);
    }

    // Write reports
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, 'sole-source-deep-dive.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'sole-source-deep-dive.txt'), lines.join('\n'));

    log.section('Sole-Source Deep Dive Complete');
    console.log(lines.join('\n'));

  } catch (err) {
    log.error(`Analysis error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
