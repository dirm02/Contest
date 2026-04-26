/**
 * 09-fed-cra-crossref.js - Cross-reference FED grants with CRA T3010 filings
 *
 * Compares FED agreement_value against CRA field_4540 ("Total revenue received
 * from federal government") using sequential queries to avoid timeout on
 * remote database.
 *
 * 3-year window: checks CRA year-1, same year, year+1 for each FED grant year.
 *
 * Usage: node scripts/advanced/09-fed-cra-crossref.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('FED-CRA Cross-Reference (Sequential)');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    // ── Step 1: Get FED grants aggregated by BN + year ───────────
    log.info('Step 1: Aggregating FED grants by BN and year (2020-2023)...');
    const fedRes = await db.query(`
      SELECT LEFT(recipient_business_number, 9) AS bn9,
             MAX(recipient_legal_name) AS fed_name,
             EXTRACT(YEAR FROM agreement_start_date)::int AS fed_year,
             ROUND(SUM(agreement_value)::numeric, 2) AS fed_total,
             COUNT(*) AS fed_grants
      FROM fed.grants_contributions
      WHERE is_amendment = false AND agreement_value > 0
        AND recipient_business_number IS NOT NULL
        AND LENGTH(recipient_business_number) >= 9
        AND EXTRACT(YEAR FROM agreement_start_date) BETWEEN 2020 AND 2023
      GROUP BY LEFT(recipient_business_number, 9), EXTRACT(YEAR FROM agreement_start_date)
      HAVING SUM(agreement_value) >= 50000
      ORDER BY SUM(agreement_value) DESC
    `);
    log.info(`  ${fedRes.rows.length} FED entity-year pairs (>=$50K)`);

    // ── Step 2: Get CRA field_4540 (federal revenue) by BN + year
    log.info('Step 2: Getting CRA field_4540 (federal govt revenue) by BN and year...');
    const craRes = await db.query(`
      SELECT LEFT(ci.bn, 9) AS bn9,
             ci.bn AS full_bn,
             MAX(ci.legal_name) AS cra_name,
             ci.fiscal_year AS cra_year,
             MAX(fd.field_4540) AS federal_revenue,
             MAX(fd.field_4550) AS provincial_revenue,
             MAX(fd.field_4560) AS municipal_revenue,
             MAX(fd.field_4700) AS total_revenue
      FROM cra.cra_identification ci
      JOIN cra.cra_financial_details fd ON ci.bn = fd.bn
        AND EXTRACT(YEAR FROM fd.fpe) = ci.fiscal_year
      WHERE ci.fiscal_year BETWEEN 2020 AND 2024
      GROUP BY LEFT(ci.bn, 9), ci.bn, ci.fiscal_year
    `);
    log.info(`  ${craRes.rows.length} CRA entity-year records`);

    // Build CRA lookup: bn9 -> { year -> { federal_revenue, ... } }
    const craLookup = {};
    for (const r of craRes.rows) {
      if (!craLookup[r.bn9]) craLookup[r.bn9] = {};
      const yr = parseInt(r.cra_year);
      // Keep the max if multiple filings for same BN+year
      if (!craLookup[r.bn9][yr] || parseFloat(r.federal_revenue || 0) > parseFloat(craLookup[r.bn9][yr].federal_revenue || 0)) {
        craLookup[r.bn9][yr] = {
          cra_name: r.cra_name,
          federal_revenue: parseFloat(r.federal_revenue) || 0,
          provincial_revenue: parseFloat(r.provincial_revenue) || 0,
          municipal_revenue: parseFloat(r.municipal_revenue) || 0,
          total_revenue: parseFloat(r.total_revenue) || 0,
        };
      }
    }
    const matchedBNs = Object.keys(craLookup).length;
    log.info(`  ${matchedBNs} unique CRA BNs in lookup`);

    // ── Step 3: Compare each FED entity-year against CRA ─────────
    log.info('Step 3: Comparing FED vs CRA with 3-year window...');

    const comparisons = [];
    let reconciled = 0, fedHigher = 0, fedMuchHigher = 0, craZero = 0, noMatch = 0;

    for (const f of fedRes.rows) {
      const bn9 = f.bn9;
      const fedYear = parseInt(f.fed_year);
      const fedTotal = parseFloat(f.fed_total);
      const cra = craLookup[bn9];

      if (!cra) {
        noMatch++;
        continue;
      }

      const same = cra[fedYear] || null;
      const prev = cra[fedYear - 1] || null;
      const nxt = cra[fedYear + 1] || null;

      const craSame = same ? same.federal_revenue : 0;
      const craPrev = prev ? prev.federal_revenue : 0;
      const craNext = nxt ? nxt.federal_revenue : 0;
      const craBest = Math.max(craSame, craPrev, craNext);

      let flag;
      if (craBest === 0) {
        flag = 'CRA_REPORTS_ZERO';
        craZero++;
      } else if (fedTotal <= craBest * 1.1) {
        flag = 'RECONCILED';
        reconciled++;
      } else if (fedTotal <= craBest * 2) {
        flag = 'FED_SLIGHTLY_HIGHER';
        fedHigher++;
      } else {
        flag = 'FED_MUCH_HIGHER';
        fedMuchHigher++;
      }

      comparisons.push({
        bn: bn9,
        fed_name: f.fed_name,
        cra_name: same?.cra_name || prev?.cra_name || nxt?.cra_name || null,
        fed_year: fedYear,
        fed_total: fedTotal,
        fed_grants: parseInt(f.fed_grants),
        cra_fed_same: craSame,
        cra_fed_prev: craPrev,
        cra_fed_next: craNext,
        cra_best_match: craBest,
        discrepancy: fedTotal - craBest,
        flag,
      });
    }

    const total = comparisons.length;
    const flags = { RECONCILED: reconciled, FED_SLIGHTLY_HIGHER: fedHigher, FED_MUCH_HIGHER: fedMuchHigher, CRA_REPORTS_ZERO: craZero };

    log.info(`  Compared: ${total} entity-year pairs (${noMatch} had no CRA match)`);
    log.info(`  Results:`);
    Object.entries(flags).forEach(([k, v]) => {
      log.info(`    ${k}: ${v} (${(v / total * 100).toFixed(1)}%)`);
    });

    report.sections.comparison = { total, no_cra_match: noMatch, flags };

    // ── Step 4: Top suspicious (FED >> CRA) ──────────────────────
    const suspicious = comparisons
      .filter(r => r.flag === 'FED_MUCH_HIGHER' || r.flag === 'CRA_REPORTS_ZERO')
      .sort((a, b) => b.discrepancy - a.discrepancy);

    report.sections.suspicious = {
      title: 'Material discrepancies (FED much higher than CRA, even with 3-year window)',
      count: suspicious.length,
      total_discrepancy_billions: (suspicious.reduce((s, r) => s + r.discrepancy, 0) / 1e9).toFixed(2),
      data: suspicious.slice(0, 100),
    };
    log.info(`  Suspicious: ${suspicious.length} entity-years`);

    // ── Step 5: Cases resolved by adjacent year ──────────────────
    const resolvedByWindow = comparisons.filter(r => {
      return r.cra_fed_same < r.fed_total * 0.5 && r.cra_best_match >= r.fed_total * 0.5;
    });
    report.sections.timing_resolved = { count: resolvedByWindow.length };
    log.info(`  Resolved by adjacent-year: ${resolvedByWindow.length}`);

    // ── Step 6: Aggregate by year ────────────────────────────────
    log.info('Step 4: Aggregate by year...');
    const byYear = {};
    for (const c of comparisons) {
      if (!byYear[c.fed_year]) byYear[c.fed_year] = { fed: 0, cra_same: 0, cra_best: 0 };
      byYear[c.fed_year].fed += c.fed_total;
      byYear[c.fed_year].cra_same += c.cra_fed_same;
      byYear[c.fed_year].cra_best += c.cra_best_match;
    }
    const aggregate = Object.entries(byYear).sort().map(([yr, v]) => ({
      year: parseInt(yr),
      fed_billions: (v.fed / 1e9).toFixed(2),
      cra_same_year_billions: (v.cra_same / 1e9).toFixed(2),
      cra_best_window_billions: (v.cra_best / 1e9).toFixed(2),
      gap_billions: ((v.fed - v.cra_best) / 1e9).toFixed(2),
    }));
    report.sections.aggregate = { data: aggregate };
    log.info('  Year-by-year:');
    aggregate.forEach(r => {
      log.info(`    ${r.year}: FED $${r.fed_billions}B | CRA same-yr $${r.cra_same_year_billions}B | CRA best $${r.cra_best_window_billions}B | Gap $${r.gap_billions}B`);
    });

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'fed-cra-crossref.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON: ${jsonPath}`);

    let txt = `FED-CRA CROSS-REFERENCE (CORRECTED)\nGenerated: ${report.generatedAt}\n`;
    txt += `CRA field: field_4540 = "Total revenue received from federal government"\n`;
    txt += `Window: same year, year-1, year+1\n${'='.repeat(70)}\n\n`;

    txt += `COMPARISONS: ${total} entity-year pairs (FED >= $50K)\n`;
    txt += `NO CRA MATCH: ${noMatch}\n\n`;

    txt += `RECONCILIATION:\n`;
    Object.entries(flags).forEach(([k, v]) => {
      txt += `  ${k.padEnd(22)} ${String(v).padStart(6)} (${(v / total * 100).toFixed(1)}%)\n`;
    });
    txt += `  Timing-resolved:     ${resolvedByWindow.length}\n`;

    txt += `\nAGGREGATE BY YEAR:\n`;
    txt += `Year  FED Paid     CRA Same-Yr    CRA Best(3yr)  Gap\n${'─'.repeat(60)}\n`;
    aggregate.forEach(r => {
      txt += `${r.year}  $${r.fed_billions}B      $${r.cra_same_year_billions}B        $${r.cra_best_window_billions}B       $${r.gap_billions}B\n`;
    });

    txt += `\nTOP 30 MATERIAL DISCREPANCIES:\n`;
    txt += `${'BN'.padEnd(11)} ${'Year'.padStart(5)} ${'FED'.padStart(12)} ${'CRA Same'.padStart(12)} ${'CRA Prev'.padStart(12)} ${'CRA Next'.padStart(12)} Name\n`;
    txt += `${'─'.repeat(95)}\n`;
    suspicious.slice(0, 30).forEach(r => {
      const f = (v) => v ? '$'+(v/1e6).toFixed(1)+'M' : '$0';
      txt += `${r.bn.padEnd(11)} ${String(r.fed_year).padStart(5)} ${f(r.fed_total).padStart(12)} ${f(r.cra_fed_same).padStart(12)} ${f(r.cra_fed_prev).padStart(12)} ${f(r.cra_fed_next).padStart(12)} ${(r.fed_name||'').slice(0,30)}\n`;
    });

    const txtPath = path.join(OUTPUT_DIR, 'fed-cra-crossref.txt');
    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT: ${txtPath}`);

    log.section('FED-CRA Cross-Reference Complete');

  } catch (err) {
    log.error(`Failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
