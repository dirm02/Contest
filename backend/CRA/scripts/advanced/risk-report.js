/**
 * risk-report.js
 *
 * Generate a comprehensive risk report for a single charity combining:
 *   - Financial analysis (overhead, program spending, compensation)
 *   - Circular gifting patterns (reciprocal, triangular, long cycles)
 *   - Network analysis (shared directors, associated entities)
 *   - Multi-year trends (revenue growth, spending patterns)
 *   - Risk scoring with evidence
 *
 * Output: data/reports/risk-{BN}.json and risk-{BN}.md
 *
 * Usage:
 *   node scripts/advanced/risk-report.js --name "some charity"
 *   node scripts/advanced/risk-report.js --bn 123456789RR0001
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const searchName = getArg('--name');
const searchBN = getArg('--bn');

if (!searchName && !searchBN) {
  console.log('Usage:');
  console.log('  node scripts/advanced/risk-report.js --name "some charity"');
  console.log('  node scripts/advanced/risk-report.js --bn 123456789RR0001');
  process.exit(0);
}

async function main() {
  const client = await db.getClient();

  try {
    // ── Find charity ─────────────────────────────────────────────
    let targetBN, targetName;
    if (searchBN) {
      const res = await client.query('SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification WHERE bn = $1 ORDER BY bn, fiscal_year DESC', [searchBN]);
      if (res.rows.length === 0) { log.error(`No charity found: ${searchBN}`); process.exit(1); }
      targetBN = res.rows[0].bn;
      targetName = res.rows[0].legal_name;
    } else {
      const res = await client.query('SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification WHERE legal_name ILIKE $1 ORDER BY bn, fiscal_year DESC LIMIT 10', [`%${searchName}%`]);
      if (res.rows.length === 0) { log.error(`No match for "${searchName}"`); process.exit(1); }
      if (res.rows.length > 1) {
        log.info(`Matches: ${res.rows.map(r => r.legal_name).join(', ')}`);
        log.info('Using first match.');
      }
      targetBN = res.rows[0].bn;
      targetName = res.rows[0].legal_name;
    }

    log.section(`Risk Report: ${targetName}`);
    log.info(`BN: ${targetBN}`);

    const report = {
      metadata: { generatedAt: new Date().toISOString() },
      charity: { bn: targetBN, name: targetName },
      identification: {},
      financialHistory: [],
      circularGifting: {},
      networkAnalysis: {},
      riskAssessment: { score: 0, maxScore: 30, factors: [] },
    };

    // ── Identification across years ──────────────────────────────
    const idRes = await client.query(
      `SELECT ci.*, cat.name_en AS category_name, dl.name_en AS designation_name
       FROM cra_identification ci
       LEFT JOIN cra_category_lookup cat ON ci.category = cat.code
       LEFT JOIN cra_designation_lookup dl ON ci.designation = dl.code
       WHERE ci.bn = $1 ORDER BY ci.fiscal_year DESC`, [targetBN]
    );
    if (idRes.rows.length > 0) {
      const latest = idRes.rows[0];
      report.identification = {
        legalName: latest.legal_name,
        accountName: latest.account_name,
        designation: latest.designation,
        designationName: latest.designation_name,
        category: latest.category,
        categoryName: latest.category_name,
        city: latest.city,
        province: latest.province,
        yearsRegistered: idRes.rows.map(r => r.fiscal_year).sort(),
      };
    }

    // ── Financial history (all years) ────────────────────────────
    const finRes = await client.query(`
      SELECT fd.fpe, EXTRACT(YEAR FROM fd.fpe) AS yr,
        -- Schedule 6 corrected field mapping
        fd.field_4700 AS revenue, fd.field_4500 AS receipted_gifts,
        fd.field_4510 AS gifts_from_charities, fd.field_4540 AS federal_govt_revenue,
        fd.field_4550 AS provincial_govt_revenue, fd.field_4560 AS municipal_govt_revenue,
        fd.field_5100 AS total_expenditures,
        fd.field_5000 AS program_spending, fd.field_5010 AS admin_spending,
        fd.field_5020 AS fundraising_spending,
        fd.field_5050 AS gifts_to_donees, fd.field_4200 AS total_assets,
        fd.field_4350 AS total_liabilities,
        c.field_300 AS full_time_positions, c.field_370 AS part_time_count, c.field_390 AS total_compensation
      FROM cra_financial_details fd
      LEFT JOIN cra_compensation c ON fd.bn = c.bn AND fd.fpe = c.fpe
      WHERE fd.bn = $1 ORDER BY fd.fpe
    `, [targetBN]);

    for (const r of finRes.rows) {
      const rev = parseFloat(r.revenue) || 0;
      const exp = parseFloat(r.total_expenditures) || 0;
      const prog = parseFloat(r.program_spending) || 0;
      const admin = parseFloat(r.admin_spending) || 0;
      const fund = parseFloat(r.fundraising_spending) || 0;
      const comp = parseFloat(r.total_compensation) || 0;

      report.financialHistory.push({
        fpe: r.fpe, year: parseInt(r.yr),
        revenue: rev,
        receiptedGifts: parseFloat(r.receipted_gifts) || 0,
        giftsFromCharities: parseFloat(r.gifts_from_charities) || 0,
        federalGovtRevenue: parseFloat(r.federal_govt_revenue) || 0,
        provincialGovtRevenue: parseFloat(r.provincial_govt_revenue) || 0,
        municipalGovtRevenue: parseFloat(r.municipal_govt_revenue) || 0,
        totalExpenditures: exp,
        programSpending: prog,
        adminSpending: admin,
        fundraisingSpending: fund,
        giftsToQualifiedDonees: parseFloat(r.gifts_to_donees) || 0,
        totalAssets: parseFloat(r.total_assets) || 0,
        totalLiabilities: parseFloat(r.total_liabilities) || 0,
        fullTimePositions: parseInt(r.full_time_positions) || 0,
        partTimeCount: parseInt(r.part_time_count) || 0,
        totalCompensation: comp,
        overheadPct: exp > 0 ? Math.round((admin + fund) / exp * 1000) / 10 : null,
        programPct: rev > 0 ? Math.round(prog / rev * 1000) / 10 : null,
        compensationPct: exp > 0 ? Math.round(comp / exp * 1000) / 10 : null,
      });
    }

    // ── Circular gifting ─────────────────────────────────────────
    const recipRes = await client.query(`
      SELECT qd.donee_bn AS partner, qd.donee_name AS partner_name,
             SUM(qd.total_gifts) AS amount_out,
             (SELECT SUM(i.total_gifts) FROM cra_qualified_donees i WHERE i.bn = qd.donee_bn AND i.donee_bn = $1 AND i.total_gifts > 0) AS amount_in,
             BOOL_OR(qd.associated) AS associated
      FROM cra_qualified_donees qd
      WHERE qd.bn = $1 AND qd.total_gifts > 0 AND qd.donee_bn IS NOT NULL AND LENGTH(qd.donee_bn) = 15
        AND EXISTS (SELECT 1 FROM cra_qualified_donees i WHERE i.bn = qd.donee_bn AND i.donee_bn = $1 AND i.total_gifts > 0)
      GROUP BY qd.donee_bn, qd.donee_name
      ORDER BY SUM(qd.total_gifts) DESC
    `, [targetBN]);

    let totalCircular = 0;
    const reciprocals = [];
    for (const r of recipRes.rows) {
      const out = parseFloat(r.amount_out);
      const amtIn = parseFloat(r.amount_in) || 0;
      // Fix for #45: use Math.min(out, in) to reflect true circular component
      totalCircular += Math.min(out, amtIn);
      reciprocals.push({
        partnerBN: r.partner, partnerName: r.partner_name,
        amountOut: out, amountIn: amtIn,
        associated: r.associated,
      });
    }
    // Per-year symmetric flow analysis (the strongest circular signal)
    log.info('  Analyzing same-year symmetric flows...');
    const symRes = await client.query(`
      WITH outflows AS (
        SELECT donee_bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amount
        FROM cra_qualified_donees
        WHERE bn = $1 AND donee_bn IS NOT NULL AND LENGTH(donee_bn) = 15 AND total_gifts >= 5000
        GROUP BY donee_bn, EXTRACT(YEAR FROM fpe)
      ),
      inflows AS (
        SELECT bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amount
        FROM cra_qualified_donees
        WHERE donee_bn = $1 AND total_gifts >= 5000
        GROUP BY bn, EXTRACT(YEAR FROM fpe)
      )
      SELECT o.partner, o.yr, o.amount AS amount_out, i.amount AS amount_in,
             LEAST(o.amount, i.amount) / GREATEST(o.amount, i.amount) AS symmetry,
             ci.legal_name AS partner_name
      FROM outflows o
      JOIN inflows i ON o.partner = i.partner AND o.yr = i.yr
      LEFT JOIN (SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC) ci ON o.partner = ci.bn
      WHERE o.amount >= 5000 AND i.amount >= 5000
      ORDER BY LEAST(o.amount, i.amount) / GREATEST(o.amount, i.amount) DESC, o.amount DESC
    `, [targetBN]);

    const sameYearSymmetric = symRes.rows.map(r => ({
      partnerBN: r.partner,
      partnerName: r.partner_name,
      year: parseInt(r.yr),
      amountOut: parseFloat(r.amount_out),
      amountIn: parseFloat(r.amount_in),
      symmetryPct: Math.round(parseFloat(r.symmetry) * 1000) / 10,
      riskLevel: parseFloat(r.symmetry) > 0.75 ? 'HIGH' : parseFloat(r.symmetry) > 0.5 ? 'MEDIUM' : 'LOW',
    }));

    report.circularGifting = {
      totalCircularAmount: totalCircular,
      reciprocalPartners: reciprocals,
      sameYearSymmetricFlows: sameYearSymmetric,
      sameYearHighRiskCount: sameYearSymmetric.filter(s => s.riskLevel === 'HIGH').length,
    };

    // ── Shared directors ─────────────────────────────────────────
    const dirRes = await client.query(`
      SELECT d1.last_name, d1.first_name, d2.bn AS other_bn, ci.legal_name AS other_name, d2.position
      FROM cra_directors d1
      JOIN cra_directors d2 ON d1.last_name = d2.last_name AND d1.first_name = d2.first_name AND d1.bn != d2.bn
      LEFT JOIN (SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC) ci ON d2.bn = ci.bn
      WHERE d1.bn = $1 AND d1.fpe >= '2022-01-01' AND d2.fpe >= '2022-01-01'
        AND d1.last_name IS NOT NULL AND d1.first_name IS NOT NULL
      GROUP BY d1.last_name, d1.first_name, d2.bn, ci.legal_name, d2.position
    `, [targetBN]);

    const directors = new Map();
    for (const r of dirRes.rows) {
      const key = `${r.last_name}, ${r.first_name}`;
      if (!directors.has(key)) directors.set(key, []);
      directors.get(key).push({ bn: r.other_bn, name: r.other_name, position: r.position });
    }
    report.networkAnalysis.sharedDirectors = [...directors].map(([name, orgs]) => ({ name, otherCharities: orgs }));

    // ── Risk scoring ─────────────────────────────────────────────
    let score = 0;
    const factors = [];
    const latest = report.financialHistory[report.financialHistory.length - 1];

    // #51: Count years with actual circular flows, not filing years
    const circularYears = new Set(sameYearSymmetric.map(s => s.year));

    if (reciprocals.length > 0) { score++; factors.push({ factor: 'Reciprocal giving detected', points: 1, detail: `${reciprocals.length} partners` }); }
    if (reciprocals.length >= 2) { score++; factors.push({ factor: 'Multiple circular cycles', points: 1, detail: `${reciprocals.length} reciprocal partners` }); }
    if (circularYears.size >= 2) { score++; factors.push({ factor: 'Multi-year circular pattern', points: 1, detail: `${circularYears.size} years with circular flows` }); }
    if (totalCircular > 100000) { score++; factors.push({ factor: 'Large circular amounts', points: 1, detail: `$${totalCircular.toLocaleString()}` }); }
    if (directors.size > 0) { score++; factors.push({ factor: 'Shared directors with network', points: 1, detail: `${directors.size} people` }); }
    if (reciprocals.some(r => r.associated)) { score++; factors.push({ factor: 'CRA associated donee flag', points: 1, detail: 'Set on one or more gifts' }); }

    if (latest) {
      const oh = latest.overheadPct || 0;
      if (oh > 40) { score += 2; factors.push({ factor: 'High overhead (>40%)', points: 2, detail: `${oh}%` }); }
      else if (oh > 25) { score++; factors.push({ factor: 'Elevated overhead (25-40%)', points: 1, detail: `${oh}%` }); }

      const pp = latest.programPct || 0;
      if (pp < 20 && latest.revenue > 100000) { score += 2; factors.push({ factor: 'Low program spending (<20%)', points: 2, detail: `${pp}% of revenue` }); }

      if (latest.totalCompensation > latest.programSpending && latest.programSpending > 0) {
        score += 2; factors.push({ factor: 'Compensation exceeds programs', points: 2, detail: `$${latest.totalCompensation.toLocaleString()} comp vs $${latest.programSpending.toLocaleString()} programs` });
      }

      if (totalCircular > latest.programSpending * 2 && latest.programSpending > 0) {
        score += 2; factors.push({ factor: 'Circular >> program spending', points: 2, detail: `$${totalCircular.toLocaleString()} circular vs $${latest.programSpending.toLocaleString()} programs` });
      }

      const charityFunded = latest.revenue > 0 ? latest.giftsFromCharities / latest.revenue : 0;
      if (charityFunded > 0.5) { score += 2; factors.push({ factor: 'Charity-funded (>50% from other charities)', points: 2, detail: `${(charityFunded * 100).toFixed(1)}%` }); }
    }

    // Same-year symmetric flow scoring (new - the strongest circular signal)
    const highSymCount = sameYearSymmetric.filter(s => s.riskLevel === 'HIGH').length;
    const medSymCount = sameYearSymmetric.filter(s => s.riskLevel === 'MEDIUM').length;
    if (highSymCount >= 3) {
      score += 3; factors.push({ factor: 'Many same-year symmetric flows (>=3 HIGH)', points: 3, detail: `${highSymCount} instances >75% symmetric in same fiscal year` });
    } else if (highSymCount >= 1) {
      score += 2; factors.push({ factor: 'Same-year symmetric flows detected', points: 2, detail: `${highSymCount} HIGH risk (>75% symmetric in same fiscal year)` });
    } else if (medSymCount >= 3) {
      score += 1; factors.push({ factor: 'Moderate same-year symmetric flows', points: 1, detail: `${medSymCount} MEDIUM risk (50-75% symmetric)` });
    }
    // Persistence: same partner appears in symmetric flows across multiple years
    const symPartnerYears = new Map();
    for (const s of sameYearSymmetric.filter(s => s.symmetryPct >= 50)) {
      if (!symPartnerYears.has(s.partnerBN)) symPartnerYears.set(s.partnerBN, []);
      symPartnerYears.get(s.partnerBN).push(s.year);
    }
    const persistentPartners = [...symPartnerYears].filter(([, years]) => years.length >= 2);
    if (persistentPartners.length > 0) {
      score += 2; factors.push({
        factor: 'Persistent symmetric flows (same partner, multiple years)',
        points: 2,
        detail: persistentPartners.map(([bn, yrs]) => `${bn} (${yrs.join(',')})`).join('; '),
      });
    }

    // Adjacent-year symmetric flows (±1 year offset - cross-year round-tripping)
    log.info('  Checking adjacent-year (±1) symmetric flows...');
    const adjRes = await client.query(`
      WITH out_by_yr AS (
        SELECT donee_bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
        FROM cra_qualified_donees WHERE bn = $1 AND donee_bn IS NOT NULL AND LENGTH(donee_bn)=15 AND total_gifts >= 5000
        GROUP BY donee_bn, EXTRACT(YEAR FROM fpe)
      ),
      in_by_yr AS (
        SELECT bn AS partner, EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
        FROM cra_qualified_donees WHERE donee_bn = $1 AND total_gifts >= 5000
        GROUP BY bn, EXTRACT(YEAR FROM fpe)
      )
      SELECT o.partner, o.yr AS send_year, o.amt AS amount_sent,
             i.yr AS return_year, i.amt AS amount_returned,
             LEAST(o.amt, i.amt) / GREATEST(o.amt, i.amt) AS symmetry,
             ci.legal_name AS partner_name
      FROM out_by_yr o
      JOIN in_by_yr i ON o.partner = i.partner AND ABS(o.yr - i.yr) = 1
      LEFT JOIN (SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification ORDER BY bn, fiscal_year DESC) ci ON o.partner = ci.bn
      WHERE o.amt >= 10000 AND i.amt >= 10000
        AND LEAST(o.amt, i.amt) / GREATEST(o.amt, i.amt) > 0.5
        AND NOT EXISTS (
          SELECT 1 FROM in_by_yr same WHERE same.partner = o.partner AND same.yr = o.yr AND same.amt >= 5000
        )
        AND NOT EXISTS (
          SELECT 1 FROM out_by_yr same WHERE same.partner = i.partner AND same.yr = i.yr AND same.amt >= 5000
        )
      ORDER BY symmetry DESC, o.amt DESC
    `, [targetBN]);

    const adjacentYearFlows = adjRes.rows.map(r => ({
      partnerBN: r.partner, partnerName: r.partner_name,
      sendYear: parseInt(r.send_year), returnYear: parseInt(r.return_year),
      amountSent: parseFloat(r.amount_sent), amountReturned: parseFloat(r.amount_returned),
      symmetryPct: Math.round(parseFloat(r.symmetry) * 1000) / 10,
    }));
    report.circularGifting.adjacentYearFlows = adjacentYearFlows;

    if (adjacentYearFlows.length >= 3) {
      score += 3; factors.push({
        factor: 'Many adjacent-year round-trips (>=3, offset by ±1 year)',
        points: 3,
        detail: adjacentYearFlows.slice(0, 5).map(f =>
          `${f.partnerName?.slice(0,30)}: $${f.amountSent.toLocaleString()} out (${f.sendYear}) → $${f.amountReturned.toLocaleString()} back (${f.returnYear}) ${f.symmetryPct}%`
        ).join('; '),
      });
    } else if (adjacentYearFlows.length >= 1) {
      score += 2; factors.push({
        factor: 'Adjacent-year round-trips detected (offset by ±1 year)',
        points: 2,
        detail: adjacentYearFlows.map(f =>
          `${f.partnerName?.slice(0,30)}: $${f.amountSent.toLocaleString()} (${f.sendYear}) → $${f.amountReturned.toLocaleString()} (${f.returnYear}) ${f.symmetryPct}%`
        ).join('; '),
      });
    }

    report.riskAssessment = { score: Math.min(score, 30), maxScore: 30, factors };

    // ── Save reports ─────────────────────────────────────────────
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const safeBN = targetBN.replace(/[^a-zA-Z0-9]/g, '_');

    // JSON
    fs.writeFileSync(path.join(REPORT_DIR, `risk-${safeBN}.json`), JSON.stringify(report, null, 2));

    // Markdown
    const md = [];
    md.push(`# Risk Report: ${targetName}`);
    md.push(`**BN:** ${targetBN} | **Generated:** ${report.metadata.generatedAt}`);
    md.push('');
    md.push('> DISCLAIMER: This report identifies statistical patterns for investigation.');
    md.push('> It is NOT an accusation of fraud.');
    md.push('');

    md.push(`## Risk Score: ${report.riskAssessment.score}/30`);
    md.push('');
    md.push('| Factor | Points | Detail |');
    md.push('|--------|--------|--------|');
    for (const f of factors) {
      md.push(`| ${f.factor} | ${f.points} | ${f.detail} |`);
    }

    md.push('');
    md.push('## Identification');
    md.push(`- **Designation:** ${report.identification.designationName || '?'} (${report.identification.designation})`);
    md.push(`- **Category:** ${report.identification.categoryName || '?'} (${report.identification.category})`);
    md.push(`- **Location:** ${report.identification.city}, ${report.identification.province}`);
    md.push(`- **Years in dataset:** ${(report.identification.yearsRegistered || []).join(', ')}`);

    md.push('');
    md.push('## Financial History');
    md.push('');
    md.push('| Year | Revenue | Expenditures | Programs | Admin | Fundraising | OH% | Prog% | Compensation | Employees |');
    md.push('|------|---------|-------------|----------|-------|-------------|-----|-------|-------------|-----------|');
    for (const f of report.financialHistory) {
      md.push(`| ${f.year} | $${f.revenue.toLocaleString()} | $${f.totalExpenditures.toLocaleString()} | $${f.programSpending.toLocaleString()} | $${f.adminSpending.toLocaleString()} | $${f.fundraisingSpending.toLocaleString()} | ${f.overheadPct ?? '-'}% | ${f.programPct ?? '-'}% | $${f.totalCompensation.toLocaleString()} | ${f.employeeCount} |`);
    }

    md.push('');
    md.push('## Circular Gifting');
    md.push(`**Total circular amount:** $${totalCircular.toLocaleString()}`);
    md.push(`**Reciprocal partners:** ${reciprocals.length}`);
    md.push('');
    if (reciprocals.length > 0) {
      md.push('| Partner BN | Partner Name | Amount Out | Amount In | Associated |');
      md.push('|------------|-------------|-----------|----------|------------|');
      for (const r of reciprocals.slice(0, 30)) {
        md.push(`| ${r.partnerBN} | ${(r.partnerName || '?').slice(0, 40)} | $${r.amountOut.toLocaleString()} | $${r.amountIn.toLocaleString()} | ${r.associated ? 'Yes' : 'No'} |`);
      }
      if (reciprocals.length > 30) md.push(`*... and ${reciprocals.length - 30} more partners*`);
    }

    md.push('');
    md.push('## Same-Year Symmetric Flows (Potential Quota Gaming)');
    md.push('');
    md.push('Flows where both charities send each other >= $5,000 in the **same fiscal year**.');
    md.push('High symmetry (>75%) means nearly identical amounts moving both ways.');
    md.push('');
    if (sameYearSymmetric.length === 0) {
      md.push('No same-year symmetric flows detected at $5K threshold.');
    } else {
      md.push('| Year | Partner | Amount Out | Amount In | Symmetry | Risk |');
      md.push('|------|---------|-----------|----------|----------|------|');
      for (const s of sameYearSymmetric.slice(0, 30)) {
        md.push(`| ${s.year} | ${(s.partnerName || s.partnerBN).slice(0, 35)} | $${s.amountOut.toLocaleString()} | $${s.amountIn.toLocaleString()} | ${s.symmetryPct}% | **${s.riskLevel}** |`);
      }
      if (sameYearSymmetric.length > 30) md.push(`*... and ${sameYearSymmetric.length - 30} more*`);
      md.push('');
      md.push(`**Summary:** ${sameYearSymmetric.filter(s => s.riskLevel === 'HIGH').length} HIGH risk, ${sameYearSymmetric.filter(s => s.riskLevel === 'MEDIUM').length} MEDIUM risk, ${sameYearSymmetric.filter(s => s.riskLevel === 'LOW').length} LOW risk same-year flows`);
    }

    md.push('');
    md.push('## Adjacent-Year Round-Trips (±1 Year Offset)');
    md.push('');
    md.push('Flows where charity sends money in year N and the partner sends back in N±1,');
    md.push('with NO same-year return. This is the cross-year variant of quota gaming.');
    md.push('');
    if (adjacentYearFlows.length === 0) {
      md.push('No adjacent-year round-trips detected at $10K+ threshold with >50% symmetry.');
    } else {
      md.push('| Sent Year | Partner | Amount Sent | Return Year | Amount Returned | Symmetry |');
      md.push('|-----------|---------|------------|-------------|----------------|----------|');
      for (const f of adjacentYearFlows) {
        md.push(`| ${f.sendYear} | ${(f.partnerName || f.partnerBN).slice(0, 35)} | $${f.amountSent.toLocaleString()} | ${f.returnYear} | $${f.amountReturned.toLocaleString()} | ${f.symmetryPct}% |`);
      }
    }

    md.push('');
    md.push('## Shared Directors');
    if (report.networkAnalysis.sharedDirectors.length === 0) {
      md.push('No shared directors found with other charities.');
    } else {
      for (const d of report.networkAnalysis.sharedDirectors.slice(0, 20)) {
        md.push(`**${d.name}** also serves on:`);
        for (const o of d.otherCharities.slice(0, 5)) {
          md.push(`- ${o.bn} ${o.name || '?'} (${o.position || '?'})`);
        }
      }
    }

    const mdPath = path.join(REPORT_DIR, `risk-${safeBN}.md`);
    fs.writeFileSync(mdPath, md.join('\n'));

    log.section('Risk Report Complete');
    log.info(`Score: ${report.riskAssessment.score}/30`);
    log.info(`Files:`);
    log.info(`  ${path.join(REPORT_DIR, `risk-${safeBN}.json`)}`);
    log.info(`  ${mdPath}`);

  } finally {
    client.release();
    await db.end();
  }
}

main().catch(err => {
  log.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
