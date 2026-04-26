/**
 * 04-recipient-concentration.js - Vendor/Recipient Concentration Analysis
 *
 * Challenges supported: #5 Vendor Concentration, #8 Duplicative Funding
 *
 * Measures how concentrated federal funding is across recipients:
 * - HHI (Herfindahl-Hirschman Index) by department
 * - Top-N recipient share by department
 * - Single-recipient programs (monopoly signals)
 * - Recipients spanning many departments (cross-cutting influence)
 * - Duplicative funding: same recipient, multiple departments, similar programs
 *
 * Outputs: data/reports/recipient-concentration.json + .txt
 *
 * Usage: node scripts/advanced/04-recipient-concentration.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('Recipient Concentration Analysis');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. HHI by department ─────────────────────────────────────
    log.info('1. Computing HHI (Herfindahl-Hirschman Index) by department...');
    const hhiRes = await db.query(`
      WITH dept_recipient_totals AS (
        SELECT owner_org_title AS dept,
               recipient_legal_name AS recipient,
               SUM(agreement_value) AS recipient_total
        FROM fed.grants_contributions
        WHERE is_amendment = false AND agreement_value > 0 AND owner_org_title IS NOT NULL
        GROUP BY owner_org_title, recipient_legal_name
      ),
      dept_totals AS (
        SELECT dept,
               SUM(recipient_total) AS dept_total,
               COUNT(DISTINCT recipient) AS recipient_count
        FROM dept_recipient_totals
        GROUP BY dept
      ),
      dept_hhi AS (
        SELECT drt.dept,
               dt.dept_total,
               dt.recipient_count,
               SUM(POWER(drt.recipient_total / NULLIF(dt.dept_total, 0) * 100, 2)) AS hhi
        FROM dept_recipient_totals drt
        JOIN dept_totals dt ON drt.dept = dt.dept
        GROUP BY drt.dept, dt.dept_total, dt.recipient_count
      )
      SELECT dept AS department,
             ROUND(dept_total / 1e9, 2) AS total_billions,
             recipient_count,
             ROUND(hhi) AS hhi,
             CASE
               WHEN hhi > 2500 THEN 'Highly Concentrated'
               WHEN hhi > 1500 THEN 'Moderately Concentrated'
               ELSE 'Competitive'
             END AS concentration_level
      FROM dept_hhi
      WHERE dept_total > 100000000
      ORDER BY hhi DESC
    `);
    report.sections.hhi_by_department = {
      title: 'HHI Concentration by Department',
      note: 'HHI > 2500 = Highly Concentrated, 1500-2500 = Moderate, < 1500 = Competitive',
      data: hhiRes.rows,
    };
    const highlyConc = hhiRes.rows.filter(r => r.concentration_level === 'Highly Concentrated').length;
    log.info(`  ${highlyConc} of ${hhiRes.rows.length} departments are highly concentrated`);

    // ── 2. Top-3 recipient share by department ───────────────────
    log.info('2. Top-3 recipient share by department...');
    const top3Res = await db.query(`
      WITH dept_recipient_totals AS (
        SELECT owner_org_title AS dept,
               recipient_legal_name AS recipient,
               SUM(agreement_value) AS total
        FROM fed.grants_contributions
        WHERE is_amendment = false AND agreement_value > 0 AND owner_org_title IS NOT NULL
        GROUP BY owner_org_title, recipient_legal_name
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY total DESC) AS rank,
               SUM(total) OVER (PARTITION BY dept) AS dept_total
        FROM dept_recipient_totals
      )
      SELECT dept AS department,
             ROUND(dept_total / 1e9, 2) AS dept_total_billions,
             ROUND(SUM(total) FILTER (WHERE rank <= 3) / NULLIF(dept_total, 0) * 100, 1) AS top3_share_pct,
             ARRAY_AGG(recipient ORDER BY rank) FILTER (WHERE rank <= 3) AS top3_recipients,
             ARRAY_AGG(ROUND(total / 1e6, 1) ORDER BY rank) FILTER (WHERE rank <= 3) AS top3_millions
      FROM ranked
      WHERE dept_total > 100000000
      GROUP BY dept, dept_total
      ORDER BY top3_share_pct DESC
      LIMIT 25
    `);
    report.sections.top3_share = {
      title: 'Top-3 Recipient Share by Department (>$100M departments)',
      data: top3Res.rows,
    };

    // ── 3. Single-recipient programs ─────────────────────────────
    log.info('3. Single-recipient programs...');
    const singleRecipRes = await db.query(`
      SELECT prog_name_en AS program,
             owner_org_title AS department,
             MIN(recipient_legal_name) AS sole_recipient,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 1) AS total_millions
      FROM fed.grants_contributions
      WHERE is_amendment = false AND prog_name_en IS NOT NULL AND agreement_value > 0
      GROUP BY prog_name_en, owner_org_title
      HAVING COUNT(DISTINCT recipient_legal_name) = 1
        AND SUM(agreement_value) >= 1000000
      ORDER BY SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.single_recipient_programs = {
      title: 'Single-Recipient Programs (>$1M, Monopoly Signal)',
      count: singleRecipRes.rows.length,
      data: singleRecipRes.rows,
    };
    log.info(`  ${singleRecipRes.rows.length} programs with a single recipient >$1M`);

    // ── 4. Cross-department recipients ────────────────────────────
    log.info('4. Recipients spanning many departments...');
    const crossDeptRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_province AS prov,
             COUNT(DISTINCT owner_org) AS dept_count,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 1) AS total_millions,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_legal_name IS NOT NULL
      GROUP BY recipient_legal_name, recipient_business_number, recipient_province
      HAVING COUNT(DISTINCT owner_org) >= 5
      ORDER BY COUNT(DISTINCT owner_org) DESC, SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.cross_department = {
      title: 'Recipients Funded by 5+ Departments (Cross-Cutting Influence)',
      count: crossDeptRes.rows.length,
      data: crossDeptRes.rows,
    };

    // ── 5. Duplicative funding signals ───────────────────────────
    log.info('5. Duplicative funding signals...');
    const dupRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_province AS prov,
             COUNT(DISTINCT owner_org) AS dept_count,
             COUNT(DISTINCT prog_name_en) AS program_count,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en) FILTER (WHERE prog_name_en IS NOT NULL) AS programs,
             ROUND(SUM(agreement_value) / 1e6, 1) AS total_millions,
             COUNT(*) AS grant_count
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_legal_name IS NOT NULL
      GROUP BY recipient_legal_name, recipient_province
      HAVING COUNT(DISTINCT owner_org) >= 3 AND COUNT(DISTINCT prog_name_en) >= 3
        AND SUM(agreement_value) >= 1000000
      ORDER BY COUNT(DISTINCT owner_org) DESC, SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.duplicative_funding = {
      title: 'Potential Duplicative Funding (3+ Depts, 3+ Programs, >$1M)',
      count: dupRes.rows.length,
      data: dupRes.rows,
    };

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'recipient-concentration.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    const txtPath = path.join(OUTPUT_DIR, 'recipient-concentration.txt');
    let txt = `RECIPIENT CONCENTRATION ANALYSIS\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;

    txt += `HHI BY DEPARTMENT (top 20):\n`;
    txt += `${'HHI'.padStart(8)} ${'Level'.padEnd(24)} ${'$B'.padStart(8)} ${'Recipients'.padStart(10)} ${'Department'.padEnd(1)}\n`;
    txt += `${'-'.repeat(90)}\n`;
    hhiRes.rows.slice(0, 20).forEach(r => {
      txt += `${String(r.hhi).padStart(8)} ${r.concentration_level.padEnd(24)} ${r.total_billions.padStart(8)} ${String(r.recipient_count).padStart(10)} ${(r.department || '').slice(0, 55)}\n`;
    });

    txt += `\nTOP-3 RECIPIENT SHARE (top 15):\n`;
    top3Res.rows.slice(0, 15).forEach(r => {
      txt += `  ${String(r.top3_share_pct).padStart(5)}% of $${r.dept_total_billions}B | ${(r.department || '').slice(0, 50)}\n`;
      if (r.top3_recipients) {
        r.top3_recipients.slice(0, 3).forEach((name, j) => {
          txt += `         ${j+1}. ${(name || '').slice(0, 50)} ($${r.top3_millions[j]}M)\n`;
        });
      }
    });

    txt += `\nSINGLE-RECIPIENT PROGRAMS (top 15):\n`;
    singleRecipRes.rows.slice(0, 15).forEach(r => {
      txt += `  $${r.total_millions}M | ${(r.program || '').slice(0, 40)} -> ${(r.sole_recipient || '').slice(0, 30)}\n`;
    });

    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT report: ${txtPath}`);

    log.section('Recipient Concentration Analysis Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
