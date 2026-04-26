/**
 * 01-provincial-equity.js - Per-Capita Provincial Funding Analysis
 *
 * Challenges supported: #7 Policy Misalignment, #8 Duplicative Funding / Gaps
 *
 * Compares federal grant funding across provinces and territories on a per-capita
 * basis to surface regional inequities, gaps, and inconsistencies.
 *
 * Outputs: data/reports/provincial-equity.json + .txt
 *
 * Usage: node scripts/advanced/01-provincial-equity.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

// Statistics Canada 2024 Q3 population estimates
const POPULATION = {
  ON: { name: 'Ontario', pop: 15801768 },
  QC: { name: 'Quebec', pop: 8948540 },
  BC: { name: 'British Columbia', pop: 5581127 },
  AB: { name: 'Alberta', pop: 4756408 },
  MB: { name: 'Manitoba', pop: 1456675 },
  SK: { name: 'Saskatchewan', pop: 1214396 },
  NS: { name: 'Nova Scotia', pop: 1058094 },
  NB: { name: 'New Brunswick', pop: 832579 },
  NL: { name: 'Newfoundland & Labrador', pop: 533710 },
  PE: { name: 'Prince Edward Island', pop: 175853 },
  NT: { name: 'Northwest Territories', pop: 44895 },
  YT: { name: 'Yukon', pop: 44238 },
  NU: { name: 'Nunavut', pop: 40586 },
};
const TOTAL_POP = Object.values(POPULATION).reduce((s, p) => s + p.pop, 0);

function esc(v) { return v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; }

async function run() {
  log.section('Provincial Equity Analysis');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const report = { generatedAt: new Date().toISOString(), sections: {} };

  try {
    await db.query('SET search_path TO fed, public;');

    // ── 1. Overall per-capita by province ────────────────────────
    log.info('1. Overall per-capita funding by province...');
    const overallRes = await db.query(`
      SELECT recipient_province AS prov,
             COUNT(*) AS grant_count,
             SUM(agreement_value) AS total_value,
             AVG(agreement_value) AS avg_value,
             COUNT(DISTINCT owner_org) AS dept_count,
             COUNT(DISTINCT prog_name_en) AS program_count
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_province IS NOT NULL
        AND LENGTH(recipient_province) = 2
      GROUP BY recipient_province
      ORDER BY total_value DESC
    `);

    const perCapita = overallRes.rows
      .filter(r => POPULATION[r.prov])
      .map(r => {
        const pop = POPULATION[r.prov].pop;
        const total = parseFloat(r.total_value) || 0;
        return {
          province: POPULATION[r.prov].name,
          code: r.prov,
          population: pop,
          grant_count: parseInt(r.grant_count),
          total_value: total,
          per_capita: Math.round(total / pop),
          grants_per_10k_people: Math.round(parseInt(r.grant_count) / pop * 10000),
          dept_count: parseInt(r.dept_count),
          program_count: parseInt(r.program_count),
        };
      })
      .sort((a, b) => b.per_capita - a.per_capita);

    const avgPerCapita = Math.round(perCapita.reduce((s, r) => s + r.total_value, 0) / TOTAL_POP);
    perCapita.forEach(r => {
      r.deviation_from_avg_pct = Math.round((r.per_capita - avgPerCapita) / avgPerCapita * 100);
    });

    report.sections.per_capita_overall = {
      title: 'Per-Capita Federal Funding by Province/Territory',
      national_average_per_capita: avgPerCapita,
      data: perCapita,
    };
    log.info(`  National average: $${avgPerCapita.toLocaleString()} per capita`);
    log.info(`  Highest: ${perCapita[0].province} at $${perCapita[0].per_capita.toLocaleString()}/capita (+${perCapita[0].deviation_from_avg_pct}%)`);
    log.info(`  Lowest: ${perCapita[perCapita.length-1].province} at $${perCapita[perCapita.length-1].per_capita.toLocaleString()}/capita (${perCapita[perCapita.length-1].deviation_from_avg_pct}%)`);

    // ── 2. Per-capita by agreement type ──────────────────────────
    log.info('2. Per-capita by agreement type...');
    const byTypeRes = await db.query(`
      SELECT recipient_province AS prov, agreement_type,
             SUM(agreement_value) AS total_value
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_province IS NOT NULL
        AND LENGTH(recipient_province) = 2 AND agreement_type IS NOT NULL
      GROUP BY recipient_province, agreement_type
    `);

    const typeLabels = { G: 'Grants', C: 'Contributions', O: 'Other' };
    const byTypePerCapita = {};
    for (const r of byTypeRes.rows) {
      if (!POPULATION[r.prov]) continue;
      if (!byTypePerCapita[r.prov]) {
        byTypePerCapita[r.prov] = { province: POPULATION[r.prov].name, code: r.prov };
      }
      const typeName = typeLabels[r.agreement_type] || r.agreement_type;
      byTypePerCapita[r.prov][`${typeName}_per_capita`] = Math.round(parseFloat(r.total_value) / POPULATION[r.prov].pop);
    }
    report.sections.per_capita_by_type = {
      title: 'Per-Capita Funding by Agreement Type',
      data: Object.values(byTypePerCapita).sort((a, b) => (b.Contributions_per_capita || 0) - (a.Contributions_per_capita || 0)),
    };

    // ── 3. Per-capita by recipient type ──────────────────────────
    log.info('3. Per-capita by recipient type...');
    const byRecipTypeRes = await db.query(`
      SELECT recipient_province AS prov, rtl.name_en AS recipient_type,
             SUM(gc.agreement_value) AS total_value,
             COUNT(*) AS grant_count
      FROM fed.grants_contributions gc
      JOIN fed.recipient_type_lookup rtl ON gc.recipient_type = rtl.code
      WHERE gc.is_amendment = false AND gc.recipient_province IS NOT NULL
        AND LENGTH(gc.recipient_province) = 2
      GROUP BY gc.recipient_province, rtl.name_en
    `);

    const recipTypeData = {};
    for (const r of byRecipTypeRes.rows) {
      if (!POPULATION[r.prov]) continue;
      if (!recipTypeData[r.prov]) {
        recipTypeData[r.prov] = { province: POPULATION[r.prov].name, code: r.prov, types: {} };
      }
      recipTypeData[r.prov].types[r.recipient_type] = {
        total: parseFloat(r.total_value),
        per_capita: Math.round(parseFloat(r.total_value) / POPULATION[r.prov].pop),
        count: parseInt(r.grant_count),
      };
    }
    report.sections.per_capita_by_recipient_type = {
      title: 'Per-Capita Funding by Recipient Type per Province',
      data: Object.values(recipTypeData).sort((a, b) => {
        const aTotal = Object.values(a.types).reduce((s, t) => s + t.total, 0);
        const bTotal = Object.values(b.types).reduce((s, t) => s + t.total, 0);
        return bTotal - aTotal;
      }),
    };

    // ── 4. Department funding fairness ───────────────────────────
    log.info('4. Department funding fairness across provinces...');
    const deptProvRes = await db.query(`
      SELECT owner_org_title AS dept, recipient_province AS prov,
             SUM(agreement_value) AS total_value
      FROM fed.grants_contributions
      WHERE is_amendment = false AND recipient_province IS NOT NULL
        AND LENGTH(recipient_province) = 2
        AND owner_org_title IS NOT NULL
      GROUP BY owner_org_title, recipient_province
    `);

    // For top 10 departments, compute per-capita by province
    const deptTotals = {};
    for (const r of deptProvRes.rows) {
      if (!deptTotals[r.dept]) deptTotals[r.dept] = 0;
      deptTotals[r.dept] += parseFloat(r.total_value) || 0;
    }
    const topDepts = Object.entries(deptTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    const deptFairness = {};
    for (const dept of topDepts) {
      deptFairness[dept] = { department: dept, provinces: {} };
      const deptRows = deptProvRes.rows.filter(r => r.dept === dept);
      for (const r of deptRows) {
        if (!POPULATION[r.prov]) continue;
        deptFairness[dept].provinces[POPULATION[r.prov].name] = {
          total: parseFloat(r.total_value),
          per_capita: Math.round(parseFloat(r.total_value) / POPULATION[r.prov].pop),
        };
      }
      // Compute coefficient of variation
      const pcValues = Object.values(deptFairness[dept].provinces).map(p => p.per_capita);
      const mean = pcValues.reduce((s, v) => s + v, 0) / pcValues.length;
      const stddev = Math.sqrt(pcValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pcValues.length);
      deptFairness[dept].coefficient_of_variation = Math.round(stddev / mean * 100);
      deptFairness[dept].mean_per_capita = Math.round(mean);
      deptFairness[dept].stddev_per_capita = Math.round(stddev);
    }

    report.sections.department_fairness = {
      title: 'Department Funding Fairness (Coefficient of Variation across Provinces)',
      note: 'Higher CV = more uneven distribution. CV > 100% means highly concentrated.',
      data: Object.values(deptFairness).sort((a, b) => b.coefficient_of_variation - a.coefficient_of_variation),
    };

    // ── 5. Territorial vs Provincial gap ─────────────────────────
    log.info('5. Territorial vs Provincial funding gap...');
    const territories = ['NT', 'YT', 'NU'];
    const provCodes = Object.keys(POPULATION).filter(c => !territories.includes(c));

    const terrTotal = perCapita.filter(r => territories.includes(r.code)).reduce((s, r) => s + r.total_value, 0);
    const terrPop = territories.reduce((s, c) => s + POPULATION[c].pop, 0);
    const provTotal = perCapita.filter(r => provCodes.includes(r.code)).reduce((s, r) => s + r.total_value, 0);
    const provPop = provCodes.reduce((s, c) => s + POPULATION[c].pop, 0);

    report.sections.territorial_gap = {
      title: 'Territories vs Provinces Funding Gap',
      territories: {
        population: terrPop,
        total_value: terrTotal,
        per_capita: Math.round(terrTotal / terrPop),
      },
      provinces: {
        population: provPop,
        total_value: provTotal,
        per_capita: Math.round(provTotal / provPop),
      },
      territory_multiplier: Math.round((terrTotal / terrPop) / (provTotal / provPop) * 10) / 10,
    };
    log.info(`  Territories: $${Math.round(terrTotal / terrPop).toLocaleString()}/capita`);
    log.info(`  Provinces: $${Math.round(provTotal / provPop).toLocaleString()}/capita`);
    log.info(`  Territory multiplier: ${report.sections.territorial_gap.territory_multiplier}x`);

    // ── 6. Year-over-year per-capita trends ──────────────────────
    log.info('6. Per-capita trends over time...');
    const trendRes = await db.query(`
      SELECT recipient_province AS prov,
             EXTRACT(YEAR FROM agreement_start_date)::int AS year,
             SUM(agreement_value) AS total_value,
             COUNT(*) AS grant_count
      FROM fed.grants_contributions
      WHERE is_amendment = false AND agreement_start_date IS NOT NULL
        AND recipient_province IS NOT NULL AND LENGTH(recipient_province) = 2
        AND EXTRACT(YEAR FROM agreement_start_date) BETWEEN 2018 AND 2025
      GROUP BY recipient_province, EXTRACT(YEAR FROM agreement_start_date)
      ORDER BY 1, 2
    `);

    const trends = {};
    for (const r of trendRes.rows) {
      if (!POPULATION[r.prov]) continue;
      if (!trends[r.prov]) trends[r.prov] = { province: POPULATION[r.prov].name, code: r.prov, years: {} };
      trends[r.prov].years[r.year] = {
        total: parseFloat(r.total_value),
        per_capita: Math.round(parseFloat(r.total_value) / POPULATION[r.prov].pop),
        grants: parseInt(r.grant_count),
      };
    }
    report.sections.per_capita_trends = {
      title: 'Per-Capita Funding Trends (2018-2025)',
      data: Object.values(trends),
    };

    // ── Write reports ────────────────────────────────────────────
    const jsonPath = path.join(OUTPUT_DIR, 'provincial-equity.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`\nJSON report: ${jsonPath}`);

    // Write TXT summary
    const txtPath = path.join(OUTPUT_DIR, 'provincial-equity.txt');
    let txt = `PROVINCIAL EQUITY ANALYSIS\nGenerated: ${report.generatedAt}\n${'='.repeat(70)}\n\n`;

    txt += `NATIONAL AVERAGE: $${avgPerCapita.toLocaleString()} per capita\n\n`;
    txt += `PER-CAPITA RANKING:\n`;
    txt += `${'Province'.padEnd(30)} ${'Per Capita'.padStart(12)} ${'Deviation'.padStart(10)} ${'Total ($B)'.padStart(12)} ${'Grants'.padStart(10)}\n`;
    txt += `${'-'.repeat(74)}\n`;
    for (const r of perCapita) {
      txt += `${r.province.padEnd(30)} $${r.per_capita.toLocaleString().padStart(10)} ${(r.deviation_from_avg_pct > 0 ? '+' : '') + r.deviation_from_avg_pct + '%'.padStart(9)} $${(r.total_value / 1e9).toFixed(1).padStart(10)} ${r.grant_count.toLocaleString().padStart(10)}\n`;
    }

    txt += `\nTERRITORIAL GAP:\n`;
    txt += `  Territories: $${Math.round(terrTotal / terrPop).toLocaleString()}/capita\n`;
    txt += `  Provinces:   $${Math.round(provTotal / provPop).toLocaleString()}/capita\n`;
    txt += `  Multiplier:  ${report.sections.territorial_gap.territory_multiplier}x\n`;

    txt += `\nDEPARTMENT FAIRNESS (CV = higher means more uneven):\n`;
    for (const d of report.sections.department_fairness.data) {
      txt += `  CV ${String(d.coefficient_of_variation).padStart(4)}% | ${d.department.slice(0, 60)}\n`;
    }

    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT report: ${txtPath}`);

    log.section('Provincial Equity Analysis Complete');

  } catch (err) {
    log.error(`Analysis failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
