/**
 * 07-risk-register.js - Comprehensive Multi-Factor Risk Register
 *
 * Challenges supported: ALL (#1-#10)
 *
 * Computes a 0-35 risk score for non-government, non-individual recipient
 * entities (>=$100K total funding) across 7 risk dimensions.
 *
 * EXCLUSIONS:
 *   - Government recipients (type 'G' or name-detected)
 *   - Individuals / sole proprietorships (type 'P')
 *   - International organizations (type 'I')
 *
 * INCLUDED:
 *   - For-profit (F), Not-for-profit (N), Indigenous (A), Academia (S),
 *     Other (O), and NULL-type entities that aren't name-detected as government
 *
 * Risk Dimensions (0-5 each, 35 max):
 *   1. FUNDING CESSATION - No new grants in recent years (not = ceased operations)
 *   2. IDENTITY RISK     - No business number, weak identity data
 *   3. AMENDMENT RISK    - High amendment count, large value growth
 *   4. CONCENTRATION     - Dominates a program or department
 *   5. DEPENDENCY RISK   - Few grants, high total (single-source dependent)
 *   6. OPACITY RISK      - Missing descriptions, expected results, NAICS
 *   7. SCALE RISK        - Outsized single grants, pass-through signals
 *
 * Outputs:
 *   data/reports/risk-register.json  - Full structured data
 *   data/reports/risk-register.csv   - Sortable spreadsheet
 *   data/reports/risk-register.txt   - Human-readable top risks
 *
 * Usage: npm run analyze:risk
 */
const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');
const MIN_TOTAL_VALUE = 100000; // $100K minimum to be in register

// Patterns that identify government entities even when recipient_type is NULL
const GOV_PATTERNS = [
  'government of', 'gouvernement', 'province of', 'province de',
  'ministry of', 'ministère', 'ministre des', 'ministry of health',
  'city of ', 'ville de ', 'municipality', 'municipalité',
  'regional district', 'county of', 'town of ',
  'world bank', 'united nations', 'world food programme',
  'international criminal court', 'european space agency',
  'batch report', 'rapport en lots',
];

function isLikelyGovernment(name, typeCode) {
  if (typeCode === 'G' || typeCode === 'I') return true;
  if (!name) return false;
  const lower = name.toLowerCase();
  return GOV_PATTERNS.some(pat => lower.includes(pat));
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function run() {
  log.section('Comprehensive Risk Register');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    await db.query('SET search_path TO fed, public;');

    // ─── Build entity base with all raw metrics ──────────────────
    log.info('Building entity base (excluding governments, individuals)...');

    const entitiesRes = await db.query(`
      WITH entity_base AS (
        SELECT
          recipient_legal_name AS name,
          recipient_business_number AS bn,
          gc.recipient_type AS type_code,
          rtl.name_en AS type_name,
          MAX(recipient_province) AS province,
          MAX(recipient_city) AS city,
          MAX(recipient_country) AS country,

          COUNT(*) FILTER (WHERE is_amendment = false) AS original_count,
          COUNT(*) FILTER (WHERE is_amendment = true) AS amendment_count,
          COUNT(DISTINCT owner_org) AS dept_count,
          COUNT(DISTINCT prog_name_en) FILTER (WHERE prog_name_en IS NOT NULL) AS program_count,

          ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = false)::numeric, 2) AS original_total,
          ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value > 0)::numeric, 2) AS positive_amendments,
          ROUND(SUM(agreement_value) FILTER (WHERE is_amendment = true AND agreement_value < 0)::numeric, 2) AS negative_amendments,
          ROUND(MAX(agreement_value)::numeric, 2) AS max_single_grant,
          ROUND(AVG(agreement_value) FILTER (WHERE is_amendment = false)::numeric, 2) AS avg_grant,

          MIN(agreement_start_date) AS first_grant,
          MAX(agreement_start_date) AS last_grant,
          EXTRACT(YEAR FROM MAX(agreement_start_date))::int AS last_year,

          COUNT(*) FILTER (WHERE is_amendment = false AND description_en IS NOT NULL AND description_en != '') AS has_description,
          COUNT(*) FILTER (WHERE is_amendment = false AND expected_results_en IS NOT NULL AND expected_results_en != '') AS has_expected_results,
          COUNT(*) FILTER (WHERE is_amendment = false AND naics_identifier IS NOT NULL AND naics_identifier != '') AS has_naics

        FROM fed.grants_contributions gc
        LEFT JOIN fed.recipient_type_lookup rtl ON gc.recipient_type = rtl.code
        WHERE gc.recipient_legal_name IS NOT NULL
          -- Exclude individuals and explicit government type
          AND (gc.recipient_type IS NULL OR gc.recipient_type NOT IN ('P', 'G', 'I'))
        GROUP BY gc.recipient_legal_name, gc.recipient_business_number,
                 gc.recipient_type, rtl.name_en
        HAVING SUM(agreement_value) FILTER (WHERE is_amendment = false) >= ${MIN_TOTAL_VALUE}
      )
      SELECT * FROM entity_base
      ORDER BY original_total DESC
    `);

    // Filter out name-detected governments
    const filteredEntities = entitiesRes.rows.filter(e => !isLikelyGovernment(e.name, e.type_code));

    log.info(`  ${entitiesRes.rows.length} entities before government name filter`);
    log.info(`  ${entitiesRes.rows.length - filteredEntities.length} removed as government/international/batch`);
    log.info(`  ${filteredEntities.length} entities in risk register`);

    // ─── Check for program dominance ─────────────────────────────
    log.info('Checking program dominance...');
    const progDominanceRes = await db.query(`
      WITH program_totals AS (
        SELECT prog_name_en, owner_org_title,
               recipient_legal_name,
               SUM(agreement_value) AS recipient_prog_total,
               SUM(SUM(agreement_value)) OVER (PARTITION BY prog_name_en, owner_org_title) AS prog_total
        FROM fed.grants_contributions
        WHERE is_amendment = false AND prog_name_en IS NOT NULL AND agreement_value > 0
        GROUP BY prog_name_en, owner_org_title, recipient_legal_name
      )
      SELECT recipient_legal_name AS name,
             COUNT(*) AS programs_dominated,
             SUM(recipient_prog_total) AS dominated_value
      FROM program_totals
      WHERE prog_total > 100000
        AND recipient_prog_total / NULLIF(prog_total, 0) > 0.8
      GROUP BY recipient_legal_name
    `);
    const dominanceMap = {};
    for (const r of progDominanceRes.rows) {
      dominanceMap[r.name] = { programs: parseInt(r.programs_dominated), value: parseFloat(r.dominated_value) };
    }

    // ─── Score each entity ───────────────────────────────────────
    log.info('Scoring entities across 7 risk dimensions...');

    const entities = filteredEntities.map(e => {
      const origCount = parseInt(e.original_count) || 0;
      const amendCount = parseInt(e.amendment_count) || 0;
      const origTotal = parseFloat(e.original_total) || 0;
      const posAmend = parseFloat(e.positive_amendments) || 0;
      const negAmend = Math.abs(parseFloat(e.negative_amendments) || 0);
      const maxGrant = parseFloat(e.max_single_grant) || 0;
      const avgGrant = parseFloat(e.avg_grant) || 0;
      const lastYear = e.last_year || null;
      const deptCount = parseInt(e.dept_count) || 1;
      const hasDesc = parseInt(e.has_description) || 0;
      const hasResults = parseInt(e.has_expected_results) || 0;
      const hasNaics = parseInt(e.has_naics) || 0;
      const dominance = dominanceMap[e.name];
      const isForProfit = e.type_code === 'F';

      const factors = [];

      // ── 1. FUNDING CESSATION (0-5) ────────────────────────────
      // "No new grants" - NOT "ceased operations". Large public companies
      // simply stop receiving grants when programs end.
      let cessation = 0;
      if (lastYear === null) {
        // #67: Missing dates — flag as unknown rather than defaulting to current
        cessation += 2; factors.push('MISSING_GRANT_DATES');
      } else if (lastYear <= 2018 && origTotal >= 1000000) {
        cessation += 2; factors.push('NO_NEW_GRANTS_5YR+');
      } else if (lastYear <= 2020 && origTotal >= 1000000) {
        cessation += 1; factors.push('NO_NEW_GRANTS_3YR+');
      }
      // Only flag as truly suspicious if entity got few grants then vanished
      // (not a large established company that simply finished a program)
      if (origCount <= 3 && origTotal >= 500000 && lastYear <= 2020) {
        cessation += 2; factors.push('FEW_GRANTS_THEN_CEASED');
      }
      if (origCount === 1 && origTotal >= 1000000 && lastYear <= 2021) {
        cessation += 1; factors.push('ONE_GRANT_THEN_GONE');
      }
      cessation = Math.min(cessation, 5);

      // ── 2. IDENTITY RISK (0-5) ────────────────────────────────
      let identity = 0;
      if (!e.bn || e.bn === '') {
        // Missing BN is more suspicious for for-profits than nonprofits
        if (isForProfit) { identity += 3; factors.push('FOR_PROFIT_NO_BN'); }
        else { identity += 1; factors.push('NO_BUSINESS_NUMBER'); }
      }
      if (!e.city && !e.province) {
        identity += 1; factors.push('NO_LOCATION');
      }
      if (origCount <= 2 && origTotal >= 500000 && (!e.bn || e.bn === '')) {
        identity += 1; factors.push('HIGH_VALUE_WEAK_IDENTITY');
      }
      identity = Math.min(identity, 5);

      // ── 3. AMENDMENT RISK (0-5) ───────────────────────────────
      let amendment = 0;
      if (amendCount > 0) {
        const amendRate = amendCount / Math.max(origCount, 1);
        if (amendRate >= 3) { amendment += 2; factors.push('EXTREME_AMENDMENT_RATE'); }
        else if (amendRate >= 1) { amendment += 1; factors.push('HIGH_AMENDMENT_RATE'); }

        if (posAmend > origTotal * 2) { amendment += 2; factors.push('AMENDMENTS_DWARF_ORIGINAL'); }
        else if (posAmend > origTotal) { amendment += 1; factors.push('AMENDMENTS_EXCEED_ORIGINAL'); }

        if (negAmend > origTotal * 0.5) { amendment += 1; factors.push('LARGE_REDUCTIONS'); }
      }
      amendment = Math.min(amendment, 5);

      // ── 4. CONCENTRATION RISK (0-5) ───────────────────────────
      let concentration = 0;
      if (dominance) {
        if (dominance.programs >= 3) { concentration += 3; factors.push('DOMINATES_3+_PROGRAMS'); }
        else if (dominance.programs >= 1) { concentration += 2; factors.push('DOMINATES_PROGRAM'); }
        if (dominance.value >= 100000000) { concentration += 2; factors.push('$100M+_PROGRAM_DOMINANCE'); }
      }
      concentration = Math.min(concentration, 5);

      // ── 5. DEPENDENCY RISK (0-5) ──────────────────────────────
      let dependency = 0;
      if (origCount === 1 && origTotal >= 5000000) {
        dependency += 3; factors.push('SINGLE_GRANT_$5M+');
      } else if (origCount <= 2 && origTotal >= 1000000) {
        dependency += 2; factors.push('FEW_GRANTS_$1M+');
      }
      if (deptCount === 1 && origTotal >= 10000000) {
        dependency += 2; factors.push('SINGLE_DEPT_$10M+');
      } else if (deptCount === 1 && origTotal >= 1000000) {
        dependency += 1; factors.push('SINGLE_DEPT_$1M+');
      }
      dependency = Math.min(dependency, 5);

      // ── 6. OPACITY RISK (0-5) ─────────────────────────────────
      let opacity = 0;
      const descRate = origCount > 0 ? hasDesc / origCount : 0;
      const resultsRate = origCount > 0 ? hasResults / origCount : 0;
      if (descRate < 0.1 && origTotal >= 1000000) {
        opacity += 2; factors.push('NO_DESCRIPTIONS');
      } else if (descRate < 0.5) {
        opacity += 1; factors.push('FEW_DESCRIPTIONS');
      }
      if (resultsRate < 0.1 && origTotal >= 1000000) {
        opacity += 2; factors.push('NO_EXPECTED_RESULTS');
      }
      if (hasNaics === 0 && isForProfit) {
        opacity += 1; factors.push('FOR_PROFIT_NO_NAICS');
      }
      opacity = Math.min(opacity, 5);

      // ── 7. SCALE RISK (0-5) ───────────────────────────────────
      let scale = 0;
      if (maxGrant >= 1000000000) { scale += 3; factors.push('BILLION_DOLLAR_GRANT'); }
      else if (maxGrant >= 100000000) { scale += 2; factors.push('$100M+_SINGLE_GRANT'); }
      else if (maxGrant >= 10000000) { scale += 1; factors.push('$10M+_SINGLE_GRANT'); }
      if (origCount <= 2 && avgGrant >= 50000000) {
        scale += 2; factors.push('FEW_GRANTS_HUGE_AVG');
      } else if (origCount <= 3 && avgGrant >= 10000000) {
        scale += 1; factors.push('LOW_COUNT_HIGH_AVG');
      }
      scale = Math.min(scale, 5);

      const totalScore = cessation + identity + amendment + concentration + dependency + opacity + scale;

      return {
        name: e.name,
        business_number: e.bn || null,
        recipient_type: e.type_name || e.type_code || 'Unknown',
        province: e.province,
        city: e.city,
        country: e.country,
        original_count: origCount,
        amendment_count: amendCount,
        dept_count: deptCount,
        total_value: origTotal,
        max_single_grant: maxGrant,
        first_grant: e.first_grant,
        last_grant: e.last_grant,
        last_year: lastYear,
        scores: { cessation, identity, amendment, concentration, dependency, opacity, scale },
        total_score: totalScore,
        risk_level: totalScore >= 15 ? 'CRITICAL' : totalScore >= 10 ? 'HIGH' : totalScore >= 6 ? 'MEDIUM' : 'LOW',
        factors,
      };
    });

    // Sort by total score descending
    entities.sort((a, b) => b.total_score - a.total_score || b.total_value - a.total_value);

    // ─── Summary stats ───────────────────────────────────────────
    const critical = entities.filter(e => e.risk_level === 'CRITICAL');
    const high = entities.filter(e => e.risk_level === 'HIGH');
    const medium = entities.filter(e => e.risk_level === 'MEDIUM');
    const low = entities.filter(e => e.risk_level === 'LOW');

    log.info(`  Total entities scored: ${entities.length}`);
    log.info(`  CRITICAL (>=15): ${critical.length}`);
    log.info(`  HIGH (10-14):    ${high.length}`);
    log.info(`  MEDIUM (6-9):    ${medium.length}`);
    log.info(`  LOW (0-5):       ${low.length}`);

    // For-profit breakdown
    const fpCritical = critical.filter(e => e.recipient_type === 'For-profit organizations');
    const fpHigh = high.filter(e => e.recipient_type === 'For-profit organizations');
    log.info(`  For-profit CRITICAL: ${fpCritical.length}`);
    log.info(`  For-profit HIGH: ${fpHigh.length}`);

    // ─── Province summary ────────────────────────────────────────
    log.info('Building province summary...');
    const byProvince = {};
    for (const e of entities) {
      const p = e.province || 'UNKNOWN';
      if (!byProvince[p]) byProvince[p] = { province: p, total: 0, critical: 0, high: 0, medium: 0, low: 0, total_value: 0 };
      byProvince[p].total++;
      byProvince[p][e.risk_level.toLowerCase()]++;
      byProvince[p].total_value += e.total_value;
    }
    const provinceSummary = Object.values(byProvince)
      .filter(p => p.province.length === 2 || p.province === 'UNKNOWN')
      .sort((a, b) => b.critical - a.critical || b.high - a.high);

    // ─── Write JSON ──────────────────────────────────────────────
    const report = {
      generatedAt: new Date().toISOString(),
      methodology: {
        description: 'Multi-factor risk scoring for non-government grant recipients',
        exclusions: [
          'Government recipients (type G, or name-detected: provinces, municipalities, ministries)',
          'Individuals / sole proprietorships (type P)',
          'International orgs (type I: World Bank, UN, etc.)',
          'Batch/aggregate reporting entries',
        ],
        dimensions: [
          'CESSATION (0-5): No new grants in recent years + few grants then stopped (NOT = ceased operations)',
          'IDENTITY (0-5): No business number (weighted higher for for-profits), no location',
          'AMENDMENT (0-5): High amendment rate, amendments exceed original value',
          'CONCENTRATION (0-5): Dominates program(s), single-department dominance',
          'DEPENDENCY (0-5): Very few grants, single funding source for large amounts',
          'OPACITY (0-5): Missing descriptions, expected results, industry codes',
          'SCALE (0-5): Outsized single grants, few-grants-huge-average pattern',
        ],
        max_score: 35,
        levels: { CRITICAL: '>=15', HIGH: '10-14', MEDIUM: '6-9', LOW: '0-5' },
        threshold: `Entities with >= $${(MIN_TOTAL_VALUE/1000)}K in original grant value`,
      },
      summary: {
        total_entities: entities.length,
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        low: low.length,
        for_profit_critical: fpCritical.length,
        for_profit_high: fpHigh.length,
      },
      province_summary: provinceSummary,
      top_risks: entities.slice(0, 200),
      critical_and_high: entities.filter(e => e.total_score >= 10),
    };

    const jsonPath = path.join(OUTPUT_DIR, 'risk-register.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    log.info(`JSON: ${jsonPath}`);

    // ─── Write CSV ───────────────────────────────────────────────
    const csvCols = [
      'name', 'business_number', 'recipient_type', 'province', 'city',
      'total_score', 'risk_level',
      'cessation', 'identity', 'amendment', 'concentration', 'dependency', 'opacity', 'scale',
      'original_count', 'amendment_count', 'dept_count',
      'total_value', 'max_single_grant', 'last_year', 'factors',
    ];
    let csv = csvCols.join(',') + '\n';
    for (const e of entities) {
      const row = { ...e, ...e.scores, factors: e.factors.join('; ') };
      csv += csvCols.map(c => csvEscape(row[c])).join(',') + '\n';
    }
    const csvPath = path.join(OUTPUT_DIR, 'risk-register.csv');
    try {
      fs.writeFileSync(csvPath, csv, 'utf8');
      log.info(`CSV: ${csvPath}`);
    } catch (writeErr) {
      if (writeErr.code === 'EBUSY') {
        const altPath = path.join(OUTPUT_DIR, 'risk-register-new.csv');
        fs.writeFileSync(altPath, csv, 'utf8');
        log.warn(`CSV locked (open in another app?). Wrote to: ${altPath}`);
      } else {
        throw writeErr;
      }
    }

    // ─── Write TXT ───────────────────────────────────────────────
    let txt = `FEDERAL GRANTS RISK REGISTER\nGenerated: ${report.generatedAt}\n${'='.repeat(80)}\n\n`;
    txt += `METHODOLOGY: 7 risk dimensions, 0-5 each, 35 max\n`;
    txt += `  CRITICAL >= 15 | HIGH 10-14 | MEDIUM 6-9 | LOW 0-5\n`;
    txt += `  EXCLUDED: Governments, Individuals, International Orgs, Batch Reports\n`;
    txt += `  NOTE: "Cessation" means no new grants received, NOT that entity ceased operations\n\n`;
    txt += `SUMMARY: ${entities.length} entities scored\n`;
    txt += `  CRITICAL: ${critical.length} | HIGH: ${high.length} | MEDIUM: ${medium.length} | LOW: ${low.length}\n`;
    txt += `  For-profit CRITICAL: ${fpCritical.length} | For-profit HIGH: ${fpHigh.length}\n\n`;

    txt += `BY PROVINCE:\n`;
    txt += `${'Province'.padEnd(12)} ${'Total'.padStart(6)} ${'CRIT'.padStart(5)} ${'HIGH'.padStart(5)} ${'MED'.padStart(5)} ${'Value ($B)'.padStart(12)}\n`;
    txt += `${'-'.repeat(48)}\n`;
    for (const p of provinceSummary) {
      txt += `${(p.province || '?').padEnd(12)} ${String(p.total).padStart(6)} ${String(p.critical).padStart(5)} ${String(p.high).padStart(5)} ${String(p.medium).padStart(5)} ${(p.total_value / 1e9).toFixed(1).padStart(12)}\n`;
    }

    txt += `\n${'='.repeat(80)}\nTOP 50 RISKIEST ENTITIES (non-government)\n${'='.repeat(80)}\n\n`;
    entities.slice(0, 50).forEach((e, i) => {
      txt += `${String(i + 1).padStart(3)}. [${e.risk_level}] Score: ${e.total_score}/35 | ${(e.name || '').slice(0, 55)}\n`;
      txt += `     ${e.recipient_type || '?'} | ${e.province || '?'} | $${(e.total_value / 1e6).toFixed(1)}M | ${e.original_count} grants | Last ${e.last_year}\n`;
      txt += `     C:${e.scores.cessation} I:${e.scores.identity} A:${e.scores.amendment} N:${e.scores.concentration} D:${e.scores.dependency} O:${e.scores.opacity} S:${e.scores.scale}\n`;
      txt += `     Factors: ${e.factors.join(', ')}\n\n`;
    });

    const txtPath = path.join(OUTPUT_DIR, 'risk-register.txt');
    fs.writeFileSync(txtPath, txt, 'utf8');
    log.info(`TXT: ${txtPath}`);

    log.section('Risk Register Complete');
    log.info(`${critical.length} CRITICAL + ${high.length} HIGH risk entities identified`);
    log.info(`Full register: ${csvPath}`);

  } catch (err) {
    log.error(`Risk register failed: ${err.message}`);
    throw err;
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
