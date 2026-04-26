/**
 * 10-fed-cra-enhanced.js - Enhanced FED-CRA cross-reference
 *
 * Improvements over 09-fed-cra-crossref.js:
 *   1. Uses field_4540 (federal revenue) + year-over-year INCREASE in field_4310
 *      (deferred revenue) as "effective federal cash received" per year
 *   2. Does CUMULATIVE comparison: sum of CRA federal revenue across ALL years
 *      vs FED grant total (not just 3-year window)
 *   3. Flags entities where cumulative CRA federal revenue is materially less than
 *      cumulative FED grants even over the full period
 *   4. Excludes government entities from charity analysis
 *
 * Usage: node scripts/advanced/10-fed-cra-enhanced.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  log.section('Enhanced FED-CRA Cross-Reference');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    // ── Step 1: FED cumulative grants per BN (all years) ─────────
    log.info('Step 1: FED cumulative grants per BN...');
    const fedRes = await db.query(`
      SELECT recipient_business_number AS bn9,
             MAX(recipient_legal_name) AS fed_name,
             ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = false AND agreement_value > 0)::numeric, 2) AS fed_original_total,
             ROUND(SUM(agreement_value)::numeric, 2) AS fed_net_total,
             COUNT(*) FILTER (WHERE is_amendment = false) AS original_grants,
             COUNT(*) FILTER (WHERE is_amendment = true) AS amendments,
             MIN(agreement_start_date) AS first_grant,
             MAX(agreement_start_date) AS last_grant
      FROM fed.grants_contributions
      WHERE recipient_business_number IS NOT NULL
        AND LENGTH(recipient_business_number) = 9
      GROUP BY recipient_business_number
      HAVING SUM(agreement_value) FILTER (WHERE is_amendment = false AND agreement_value > 0) >= 100000
      ORDER BY SUM(agreement_value) DESC
    `);
    log.info(`  ${fedRes.rows.length} FED entities with >=$100K in grants`);

    // ── Step 2: CRA cumulative federal revenue + deferred per BN ─
    log.info('Step 2: CRA cumulative federal revenue + deferred revenue per BN...');
    const craRes = await db.query(`
      WITH yearly AS (
        SELECT LEFT(ci.bn, 9) AS bn9,
               ci.bn AS full_bn,
               MAX(ci.legal_name) AS cra_name,
               ci.fiscal_year,
               MAX(fd.field_4540) AS federal_rev,
               MAX(fd.field_4550) AS provincial_rev,
               MAX(fd.field_4560) AS municipal_rev,
               MAX(fd.field_4310) AS deferred_rev,
               MAX(fd.field_4700) AS total_rev,
               MAX(fd.field_4200) AS total_assets
        FROM cra.cra_identification ci
        JOIN cra.cra_financial_details fd ON ci.bn = fd.bn
          AND EXTRACT(YEAR FROM fd.fpe) = ci.fiscal_year
        GROUP BY LEFT(ci.bn, 9), ci.bn, ci.fiscal_year
      )
      SELECT bn9,
             MAX(cra_name) AS cra_name,
             ROUND(SUM(COALESCE(federal_rev, 0))::numeric, 2) AS cumulative_federal_rev,
             ROUND(SUM(COALESCE(provincial_rev, 0))::numeric, 2) AS cumulative_provincial_rev,
             ROUND(SUM(COALESCE(municipal_rev, 0))::numeric, 2) AS cumulative_municipal_rev,
             ROUND(SUM(COALESCE(total_rev, 0))::numeric, 2) AS cumulative_total_rev,
             -- Deferred: latest minus earliest gives net change over period
             ROUND((MAX(deferred_rev) - MIN(deferred_rev))::numeric, 2) AS deferred_change,
             -- Latest deferred balance
             ROUND(MAX(CASE WHEN fiscal_year = (SELECT MAX(fiscal_year) FROM cra.cra_identification) THEN deferred_rev END)::numeric, 2) AS latest_deferred,
             MIN(fiscal_year) AS first_cra_year,
             MAX(fiscal_year) AS last_cra_year,
             COUNT(DISTINCT fiscal_year) AS cra_years
      FROM yearly
      GROUP BY bn9
    `);
    log.info(`  ${craRes.rows.length} CRA entities with financial data`);

    // Build CRA lookup
    const craLookup = {};
    for (const r of craRes.rows) {
      craLookup[r.bn9] = {
        cra_name: r.cra_name,
        cumulative_federal: parseFloat(r.cumulative_federal_rev) || 0,
        cumulative_provincial: parseFloat(r.cumulative_provincial_rev) || 0,
        cumulative_municipal: parseFloat(r.cumulative_municipal_rev) || 0,
        cumulative_total: parseFloat(r.cumulative_total_rev) || 0,
        deferred_change: parseFloat(r.deferred_change) || 0,
        latest_deferred: parseFloat(r.latest_deferred) || 0,
        first_year: parseInt(r.first_cra_year),
        last_year: parseInt(r.last_cra_year),
        cra_years: parseInt(r.cra_years),
      };
    }

    // ── Step 3: Match and compare ────────────────────────────────
    log.info('Step 3: Matching and comparing...');

    const GOV_PATTERNS = ['government', 'gouvernement', 'province of', 'province de',
      'ministry', 'ministère', 'ministre', 'batch report', 'rapport en lots'];

    const comparisons = [];
    let matched = 0, noMatch = 0, govExcluded = 0;

    for (const f of fedRes.rows) {
      const bn9 = f.bn9;
      const fedName = f.fed_name || '';
      const lower = fedName.toLowerCase();

      // Exclude government entities
      if (GOV_PATTERNS.some(p => lower.includes(p))) { govExcluded++; continue; }

      const cra = craLookup[bn9];
      if (!cra) { noMatch++; continue; }
      matched++;

      const fedOriginal = parseFloat(f.fed_original_total) || 0;
      const fedNet = parseFloat(f.fed_net_total) || 0;

      // Effective federal cash received = cumulative recognized + net deferred increase
      // (if deferred went UP, that's cash received but not yet recognized as revenue)
      const craEffective = cra.cumulative_federal + Math.max(0, cra.deferred_change);

      // Cumulative comparison
      const gap = fedOriginal - cra.cumulative_federal;
      const gapWithDeferred = fedOriginal - craEffective;

      let flag;
      if (cra.cumulative_federal === 0 && cra.latest_deferred === 0) {
        flag = 'CRA_REPORTS_ZERO';
      } else if (fedOriginal <= craEffective * 1.15) {
        flag = 'RECONCILED';
      } else if (fedOriginal <= craEffective * 2) {
        flag = 'FED_MODERATELY_HIGHER';
      } else if (fedOriginal <= craEffective * 5) {
        flag = 'FED_MUCH_HIGHER';
      } else {
        flag = 'FED_EXTREMELY_HIGHER';
      }

      comparisons.push({
        bn: bn9,
        fed_name: fedName,
        cra_name: cra.cra_name,
        fed_original: fedOriginal,
        fed_net: fedNet,
        fed_grants: parseInt(f.original_grants),
        fed_amendments: parseInt(f.amendments),
        cra_cumulative_federal: cra.cumulative_federal,
        cra_cumulative_total: cra.cumulative_total,
        cra_deferred_change: cra.deferred_change,
        cra_latest_deferred: cra.latest_deferred,
        cra_effective: craEffective,
        cra_years: cra.cra_years,
        gap,
        gap_with_deferred: gapWithDeferred,
        gap_pct: craEffective > 0 ? Math.round((fedOriginal / craEffective - 1) * 100) : null,
        flag,
        fed_dependency_pct: cra.cumulative_total > 0
          ? Math.round(cra.cumulative_federal / cra.cumulative_total * 100) : null,
      });
    }

    comparisons.sort((a, b) => b.gap_with_deferred - a.gap_with_deferred);

    const flags = {};
    comparisons.forEach(r => { flags[r.flag] = (flags[r.flag] || 0) + 1; });

    log.info(`  Matched: ${matched} | No CRA: ${noMatch} | Gov excluded: ${govExcluded}`);
    log.info('  Results:');
    Object.entries(flags).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      log.info(`    ${k}: ${v} (${(v / matched * 100).toFixed(1)}%)`);
    });

    report.sections.summary = {
      matched, no_cra_match: noMatch, gov_excluded: govExcluded, flags,
      method: 'Cumulative FED grants vs cumulative CRA field_4540 + deferred revenue change',
    };

    // ── Step 4: Top discrepancies ────────────────────────────────
    const suspicious = comparisons.filter(r =>
      r.flag === 'FED_MUCH_HIGHER' || r.flag === 'FED_EXTREMELY_HIGHER' || r.flag === 'CRA_REPORTS_ZERO'
    );

    report.sections.suspicious = {
      title: 'Material cumulative discrepancies',
      count: suspicious.length,
      data: suspicious.slice(0, 100),
    };
    log.info(`  Material discrepancies: ${suspicious.length}`);

    // ── Step 5: NEW — Entities where deferred revenue resolved it
    const resolvedByDeferred = comparisons.filter(r => {
      return r.gap > r.fed_original * 0.15 && r.gap_with_deferred <= r.fed_original * 0.15;
    });
    report.sections.deferred_resolved = {
      title: 'Entities where deferred revenue resolved the gap',
      count: resolvedByDeferred.length,
      data: resolvedByDeferred.slice(0, 30),
    };
    log.info(`  Resolved by deferred revenue: ${resolvedByDeferred.length}`);

    // ── Step 6: NEW — High federal dependency charities ──────────
    const highDep = comparisons.filter(r =>
      r.fed_dependency_pct !== null && r.fed_dependency_pct >= 80 && r.cra_cumulative_federal >= 1000000
    ).sort((a, b) => b.cra_cumulative_federal - a.cra_cumulative_federal);

    report.sections.high_dependency = {
      title: 'Charities with 80%+ of revenue from federal government',
      count: highDep.length,
      data: highDep.slice(0, 50),
    };
    log.info(`  High federal dependency (>=80%): ${highDep.length}`);

    // ── Step 7: NEW — Charities with NULL field_4540 but revenue ─
    const nullFederal = comparisons.filter(r =>
      r.flag === 'CRA_REPORTS_ZERO' && r.cra_cumulative_total > 500000
    ).sort((a, b) => b.fed_original - a.fed_original);

    report.sections.null_federal = {
      title: 'Charities reporting revenue but NULL/zero in field_4540 (possible misclassification)',
      count: nullFederal.length,
      data: nullFederal.slice(0, 30),
    };
    log.info(`  NULL federal revenue with total revenue > $500K: ${nullFederal.length}`);

    // ── Write ────────────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'fed-cra-enhanced.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON: ${jsonPath}`);

    let txt = `ENHANCED FED-CRA CROSS-REFERENCE\nGenerated: ${report.generatedAt}\n`;
    txt += `Method: Cumulative comparison + deferred revenue (4310) adjustment\n`;
    txt += `CRA fields: 4540 (federal rev) + 4310 (deferred rev change)\n${'='.repeat(70)}\n\n`;

    txt += `MATCHED: ${matched} entities | NO CRA: ${noMatch} | GOV EXCLUDED: ${govExcluded}\n\n`;
    txt += `RECONCILIATION (cumulative, with deferred adjustment):\n`;
    Object.entries(flags).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      txt += `  ${k.padEnd(26)} ${String(v).padStart(5)} (${(v / matched * 100).toFixed(1)}%)\n`;
    });
    txt += `  Resolved by deferred:    ${resolvedByDeferred.length}\n`;

    txt += `\nTOP 30 CUMULATIVE DISCREPANCIES:\n`;
    txt += `${'BN'.padEnd(11)} ${'FED Total'.padStart(12)} ${'CRA Fed'.padStart(12)} ${'Deferred'.padStart(10)} ${'Effective'.padStart(12)} ${'Gap%'.padStart(6)} Name\n`;
    txt += `${'─'.repeat(95)}\n`;
    suspicious.slice(0, 30).forEach(r => {
      const m = (v) => '$'+(v/1e6).toFixed(1)+'M';
      txt += `${r.bn.padEnd(11)} ${m(r.fed_original).padStart(12)} ${m(r.cra_cumulative_federal).padStart(12)} ${m(r.cra_deferred_change).padStart(10)} ${m(r.cra_effective).padStart(12)} ${(r.gap_pct !== null ? r.gap_pct+'%' : 'N/A').padStart(6)} ${(r.fed_name||'').slice(0,28)}\n`;
    });

    txt += `\nHIGH FEDERAL DEPENDENCY (>=80% of revenue from federal, >$1M):\n`;
    highDep.slice(0, 20).forEach(r => {
      txt += `  ${r.fed_dependency_pct}% fed | $${(r.cra_cumulative_federal/1e6).toFixed(1)}M | ${(r.cra_name||r.fed_name||'').slice(0,50)}\n`;
    });

    txt += `\nNULL FEDERAL REVENUE (CRA 4540=0 but has total revenue):\n`;
    nullFederal.slice(0, 15).forEach(r => {
      txt += `  FED $${(r.fed_original/1e6).toFixed(1)}M | CRA rev $${(r.cra_cumulative_total/1e6).toFixed(1)}M | ${(r.fed_name||'').slice(0,50)}\n`;
    });

    const txtPath = path.join(OUTPUT_DIR, 'fed-cra-enhanced.txt');
    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT: ${txtPath}`);

    log.section('Enhanced Cross-Reference Complete');

  } catch (err) {
    log.error(`Failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
