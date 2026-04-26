/**
 * 02-summary-analysis.js - Basic grouping and summary analysis across all AB datasets.
 *
 * Analyses:
 *   1. Grants by ministry and fiscal year (trends, growth rates)
 *   2. Top grant recipients overall and per ministry
 *   3. Program distribution and concentration
 *   4. Contracts: ministry spending breakdown
 *   5. Sole-source: ministry and fiscal year patterns
 *   6. Non-profit: entity type distribution and status breakdown
 *   7. Cross-dataset: recipients appearing in multiple datasets
 *
 * Outputs: data/reports/summary-analysis.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  const report = { generated: new Date().toISOString() };
  const lines = ['ALBERTA OPEN DATA - SUMMARY ANALYSIS', '='.repeat(70), ''];

  try {
    log.section('Summary Analysis');

    // ── 1. Grants by ministry and fiscal year ─────────────────────
    log.info('1. Grants by ministry...');
    lines.push('1. GRANTS BY MINISTRY (TOP 15 BY TOTAL AMOUNT)', '-'.repeat(60));

    const grantsByMinistry = await pool.query(`
      SELECT ministry,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount,
             COUNT(DISTINCT display_fiscal_year) AS fiscal_years,
             COUNT(DISTINCT recipient) AS unique_recipients
      FROM ab.ab_grants
      WHERE ministry IS NOT NULL
      GROUP BY ministry
      ORDER BY total_amount DESC
      LIMIT 15
    `);
    report.grants_by_ministry = grantsByMinistry.rows;
    for (const r of grantsByMinistry.rows) {
      lines.push(`  ${r.ministry.slice(0, 45).padEnd(45)} ${parseInt(r.payments).toLocaleString().padStart(10)} payments  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${r.unique_recipients} recipients`);
    }

    // ── 2. Grants fiscal year trend ───────────────────────────────
    log.info('2. Grants fiscal year trend...');
    lines.push('\n\n2. GRANTS FISCAL YEAR TREND', '-'.repeat(60));

    const grantsFY = await pool.query(`
      SELECT display_fiscal_year,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount,
             COUNT(DISTINCT ministry) AS ministries,
             COUNT(DISTINCT recipient) AS recipients
      FROM ab.ab_grants
      WHERE display_fiscal_year IS NOT NULL
      GROUP BY display_fiscal_year
      ORDER BY display_fiscal_year
    `);
    report.grants_fy_trend = grantsFY.rows;
    lines.push(`  ${'Fiscal Year'.padEnd(16)} ${'Payments'.padStart(10)} ${'Total Amount'.padStart(20)} ${'Avg'.padStart(12)} ${'Ministries'.padStart(12)} ${'Recipients'.padStart(12)}`);
    for (const r of grantsFY.rows) {
      lines.push(`  ${r.display_fiscal_year.padEnd(16)} ${parseInt(r.payments).toLocaleString().padStart(10)} $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(19)} $${parseFloat(r.avg_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(11)} ${r.ministries.toString().padStart(12)} ${parseInt(r.recipients).toLocaleString().padStart(12)}`);
    }

    // ── 3. Top grant recipients ───────────────────────────────────
    log.info('3. Top grant recipients...');
    lines.push('\n\n3. TOP 20 GRANT RECIPIENTS BY TOTAL AMOUNT', '-'.repeat(60));

    const topRecipients = await pool.query(`
      SELECT recipient,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT ministry) AS ministries,
             COUNT(DISTINCT display_fiscal_year) AS fiscal_years
      FROM ab.ab_grants
      WHERE recipient IS NOT NULL AND TRIM(recipient) != ''
      GROUP BY recipient
      ORDER BY total_amount DESC
      LIMIT 20
    `);
    report.top_grant_recipients = topRecipients.rows;
    for (const r of topRecipients.rows) {
      lines.push(`  ${(r.recipient || '').slice(0, 50).padEnd(50)} ${parseInt(r.payments).toLocaleString().padStart(8)} payments  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${r.ministries} ministries  ${r.fiscal_years} FYs`);
    }

    // ── 4. Program distribution ───────────────────────────────────
    log.info('4. Program distribution...');
    lines.push('\n\n4. TOP 20 PROGRAMS BY TOTAL AMOUNT', '-'.repeat(60));

    const topPrograms = await pool.query(`
      SELECT program, ministry,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT recipient) AS recipients
      FROM ab.ab_grants
      WHERE program IS NOT NULL
      GROUP BY program, ministry
      ORDER BY total_amount DESC
      LIMIT 20
    `);
    report.top_programs = topPrograms.rows;
    for (const r of topPrograms.rows) {
      lines.push(`  ${(r.program || '').slice(0, 40).padEnd(40)} ${(r.ministry || '').slice(0, 20).padEnd(20)} $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${parseInt(r.recipients).toLocaleString()} recipients`);
    }

    // ── 5. Contracts by ministry ──────────────────────────────────
    log.info('5. Contracts by ministry...');
    lines.push('\n\n5. CONTRACTS BY MINISTRY', '-'.repeat(60));

    const contractsByMinistry = await pool.query(`
      SELECT ministry,
             COUNT(*) AS contracts,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount,
             COUNT(DISTINCT recipient) AS vendors,
             COUNT(DISTINCT display_fiscal_year) AS fiscal_years
      FROM ab.ab_contracts
      GROUP BY ministry
      ORDER BY total_amount DESC
    `);
    report.contracts_by_ministry = contractsByMinistry.rows;
    for (const r of contractsByMinistry.rows) {
      lines.push(`  ${(r.ministry || '').slice(0, 40).padEnd(40)} ${parseInt(r.contracts).toLocaleString().padStart(8)} contracts  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${parseInt(r.vendors).toLocaleString()} vendors`);
    }

    // ── 6. Contracts fiscal year trend ────────────────────────────
    log.info('6. Contracts fiscal year trend...');
    lines.push('\n\n6. CONTRACTS FISCAL YEAR TREND', '-'.repeat(60));

    const contractsFY = await pool.query(`
      SELECT display_fiscal_year,
             COUNT(*) AS contracts,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT ministry) AS ministries,
             COUNT(DISTINCT recipient) AS vendors
      FROM ab.ab_contracts
      GROUP BY display_fiscal_year
      ORDER BY display_fiscal_year
    `);
    report.contracts_fy_trend = contractsFY.rows;
    for (const r of contractsFY.rows) {
      lines.push(`  ${r.display_fiscal_year.padEnd(16)} ${parseInt(r.contracts).toLocaleString().padStart(8)} contracts  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${r.ministries} ministries  ${parseInt(r.vendors).toLocaleString()} vendors`);
    }

    // ── 7. Sole-source by ministry ────────────────────────────────
    log.info('7. Sole-source by ministry...');
    lines.push('\n\n7. SOLE-SOURCE CONTRACTS BY MINISTRY (TOP 15)', '-'.repeat(60));

    const ssByMinistry = await pool.query(`
      SELECT ministry,
             COUNT(*) AS contracts,
             SUM(amount) AS total_amount,
             AVG(amount) AS avg_amount,
             COUNT(DISTINCT vendor) AS vendors
      FROM ab.ab_sole_source
      GROUP BY ministry
      ORDER BY total_amount DESC
      LIMIT 15
    `);
    report.sole_source_by_ministry = ssByMinistry.rows;
    for (const r of ssByMinistry.rows) {
      lines.push(`  ${(r.ministry || '').slice(0, 45).padEnd(45)} ${parseInt(r.contracts).toLocaleString().padStart(6)} contracts  $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0}).padStart(18)}  ${parseInt(r.vendors).toLocaleString()} vendors`);
    }

    // ── 8. Non-profit breakdown ───────────────────────────────────
    log.info('8. Non-profit status and type breakdown...');
    lines.push('\n\n8. NON-PROFIT REGISTRY - STATUS BREAKDOWN', '-'.repeat(60));

    const npStatus = await pool.query(`
      SELECT status, COUNT(*) AS cnt,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS pct
      FROM ab.ab_non_profit
      GROUP BY status ORDER BY cnt DESC
    `);
    report.non_profit_by_status = npStatus.rows;
    for (const r of npStatus.rows) {
      lines.push(`  ${(r.status || '(null)').padEnd(45)} ${parseInt(r.cnt).toLocaleString().padStart(8)} (${r.pct}%)`);
    }

    lines.push('\n  NON-PROFIT REGISTRY - ENTITY TYPE BREAKDOWN');
    const npType = await pool.query(`
      SELECT type, COUNT(*) AS cnt,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS pct
      FROM ab.ab_non_profit
      GROUP BY type ORDER BY cnt DESC
    `);
    report.non_profit_by_type = npType.rows;
    for (const r of npType.rows) {
      lines.push(`  ${(r.type || '(null)').padEnd(45)} ${parseInt(r.cnt).toLocaleString().padStart(8)} (${r.pct}%)`);
    }

    // ── 9. Lottery-funded grants ──────────────────────────────────
    log.info('9. Lottery-funded grants...');
    lines.push('\n\n9. LOTTERY-FUNDED GRANTS', '-'.repeat(60));

    const lottery = await pool.query(`
      SELECT lottery,
             COUNT(*) AS payments,
             SUM(amount) AS total_amount,
             COUNT(DISTINCT ministry) AS ministries
      FROM ab.ab_grants
      WHERE lottery IS NOT NULL
      GROUP BY lottery
      ORDER BY total_amount DESC
    `);
    report.lottery_breakdown = lottery.rows;
    for (const r of lottery.rows) {
      lines.push(`  Lottery="${r.lottery}": ${parseInt(r.payments).toLocaleString()} payments, $${parseFloat(r.total_amount).toLocaleString(undefined, {maximumFractionDigits: 0})}, ${r.ministries} ministries`);
    }

    // ── 10. Cross-dataset: entities in multiple datasets ──────────
    log.info('10. Cross-dataset entity overlap...');
    lines.push('\n\n10. CROSS-DATASET ENTITY OVERLAP', '-'.repeat(60));

    // Recipients in both grants AND contracts
    const gcOverlap = await pool.query(`
      SELECT COUNT(DISTINCT g.recipient) AS overlap_count
      FROM ab.ab_grants g
      INNER JOIN ab.ab_contracts c ON UPPER(TRIM(g.recipient)) = UPPER(TRIM(c.recipient))
      WHERE g.recipient IS NOT NULL AND TRIM(g.recipient) != ''
    `);
    lines.push(`  Recipients in BOTH grants AND contracts: ${parseInt(gcOverlap.rows[0].overlap_count).toLocaleString()}`);

    // Vendors in both sole-source AND contracts
    const scOverlap = await pool.query(`
      SELECT COUNT(DISTINCT s.vendor) AS overlap_count
      FROM ab.ab_sole_source s
      INNER JOIN ab.ab_contracts c ON UPPER(TRIM(s.vendor)) = UPPER(TRIM(c.recipient))
    `);
    lines.push(`  Vendors in BOTH sole-source AND contracts: ${parseInt(scOverlap.rows[0].overlap_count).toLocaleString()}`);

    // Non-profits that are grant recipients
    const npGrantOverlap = await pool.query(`
      SELECT COUNT(DISTINCT np.legal_name) AS overlap_count
      FROM ab.ab_non_profit np
      INNER JOIN ab.ab_grants g ON UPPER(TRIM(np.legal_name)) = UPPER(TRIM(g.recipient))
      WHERE np.legal_name IS NOT NULL
    `);
    lines.push(`  Non-profits that are grant recipients: ${parseInt(npGrantOverlap.rows[0].overlap_count).toLocaleString()}`);

    report.cross_dataset_overlap = {
      grants_and_contracts: parseInt(gcOverlap.rows[0].overlap_count),
      sole_source_and_contracts: parseInt(scOverlap.rows[0].overlap_count),
      non_profits_as_grant_recipients: parseInt(npGrantOverlap.rows[0].overlap_count),
    };

    // ── Write reports ─────────────────────────────────────────────
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    fs.writeFileSync(path.join(REPORTS_DIR, 'summary-analysis.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'summary-analysis.txt'), lines.join('\n'));

    log.section('Summary Analysis Complete');
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
