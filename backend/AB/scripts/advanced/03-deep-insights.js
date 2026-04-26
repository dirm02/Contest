/**
 * 03-deep-insights.js - Advanced analysis and anomaly detection across Alberta data.
 *
 * Insights:
 *   1. Vendor concentration (HHI) by ministry in contracts
 *   2. Sole-source rate vs competitive contracting by ministry
 *   3. Grant recipient dependency: entities relying on single ministry
 *   4. Temporal spending spikes: month-over-month anomalies
 *   5. Non-profit registry vs grant recipients: dissolved/struck orgs receiving grants
 *   6. Ministry name normalization: mapping historical names to current ministries
 *   7. Large sole-source contracts: >$1M threshold analysis
 *   8. Grant payment clustering: same-day bulk payments
 *   9. Top recipients with both grants AND contracts (dual beneficiaries)
 *  10. Sole-source permitted situations breakdown
 *
 * Outputs: data/reports/deep-insights.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  const report = { generated: new Date().toISOString() };
  const lines = ['ALBERTA OPEN DATA - DEEP INSIGHTS', '='.repeat(70), ''];

  try {
    log.section('Deep Insights Analysis');

    // ── 1. Vendor concentration (HHI) by ministry ─────────────────
    log.info('1. Vendor concentration (HHI) by ministry...');
    lines.push('1. VENDOR CONCENTRATION IN CONTRACTS (HHI BY MINISTRY)', '-'.repeat(60));
    lines.push('   HHI > 2500 = highly concentrated, 1500-2500 = moderate, <1500 = competitive\n');

    const hhi = await pool.query(`
      WITH ministry_totals AS (
        SELECT ministry, SUM(amount) AS total
        FROM ab.ab_contracts WHERE amount > 0
        GROUP BY ministry
      ),
      vendor_shares AS (
        SELECT c.ministry, c.recipient,
               SUM(c.amount) / mt.total * 100 AS market_share_pct
        FROM ab.ab_contracts c
        JOIN ministry_totals mt ON c.ministry = mt.ministry
        WHERE c.amount > 0
        GROUP BY c.ministry, c.recipient, mt.total
      )
      SELECT ministry,
             ROUND(SUM(market_share_pct * market_share_pct)) AS hhi,
             COUNT(DISTINCT recipient) AS vendor_count
      FROM vendor_shares
      GROUP BY ministry
      ORDER BY hhi DESC
    `);
    report.vendor_hhi = hhi.rows;
    for (const r of hhi.rows) {
      const level = parseInt(r.hhi) > 2500 ? 'CONCENTRATED' : parseInt(r.hhi) > 1500 ? 'MODERATE' : 'COMPETITIVE';
      lines.push(`  ${(r.ministry || '').slice(0, 40).padEnd(40)} HHI: ${r.hhi.toString().padStart(6)}  ${parseInt(r.vendor_count).toLocaleString().padStart(5)} vendors  [${level}]`);
    }

    // ── 2. Sole-source rate by ministry ───────────────────────────
    log.info('2. Sole-source rate by ministry...');
    lines.push('\n\n2. SOLE-SOURCE VS COMPETITIVE CONTRACTING BY MINISTRY', '-'.repeat(60));

    const ssRate = await pool.query(`
      WITH ss AS (
        SELECT ministry, COUNT(*) AS ss_count, SUM(amount) AS ss_total
        FROM ab.ab_sole_source
        GROUP BY ministry
      ),
      contracts AS (
        SELECT ministry, COUNT(*) AS c_count, SUM(amount) AS c_total
        FROM ab.ab_contracts
        GROUP BY ministry
      )
      SELECT COALESCE(ss.ministry, c.ministry) AS ministry,
             COALESCE(ss.ss_count, 0) AS sole_source_contracts,
             COALESCE(ss.ss_total, 0) AS sole_source_value,
             COALESCE(c.c_count, 0) AS total_contracts,
             COALESCE(c.c_total, 0) AS total_contract_value,
             CASE WHEN COALESCE(c.c_count, 0) > 0
                  THEN ROUND(100.0 * COALESCE(ss.ss_count, 0) / c.c_count, 1)
                  ELSE 0 END AS ss_rate_pct
      FROM ss
      FULL OUTER JOIN contracts c ON UPPER(ss.ministry) = UPPER(c.ministry)
      WHERE COALESCE(ss.ss_count, 0) + COALESCE(c.c_count, 0) > 10
      ORDER BY ss_rate_pct DESC
    `);
    report.sole_source_rates = ssRate.rows;
    lines.push(`  ${'Ministry'.padEnd(42)} ${'SS Contracts'.padStart(12)} ${'SS Value'.padStart(16)} ${'SS Rate'.padStart(8)}`);
    for (const r of ssRate.rows) {
      lines.push(`  ${(r.ministry || '').slice(0, 42).padEnd(42)} ${parseInt(r.sole_source_contracts).toLocaleString().padStart(12)} $${parseFloat(r.sole_source_value).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} ${r.ss_rate_pct}%`);
    }

    // ── 3. Grant recipient dependency ─────────────────────────────
    log.info('3. Single-ministry dependency...');
    lines.push('\n\n3. GRANT RECIPIENTS DEPENDENT ON SINGLE MINISTRY (>$10M, 1 MINISTRY)', '-'.repeat(60));

    const dependency = await pool.query(`
      SELECT recipient,
             MIN(ministry) AS sole_ministry,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT display_fiscal_year) AS fiscal_years
      FROM ab.ab_grants
      WHERE recipient IS NOT NULL AND TRIM(recipient) != ''
      GROUP BY recipient
      HAVING COUNT(DISTINCT ministry) = 1 AND SUM(amount) > 10000000
      ORDER BY total_amount DESC
      LIMIT 25
    `);
    report.single_ministry_dependency = dependency.rows;
    for (const r of dependency.rows) {
      lines.push(`  ${(r.recipient || '').slice(0, 45).padEnd(45)} $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} | ${r.sole_ministry} | ${r.fiscal_years} FYs`);
    }

    // ── 4. Dissolved/struck non-profits receiving grants ──────────
    log.info('4. Dissolved/struck non-profits receiving grants...');
    lines.push('\n\n4. NON-ACTIVE NON-PROFITS THAT RECEIVED GRANTS', '-'.repeat(60));

    const dissolvedGrants = await pool.query(`
      SELECT np.legal_name, np.status, np.type,
             COUNT(g.*) AS grant_payments,
             SUM(g.amount) AS total_grants,
             MIN(g.display_fiscal_year) AS first_fy,
             MAX(g.display_fiscal_year) AS last_fy
      FROM ab.ab_non_profit np
      INNER JOIN ab.ab_grants g ON UPPER(TRIM(np.legal_name)) = UPPER(TRIM(g.recipient))
      WHERE LOWER(np.status) IN ('dissolved', 'struck', 'cancelled', 'amalgamated')
      GROUP BY np.legal_name, np.status, np.type
      HAVING SUM(g.amount) > 100000
      ORDER BY total_grants DESC
      LIMIT 20
    `);
    report.dissolved_receiving_grants = dissolvedGrants.rows;
    lines.push(`  Found ${dissolvedGrants.rows.length} non-active non-profits receiving >$100K in grants:`);
    for (const r of dissolvedGrants.rows) {
      lines.push(`  ${(r.legal_name || '').slice(0, 40).padEnd(40)} [${r.status}] $${parseFloat(r.total_grants).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(14)} | ${r.first_fy} to ${r.last_fy}`);
    }

    // ── 5. Large sole-source contracts ────────────────────────────
    log.info('5. Large sole-source contracts...');
    lines.push('\n\n5. SOLE-SOURCE CONTRACTS > $10M', '-'.repeat(60));

    const largeSS = await pool.query(`
      SELECT vendor, ministry, amount, contract_services,
             display_fiscal_year, permitted_situations, start_date, end_date
      FROM ab.ab_sole_source
      WHERE amount > 10000000
      ORDER BY amount DESC
      LIMIT 25
    `);
    report.large_sole_source = largeSS.rows;
    lines.push(`  Found ${largeSS.rows.length} sole-source contracts > $10M:`);
    for (const r of largeSS.rows) {
      lines.push(`  $${parseFloat(r.amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} | ${(r.vendor || '').slice(0, 35)} | ${(r.ministry || '').slice(0, 25)} | ${r.display_fiscal_year || 'n/a'}`);
      if (r.contract_services) {
        lines.push(`    Services: ${r.contract_services.slice(0, 100)}`);
      }
    }

    // ── 6. Permitted situations breakdown ─────────────────────────
    log.info('6. Sole-source permitted situations...');
    lines.push('\n\n6. SOLE-SOURCE PERMITTED SITUATIONS BREAKDOWN', '-'.repeat(60));

    const situations = await pool.query(`
      SELECT permitted_situations,
             COUNT(*) AS contracts,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount
      FROM ab.ab_sole_source
      WHERE permitted_situations IS NOT NULL
      GROUP BY permitted_situations
      ORDER BY total_amount DESC
    `);
    report.permitted_situations = situations.rows;
    for (const r of situations.rows) {
      lines.push(`  Code "${r.permitted_situations}": ${parseInt(r.contracts).toLocaleString()} contracts, $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}, avg $${parseFloat(r.avg_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    }

    // ── 7. Same-day bulk grant payments ───────────────────────────
    log.info('7. Same-day bulk payments...');
    lines.push('\n\n7. SAME-DAY BULK GRANT PAYMENTS (>50 PAYMENTS ON SINGLE DAY TO SAME MINISTRY)', '-'.repeat(60));

    const bulkPayments = await pool.query(`
      SELECT payment_date::date AS pay_date, ministry,
             COUNT(*) AS payment_count,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT recipient) AS unique_recipients
      FROM ab.ab_grants
      WHERE payment_date IS NOT NULL
      GROUP BY payment_date::date, ministry
      HAVING COUNT(*) > 50
      ORDER BY payment_count DESC
      LIMIT 20
    `);
    report.bulk_payment_days = bulkPayments.rows;
    for (const r of bulkPayments.rows) {
      lines.push(`  ${r.pay_date.toISOString().slice(0, 10)} | ${(r.ministry || '').slice(0, 35).padEnd(35)} ${parseInt(r.payment_count).toLocaleString().padStart(6)} payments  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(16)}  ${parseInt(r.unique_recipients).toLocaleString()} recipients`);
    }

    // ── 8. Dual beneficiaries (grants + contracts) ────────────────
    log.info('8. Dual beneficiaries...');
    lines.push('\n\n8. TOP DUAL BENEFICIARIES (RECEIVED BOTH GRANTS AND CONTRACTS)', '-'.repeat(60));

    const dual = await pool.query(`
      WITH grant_totals AS (
        SELECT UPPER(TRIM(recipient)) AS entity,
               SUM(amount) AS grant_total,
               COUNT(*) AS grant_payments
        FROM ab.ab_grants
        WHERE recipient IS NOT NULL AND TRIM(recipient) != ''
        GROUP BY UPPER(TRIM(recipient))
      ),
      contract_totals AS (
        SELECT UPPER(TRIM(recipient)) AS entity,
               SUM(amount) AS contract_total,
               COUNT(*) AS contract_count
        FROM ab.ab_contracts
        WHERE recipient IS NOT NULL
        GROUP BY UPPER(TRIM(recipient))
      )
      SELECT g.entity,
             g.grant_total, g.grant_payments,
             c.contract_total, c.contract_count,
             g.grant_total + c.contract_total AS combined_total
      FROM grant_totals g
      INNER JOIN contract_totals c ON g.entity = c.entity
      ORDER BY combined_total DESC
      LIMIT 20
    `);
    report.dual_beneficiaries = dual.rows;
    lines.push(`  ${'Entity'.padEnd(45)} ${'Grants'.padStart(16)} ${'Contracts'.padStart(16)} ${'Combined'.padStart(16)}`);
    for (const r of dual.rows) {
      lines.push(`  ${(r.entity || '').slice(0, 45).padEnd(45)} $${parseFloat(r.grant_total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} $${parseFloat(r.contract_total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} $${parseFloat(r.combined_total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)}`);
    }

    // ── 9. Ministry name mapping challenge ────────────────────────
    log.info('9. Ministry name variations...');
    lines.push('\n\n9. MINISTRY NAME VARIATIONS (GRANTS VS CURRENT MINISTRIES)', '-'.repeat(60));
    lines.push('   Historical ministry names in grant data that may not match current structure:\n');

    const ministryNames = await pool.query(`
      SELECT DISTINCT ministry FROM ab.ab_grants
      WHERE ministry IS NOT NULL
      ORDER BY ministry
    `);
    const currentMinistries = await pool.query(`
      SELECT name FROM general.ministries WHERE is_active = true ORDER BY name
    `);
    const currentSet = new Set(currentMinistries.rows.map(r => r.name.toUpperCase()));

    const unmapped = [];
    for (const r of ministryNames.rows) {
      if (!currentSet.has(r.ministry.toUpperCase())) {
        unmapped.push(r.ministry);
      }
    }
    report.unmapped_ministries = unmapped;
    lines.push(`  ${ministryNames.rows.length} distinct ministry names in grants data`);
    lines.push(`  ${currentMinistries.rows.length} current active ministries`);
    lines.push(`  ${unmapped.length} grant ministry names NOT matching any current ministry:\n`);
    for (const name of unmapped) {
      lines.push(`    - ${name}`);
    }

    // ── 10. Non-profit registration trends ────────────────────────
    log.info('10. Non-profit registration trends...');
    lines.push('\n\n10. NON-PROFIT REGISTRATION TRENDS BY DECADE', '-'.repeat(60));

    const npDecade = await pool.query(`
      SELECT
        CASE
          WHEN registration_date < '1980-01-01' THEN 'Pre-1980'
          WHEN registration_date < '1990-01-01' THEN '1980s'
          WHEN registration_date < '2000-01-01' THEN '1990s'
          WHEN registration_date < '2010-01-01' THEN '2000s'
          WHEN registration_date < '2020-01-01' THEN '2010s'
          ELSE '2020s'
        END AS decade,
        COUNT(*) AS registrations,
        COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS active,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('dissolved', 'struck', 'cancelled')) AS defunct
      FROM ab.ab_non_profit
      WHERE registration_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);
    report.non_profit_decades = npDecade.rows;
    lines.push(`  ${'Decade'.padEnd(12)} ${'Total'.padStart(8)} ${'Active'.padStart(8)} ${'Defunct'.padStart(8)} ${'Survival %'.padStart(12)}`);
    for (const r of npDecade.rows) {
      const total = parseInt(r.registrations);
      const active = parseInt(r.active);
      const survival = total > 0 ? ((active / total) * 100).toFixed(1) : '0.0';
      lines.push(`  ${r.decade.padEnd(12)} ${total.toLocaleString().padStart(8)} ${active.toLocaleString().padStart(8)} ${parseInt(r.defunct).toLocaleString().padStart(8)} ${survival.padStart(11)}%`);
    }

    // ── Write reports ─────────────────────────────────────────────
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    fs.writeFileSync(path.join(REPORTS_DIR, 'deep-insights.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'deep-insights.txt'), lines.join('\n'));

    log.section('Deep Insights Complete');
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
