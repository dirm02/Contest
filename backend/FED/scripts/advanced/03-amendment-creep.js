/**
 * 03-amendment-creep.js - Detect Amendment Creep Patterns
 *
 * Challenges supported: #4 Sole Source and Amendment Creep
 *
 * Identifies grants that grew significantly through amendments:
 * - Grants with the most amendments
 * - Grants where amended total dwarfs the original value
 * - Departments with highest amendment rates
 * - Recipients who benefit most from amendments
 * - Large negative amendments (reductions / terminations)
 *
 * Outputs: data/reports/amendment-creep.json + .txt
 *
 * Usage: node scripts/advanced/03-amendment-creep.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('Amendment Creep Analysis');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. Amendment overview ────────────────────────────────────
    log.info('1. Amendment overview...');
    const overviewRes = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_amendment = false) AS original_count,
        COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count,
        ROUND(COUNT(*) FILTER (WHERE is_amendment = true)::numeric /
              NULLIF(COUNT(*) FILTER (WHERE is_amendment = false), 0) * 100, 1) AS amendment_rate_pct,
        ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = false) / 1e9, 2) AS original_billions,
        ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true) / 1e9, 2) AS amendment_billions,
        COUNT(DISTINCT ref_number) FILTER (WHERE is_amendment = true) AS amended_grant_count
      FROM fed.grants_contributions
    `);
    report.sections.overview = { title: 'Amendment Overview', data: overviewRes.rows[0] };
    log.info(`  ${overviewRes.rows[0].amendment_count} amendments on ${overviewRes.rows[0].amended_grant_count} grants`);
    log.info(`  Amendment rate: ${overviewRes.rows[0].amendment_rate_pct}%`);

    // ── 2. Most amended grants ───────────────────────────────────
    log.info('2. Most amended grants...');
    const mostAmendedRes = await db.query(`
      WITH grant_amendments AS (
        SELECT ref_number,
               recipient_legal_name,
               owner_org_title,
               recipient_province,
               COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count,
               SUM(agreement_value) FILTER (WHERE is_amendment = false) AS original_value,
               SUM(agreement_value) FILTER (WHERE is_amendment = true) AS amendment_total,
               SUM(agreement_value) AS net_value,
               MIN(agreement_start_date) AS start_date,
               MAX(amendment_date) FILTER (WHERE is_amendment = true) AS last_amendment
        FROM fed.grants_contributions
        WHERE ref_number IS NOT NULL
        GROUP BY ref_number, recipient_legal_name, owner_org_title
        HAVING COUNT(*) FILTER (WHERE is_amendment = true) > 0
      )
      SELECT *,
             ROUND(amendment_total / NULLIF(ABS(original_value), 0) * 100, 0) AS amendment_pct_of_original
      FROM grant_amendments
      ORDER BY amendment_count DESC
      LIMIT 50
    `);
    report.sections.most_amended = {
      title: 'Top 50 Most Amended Grants',
      data: mostAmendedRes.rows,
    };
    log.info(`  Most amended: ${mostAmendedRes.rows[0]?.ref_number} (${mostAmendedRes.rows[0]?.amendment_count} amendments)`);

    // ── 3. Largest amendment creep (value growth) ────────────────
    log.info('3. Largest amendment creep by value growth...');
    const creepRes = await db.query(`
      WITH grant_amendments AS (
        SELECT ref_number,
               recipient_legal_name,
               owner_org_title,
               recipient_province,
               SUM(agreement_value) FILTER (WHERE is_amendment = false) AS original_value,
               SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) AS positive_amendments,
               SUM(agreement_value) AS net_value,
               COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count
        FROM fed.grants_contributions
        WHERE ref_number IS NOT NULL
        GROUP BY ref_number, recipient_legal_name, owner_org_title
        HAVING SUM(agreement_value) FILTER (WHERE is_amendment = false) > 0
          AND SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) > 0
      )
      SELECT *,
             ROUND(positive_amendments / NULLIF(original_value, 0) * 100, 0) AS growth_pct,
             net_value - original_value AS value_increase
      FROM grant_amendments
      WHERE original_value > 10000
      ORDER BY positive_amendments / NULLIF(original_value, 0) DESC
      LIMIT 50
    `);
    report.sections.largest_creep = {
      title: 'Top 50 Grants with Largest Amendment Growth (% of Original)',
      note: 'Grants where amendments added the most relative to the original value',
      data: creepRes.rows,
    };

    // ── 4. Department amendment rates ────────────────────────────
    log.info('4. Department amendment rates...');
    const deptAmendRes = await db.query(`
      SELECT owner_org_title AS department,
             COUNT(*) FILTER (WHERE is_amendment = false) AS originals,
             COUNT(*) FILTER (WHERE is_amendment = true) AS amendments,
             ROUND(COUNT(*) FILTER (WHERE is_amendment = true)::numeric /
                   NULLIF(COUNT(*) FILTER (WHERE is_amendment = false), 0) * 100, 1) AS amendment_rate,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true) / 1e6, 1) AS amendment_millions,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value < 0) / 1e6, 1) AS reduction_millions
      FROM fed.grants_contributions
      WHERE owner_org_title IS NOT NULL
      GROUP BY owner_org_title
      HAVING COUNT(*) FILTER (WHERE is_amendment = false) >= 100
      ORDER BY amendment_rate DESC
    `);
    report.sections.dept_amendment_rates = {
      title: 'Department Amendment Rates',
      data: deptAmendRes.rows,
    };

    // ── 5. Recipients benefiting most from amendments ────────────
    log.info('5. Recipients benefiting most from amendments...');
    const recipAmendRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) / 1e6, 2) AS positive_amend_millions,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value < 0) / 1e6, 2) AS negative_amend_millions,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true) / 1e6, 2) AS net_amend_millions,
             COUNT(DISTINCT owner_org) AS dept_count
      FROM fed.grants_contributions
      WHERE recipient_legal_name IS NOT NULL
      GROUP BY recipient_legal_name, recipient_province
      HAVING COUNT(*) FILTER (WHERE is_amendment = true) > 0
      ORDER BY SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0) DESC
      LIMIT 50
    `);
    report.sections.top_amendment_beneficiaries = {
      title: 'Top 50 Recipients by Positive Amendment Value',
      data: recipAmendRes.rows,
    };

    // ── 6. Largest reductions (terminations / clawbacks) ─────────
    log.info('6. Largest grant reductions...');
    const reductionRes = await db.query(`
      SELECT ref_number,
             recipient_legal_name AS name,
             owner_org_title AS department,
             agreement_value AS reduction_value,
             amendment_date,
             amendment_number,
             additional_information_en AS notes
      FROM fed.grants_contributions
      WHERE agreement_value < 0 AND is_amendment = true
      ORDER BY agreement_value ASC
      LIMIT 50
    `);
    report.sections.largest_reductions = {
      title: 'Top 50 Largest Grant Reductions',
      data: reductionRes.rows,
    };

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'amendment-creep.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    const txtPath = path.join(OUTPUT_DIR, 'amendment-creep.txt');
    let txt = `AMENDMENT CREEP ANALYSIS\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;
    const ov = report.sections.overview.data;
    txt += `OVERVIEW:\n  Originals: ${ov.original_count} | Amendments: ${ov.amendment_count} | Rate: ${ov.amendment_rate_pct}%\n`;
    txt += `  Original value: $${ov.original_billions}B | Amendment value: $${ov.amendment_billions}B\n\n`;

    txt += `MOST AMENDED GRANTS (top 20):\n`;
    mostAmendedRes.rows.slice(0, 20).forEach((r, i) => {
      txt += `  ${String(i+1).padStart(2)}. ${r.amendment_count} amends | ${(r.recipient_legal_name || '').slice(0, 40)} | ${(r.owner_org_title || '').slice(0, 35)}\n`;
    });

    txt += `\nLARGEST AMENDMENT CREEP (top 20 by growth %):\n`;
    creepRes.rows.slice(0, 20).forEach((r, i) => {
      txt += `  ${String(i+1).padStart(2)}. +${r.growth_pct}% | Orig $${(parseFloat(r.original_value)/1e6).toFixed(1)}M -> +$${(parseFloat(r.positive_amendments)/1e6).toFixed(1)}M amends | ${(r.recipient_legal_name || '').slice(0, 40)}\n`;
    });

    txt += `\nDEPARTMENT AMENDMENT RATES:\n`;
    deptAmendRes.rows.slice(0, 15).forEach(r => {
      txt += `  ${String(r.amendment_rate).padStart(6)}% | ${(r.department || '').slice(0, 60)}\n`;
    });

    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT report: ${txtPath}`);

    log.section('Amendment Creep Analysis Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
