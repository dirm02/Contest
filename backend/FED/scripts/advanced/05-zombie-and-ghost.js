/**
 * 05-zombie-and-ghost.js - Zombie Recipients & Ghost Capacity Detection
 *
 * Challenges supported: #1 Zombie Recipients, #2 Ghost Capacity
 *
 * Identifies:
 * - Recipients who stopped appearing after receiving large funding
 * - High-dependency entities (few grants but large single amounts)
 * - Entities with no business number receiving substantial funding
 * - For-profit entities with very few grants but high values (pass-through signal)
 * - Recipients whose last grant was years ago (potential zombies)
 *
 * Outputs: data/reports/zombie-and-ghost.json + .txt
 *
 * Usage: node scripts/advanced/05-zombie-and-ghost.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('Zombie Recipients & Ghost Capacity Analysis');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. Potential zombie recipients ───────────────────────────
    // Received large grants but last seen before 2022
    log.info('1. Potential zombie recipients (last grant before 2022, received >$500K)...');
    const zombieRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_type,
             recipient_province AS prov,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant,
             EXTRACT(YEAR FROM MAX(agreement_start_date))::int AS last_year,
             COUNT(DISTINCT owner_org) AS dept_count,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions gc
      WHERE gc.is_amendment = false AND gc.recipient_legal_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM fed.grants_contributions a
          WHERE a.recipient_legal_name = gc.recipient_legal_name
            AND a.is_amendment = true AND a.amendment_date >= '2022-01-01'
        )
      GROUP BY gc.recipient_legal_name, gc.recipient_business_number, gc.recipient_type, gc.recipient_province, gc.recipient_city
      HAVING MAX(gc.agreement_start_date) < '2022-01-01'
        AND SUM(gc.agreement_value) >= 500000
      ORDER BY SUM(gc.agreement_value) DESC
      LIMIT 100
    `);
    report.sections.zombies = {
      title: 'Potential Zombie Recipients (>$500K, Last Grant Before 2022)',
      note: `Entities that received significant funding then stopped appearing in the data${zombieRes.rows.length >= 100 ? ' (showing top 100)' : ''}`,
      count: zombieRes.rows.length,
      data: zombieRes.rows,
    };
    log.info(`  ${zombieRes.rows.length} potential zombie recipients`);

    // ── 2. High-dependency: single large grant ───────────────────
    log.info('2. High-dependency: entities with 1-2 grants >$1M...');
    const highDepRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_type,
             recipient_province AS prov,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             ROUND(MAX(agreement_value) / 1e6, 2) AS largest_grant_millions,
             MAX(agreement_start_date) AS last_grant,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT prog_name_en ORDER BY prog_name_en) FILTER (WHERE prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_legal_name IS NOT NULL AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_business_number, recipient_type, recipient_province
      HAVING COUNT(*) <= 2 AND SUM(agreement_value) >= 1000000
      ORDER BY SUM(agreement_value) DESC
      LIMIT 100
    `);
    report.sections.high_dependency = {
      title: 'High-Dependency Entities (1-2 Grants, >$1M Total)',
      note: `Entities almost entirely dependent on one or two government grants${highDepRes.rows.length >= 100 ? ' (showing top 100)' : ''}`,
      count: highDepRes.rows.length,
      data: highDepRes.rows,
    };
    log.info(`  ${highDepRes.rows.length} high-dependency entities`);

    // ── 3. Ghost capacity: no BN, high funding ───────────────────
    log.info('3. Ghost capacity: no business number, >$500K...');
    const ghostRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_type,
             rtl.name_en AS recipient_type_name,
             recipient_province AS prov,
             recipient_city AS city,
             COUNT(*) AS grant_count,
             ROUND(SUM(gc.agreement_value) / 1e6, 2) AS total_millions,
             COUNT(DISTINCT gc.owner_org) AS dept_count,
             MIN(gc.agreement_start_date) AS first_grant,
             MAX(gc.agreement_start_date) AS last_grant,
             ARRAY_AGG(DISTINCT gc.owner_org_title ORDER BY gc.owner_org_title) AS departments,
             ARRAY_AGG(DISTINCT gc.prog_name_en ORDER BY gc.prog_name_en) FILTER (WHERE gc.prog_name_en IS NOT NULL) AS programs
      FROM fed.grants_contributions gc
      LEFT JOIN fed.recipient_type_lookup rtl ON gc.recipient_type = rtl.code
      WHERE gc.is_amendment = false
        AND (gc.recipient_business_number IS NULL OR gc.recipient_business_number = '')
        AND gc.recipient_legal_name IS NOT NULL
        AND gc.agreement_value > 0
      GROUP BY gc.recipient_legal_name, gc.recipient_type, rtl.name_en, gc.recipient_province, gc.recipient_city
      HAVING SUM(gc.agreement_value) >= 500000
      ORDER BY SUM(gc.agreement_value) DESC
      LIMIT 100
    `);
    report.sections.ghost_capacity = {
      title: 'Ghost Capacity Signals (No Business Number, >$500K)',
      note: `Entities receiving significant funding with no registered business identity${ghostRes.rows.length >= 100 ? ' (showing top 100)' : ''}`,
      count: ghostRes.rows.length,
      data: ghostRes.rows,
    };
    log.info(`  ${ghostRes.rows.length} entities with no BN receiving >$500K`);

    // ── 4. Pass-through signals: few grants, huge values ─────────
    log.info('4. Pass-through signals...');
    const passThroughRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_type,
             recipient_province AS prov,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             ROUND(AVG(agreement_value) / 1e6, 2) AS avg_millions,
             ROUND(MAX(agreement_value) / 1e6, 2) AS max_millions,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_legal_name IS NOT NULL AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_business_number, recipient_type, recipient_province
      HAVING COUNT(*) <= 5 AND AVG(agreement_value) >= 10000000
      ORDER BY AVG(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.pass_through = {
      title: 'Pass-Through Signals (<=5 Grants, Avg >$10M)',
      note: `Entities receiving very few but extremely large grants${passThroughRes.rows.length >= 50 ? ' (showing top 50)' : ''}`,
      count: passThroughRes.rows.length,
      data: passThroughRes.rows,
    };
    log.info(`  ${passThroughRes.rows.length} pass-through signal entities`);

    // ── 5. Disappeared for-profit: last seen before 2020 ─────────
    log.info('5. Disappeared for-profit recipients...');
    const disappearedRes = await db.query(`
      SELECT recipient_legal_name AS name,
             recipient_business_number AS bn,
             recipient_province AS prov,
             COUNT(*) AS grant_count,
             ROUND(SUM(agreement_value) / 1e6, 2) AS total_millions,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant,
             EXTRACT(YEAR FROM MAX(agreement_start_date))::int AS last_year,
             ARRAY_AGG(DISTINCT owner_org_title ORDER BY owner_org_title) AS departments
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_type = 'F'
        AND recipient_legal_name IS NOT NULL AND agreement_value > 0
      GROUP BY recipient_legal_name, recipient_business_number, recipient_province
      HAVING MAX(agreement_start_date) < '2020-01-01'
        AND SUM(agreement_value) >= 1000000
      ORDER BY SUM(agreement_value) DESC
      LIMIT 50
    `);
    report.sections.disappeared_for_profit = {
      title: 'Disappeared For-Profit Recipients (>$1M, Last Grant Before 2020)',
      note: 'For-profit companies that received significant funding then vanished',
      count: disappearedRes.rows.length,
      data: disappearedRes.rows,
    };
    log.info(`  ${disappearedRes.rows.length} disappeared for-profit entities`);

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'zombie-and-ghost.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    const txtPath = path.join(OUTPUT_DIR, 'zombie-and-ghost.txt');
    let txt = `ZOMBIE RECIPIENTS & GHOST CAPACITY ANALYSIS\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;

    txt += `POTENTIAL ZOMBIES (top 20, >$500K, last grant before 2022):\n`;
    txt += `${'$M'.padStart(10)} ${'Last'.padStart(6)} ${'BN'.padStart(10)} ${'Name'}\n`;
    txt += `${'-'.repeat(80)}\n`;
    zombieRes.rows.slice(0, 20).forEach(r => {
      txt += `${r.total_millions.padStart(10)} ${String(r.last_year).padStart(6)} ${(r.bn || 'N/A').padStart(10)} ${(r.name || '').slice(0, 50)}\n`;
    });

    txt += `\nGHOST CAPACITY (top 20, no BN, >$500K):\n`;
    ghostRes.rows.slice(0, 20).forEach(r => {
      txt += `  $${r.total_millions}M | ${r.recipient_type_name || r.recipient_type || '?'} | ${(r.name || '').slice(0, 50)}\n`;
    });

    txt += `\nPASS-THROUGH SIGNALS (top 15, <=5 grants, avg >$10M):\n`;
    passThroughRes.rows.slice(0, 15).forEach(r => {
      txt += `  $${r.total_millions}M total, $${r.avg_millions}M avg | ${(r.name || '').slice(0, 50)}\n`;
    });

    txt += `\nDISAPPEARED FOR-PROFIT (top 15, >$1M, last before 2020):\n`;
    disappearedRes.rows.slice(0, 15).forEach(r => {
      txt += `  $${r.total_millions}M | Last ${r.last_year} | ${(r.name || '').slice(0, 50)}\n`;
    });

    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT report: ${txtPath}`);

    log.section('Zombie & Ghost Analysis Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
