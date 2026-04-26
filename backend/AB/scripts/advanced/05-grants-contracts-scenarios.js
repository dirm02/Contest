/**
 * 05-grants-contracts-scenarios.js - 5 Advanced Grants & Contracts Analysis Scenarios
 *
 * Scenario 1: Grant-to-contract ratio by ministry - which ministries favor grants
 *             vs procurement? Is spending shifting between channels?
 * Scenario 2: Recipient concentration risk - Herfindahl-Hirschman Index (HHI) for
 *             grant recipients per program, flagging monopoly recipients
 * Scenario 3: Year-over-year spending volatility - which programs have the most
 *             unstable funding patterns (grants appearing/disappearing)
 * Scenario 4: Lottery funding analysis - how lottery-funded grants differ in
 *             distribution patterns, ministries, and recipient types
 * Scenario 5: Payment timing patterns - end-of-fiscal-year spending spikes,
 *             seasonal patterns, and potential "use it or lose it" behavior
 *
 * Outputs: data/reports/grants-contracts-scenarios.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  const report = { generated: new Date().toISOString() };
  const lines = ['GRANTS & CONTRACTS - 5 ADVANCED SCENARIOS', '='.repeat(70), ''];

  try {
    log.section('Grants & Contracts Analysis');

    // ── Scenario 1: Grant-to-Contract Ratio ───────────────────────
    log.info('Scenario 1: Grant-to-contract ratio by ministry...');
    lines.push('SCENARIO 1: GRANT-TO-CONTRACT RATIO BY MINISTRY', '-'.repeat(60));
    lines.push('Which ministries favor grants vs procurement spending?\n');

    const ratio = await pool.query(`
      WITH grant_spend AS (
        SELECT UPPER(ministry) AS ministry, SUM(amount) AS grant_total
        FROM ab.ab_grants
        WHERE amount > 0
        GROUP BY UPPER(ministry)
      ),
      contract_spend AS (
        SELECT UPPER(ministry) AS ministry, SUM(amount) AS contract_total
        FROM ab.ab_contracts
        WHERE amount > 0
        GROUP BY UPPER(ministry)
      )
      SELECT COALESCE(g.ministry, c.ministry) AS ministry,
             COALESCE(g.grant_total, 0) AS grant_total,
             COALESCE(c.contract_total, 0) AS contract_total,
             COALESCE(g.grant_total, 0) + COALESCE(c.contract_total, 0) AS combined,
             CASE WHEN COALESCE(c.contract_total, 0) > 0
                  THEN ROUND(COALESCE(g.grant_total, 0) / c.contract_total, 1)
                  ELSE NULL END AS grant_contract_ratio,
             CASE WHEN COALESCE(g.grant_total, 0) + COALESCE(c.contract_total, 0) > 0
                  THEN ROUND(100.0 * COALESCE(g.grant_total, 0) / (COALESCE(g.grant_total, 0) + COALESCE(c.contract_total, 0)), 1)
                  ELSE 0 END AS grant_pct
      FROM grant_spend g
      FULL OUTER JOIN contract_spend c ON g.ministry = c.ministry
      WHERE COALESCE(g.grant_total, 0) + COALESCE(c.contract_total, 0) > 100000000
      ORDER BY combined DESC
      LIMIT 20
    `);
    report.scenario1_ratios = ratio.rows;
    lines.push(`${'Ministry'.padEnd(42)} ${'Grants'.padStart(16)} ${'Contracts'.padStart(16)} ${'Grant%'.padStart(8)} ${'Ratio'.padStart(8)}`);
    for (const r of ratio.rows) {
      const ratioStr = r.grant_contract_ratio ? `${r.grant_contract_ratio}:1` : 'n/a';
      lines.push(`${(r.ministry || '').slice(0, 42).padEnd(42)} $${parseFloat(r.grant_total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} $${parseFloat(r.contract_total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(15)} ${r.grant_pct}%`.padEnd(90) + ratioStr);
    }

    // ── Scenario 2: Recipient Concentration (HHI per program) ─────
    log.info('Scenario 2: Recipient concentration per program...');
    lines.push('\n\nSCENARIO 2: MOST CONCENTRATED GRANT PROGRAMS (HHI)', '-'.repeat(60));
    lines.push('Programs where a single or few recipients dominate funding\n');

    const programHHI = await pool.query(`
      WITH program_totals AS (
        SELECT program, ministry, SUM(amount) AS total
        FROM ab.ab_grants
        WHERE amount > 0 AND program IS NOT NULL AND recipient IS NOT NULL
        GROUP BY program, ministry
        HAVING SUM(amount) > 10000000
      ),
      recipient_shares AS (
        SELECT g.program, g.ministry, g.recipient,
               SUM(g.amount) / pt.total * 100 AS share_pct
        FROM ab.ab_grants g
        JOIN program_totals pt ON g.program = pt.program AND g.ministry = pt.ministry
        WHERE g.amount > 0
        GROUP BY g.program, g.ministry, g.recipient, pt.total
      )
      SELECT program, ministry,
             ROUND(SUM(share_pct * share_pct) / 100) AS hhi,
             COUNT(DISTINCT recipient) AS recipient_count,
             MAX(share_pct) AS top_recipient_share
      FROM recipient_shares
      GROUP BY program, ministry
      HAVING SUM(share_pct * share_pct) / 100 > 2500
      ORDER BY hhi DESC
      LIMIT 25
    `);
    report.scenario2_program_hhi = programHHI.rows;
    for (const r of programHHI.rows) {
      lines.push(`  HHI: ${r.hhi.toString().padStart(6)} | ${parseInt(r.recipient_count).toString().padStart(4)} recipients | Top share: ${parseFloat(r.top_recipient_share).toFixed(0)}% | ${(r.program || '').slice(0, 35)} (${(r.ministry || '').slice(0, 20)})`);
    }

    // ── Scenario 3: Funding Volatility ────────────────────────────
    log.info('Scenario 3: Year-over-year funding volatility...');
    lines.push('\n\nSCENARIO 3: MOST VOLATILE GRANT PROGRAMS (YEAR-OVER-YEAR)', '-'.repeat(60));
    lines.push('Programs with the highest coefficient of variation in annual funding\n');

    const volatility = await pool.query(`
      WITH annual AS (
        SELECT program, ministry, display_fiscal_year,
               SUM(amount) AS annual_amount
        FROM ab.ab_grants
        WHERE program IS NOT NULL AND display_fiscal_year IS NOT NULL
        GROUP BY program, ministry, display_fiscal_year
      ),
      stats AS (
        SELECT program, ministry,
               COUNT(*) AS years_active,
               ROUND(AVG(annual_amount)) AS avg_annual,
               ROUND(STDDEV(annual_amount)) AS stddev_annual,
               ROUND(MIN(annual_amount)) AS min_annual,
               ROUND(MAX(annual_amount)) AS max_annual
        FROM annual
        GROUP BY program, ministry
        HAVING COUNT(*) >= 3 AND AVG(annual_amount) > 1000000
      )
      SELECT *,
             CASE WHEN avg_annual > 0
                  THEN ROUND(100.0 * stddev_annual / avg_annual, 1)
                  ELSE 0 END AS cv_pct
      FROM stats
      ORDER BY cv_pct DESC
      LIMIT 20
    `);
    report.scenario3_volatility = volatility.rows;
    for (const r of volatility.rows) {
      lines.push(`  CV: ${r.cv_pct}% | ${r.years_active} yrs | Avg: $${parseFloat(r.avg_annual).toLocaleString(undefined, {maximumFractionDigits: 0})} | Range: $${parseFloat(r.min_annual).toLocaleString(undefined, {maximumFractionDigits: 0})} - $${parseFloat(r.max_annual).toLocaleString(undefined, {maximumFractionDigits: 0})} | ${(r.program || '').slice(0, 40)}`);
    }

    // ── Scenario 4: Lottery Funding Analysis ──────────────────────
    log.info('Scenario 4: Lottery funding analysis...');
    lines.push('\n\nSCENARIO 4: LOTTERY-FUNDED VS NON-LOTTERY GRANTS', '-'.repeat(60));

    const lotteryAnalysis = await pool.query(`
      SELECT
        CASE WHEN lottery = 'True' THEN 'Lottery-Funded'
             WHEN lottery = 'False' THEN 'Non-Lottery'
             ELSE 'Unclassified' END AS funding_type,
        COUNT(*) AS payments,
        SUM(amount) AS total_amount,
        AVG(amount) AS avg_amount,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median_amount,
        COUNT(DISTINCT ministry) AS ministries,
        COUNT(DISTINCT recipient) AS recipients
      FROM ab.ab_grants
      GROUP BY 1
      ORDER BY total_amount DESC
    `);
    report.scenario4_lottery = lotteryAnalysis.rows;
    for (const r of lotteryAnalysis.rows) {
      lines.push(`\n  ${r.funding_type}:`);
      lines.push(`    Payments:    ${parseInt(r.payments).toLocaleString()}`);
      lines.push(`    Total:       $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
      lines.push(`    Average:     $${parseFloat(r.avg_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
      lines.push(`    Median:      $${parseFloat(r.median_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
      lines.push(`    Ministries:  ${r.ministries}`);
      lines.push(`    Recipients:  ${parseInt(r.recipients).toLocaleString()}`);
    }

    // Top lottery-funded programs
    const lotteryProgs = await pool.query(`
      SELECT program, ministry, COUNT(*) AS payments, SUM(amount) AS total
      FROM ab.ab_grants
      WHERE lottery = 'True'
      GROUP BY program, ministry
      ORDER BY total DESC
      LIMIT 15
    `);
    lines.push('\n  Top lottery-funded programs:');
    for (const r of lotteryProgs.rows) {
      lines.push(`    $${parseFloat(r.total).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(16)} | ${parseInt(r.payments).toLocaleString().padStart(6)} payments | ${(r.program || '').slice(0, 40)} (${(r.ministry || '').slice(0, 20)})`);
    }

    // ── Scenario 5: Payment Timing Patterns ───────────────────────
    log.info('Scenario 5: Payment timing patterns...');
    lines.push('\n\nSCENARIO 5: PAYMENT TIMING PATTERNS', '-'.repeat(60));
    lines.push('Monthly payment distribution - detecting end-of-fiscal-year spikes\n');

    const monthly = await pool.query(`
      SELECT EXTRACT(MONTH FROM payment_date) AS month,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount
      FROM ab.ab_grants
      WHERE payment_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);
    report.scenario5_monthly = monthly.rows;
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxPayments = Math.max(...monthly.rows.map(r => parseInt(r.payments)));
    for (const r of monthly.rows) {
      const bar = '#'.repeat(Math.round(parseInt(r.payments) / maxPayments * 40));
      lines.push(`  ${monthNames[parseInt(r.month)].padEnd(4)} ${parseInt(r.payments).toLocaleString().padStart(10)} payments  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${bar}`);
    }

    // Q4 spike analysis (Alberta fiscal year ends March 31)
    const q4Spike = await pool.query(`
      SELECT
        CASE WHEN EXTRACT(MONTH FROM payment_date) IN (1, 2, 3) THEN 'Q4 (Jan-Mar)'
             WHEN EXTRACT(MONTH FROM payment_date) IN (4, 5, 6) THEN 'Q1 (Apr-Jun)'
             WHEN EXTRACT(MONTH FROM payment_date) IN (7, 8, 9) THEN 'Q2 (Jul-Sep)'
             ELSE 'Q3 (Oct-Dec)' END AS quarter,
        COUNT(*) AS payments,
        SUM(amount) AS total_amount,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct_payments,
        ROUND(100.0 * SUM(amount) / SUM(SUM(amount)) OVER(), 1) AS pct_amount
      FROM ab.ab_grants
      WHERE payment_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);
    lines.push('\n  Quarterly distribution (Alberta fiscal year: Apr 1 - Mar 31):');
    for (const r of q4Spike.rows) {
      lines.push(`    ${r.quarter.padEnd(18)} ${parseInt(r.payments).toLocaleString().padStart(10)} (${r.pct_payments}%)  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)} (${r.pct_amount}%)`);
    }

    // Write reports
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, 'grants-contracts-scenarios.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'grants-contracts-scenarios.txt'), lines.join('\n'));

    log.section('Grants & Contracts Scenarios Complete');
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
