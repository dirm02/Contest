/**
 * 02-t3010-arithmetic-impossibilities.js   (part of scripts/data-quality/)
 *
 * Flags T3010 filings that violate arithmetic identities, cross-schedule
 * equalities, or schedule dependencies stated directly in the T3010 form
 * or the CRA Open Data Dictionary v2.0. Every rule here is traceable to
 * a specific line number in one of those two sources — never to a
 * threshold, a sign convention, or an assumption the form does not
 * make. A filing that violates any of these rules is structurally
 * inconsistent on its face.
 *
 * ─── EXPENDITURE-TREE IDENTITIES ─────────────────────────────────────────
 *
 *   IDENTITY_5100    field_5100 = field_4950 + field_5045 + field_5050
 *                    T3010 form lines 281 (Section D) and 657 (Schedule 6):
 *                    "Total expenditures (add lines 4950, 5045 and 5050)"
 *
 *   PARTITION_4950   field_5000 + field_5010 + field_5020 + field_5040 ≤ field_4950
 *                    T3010 form lines 644, 648–651 (Schedule 6): "Of the
 *                    amounts at lines 4950: (a) 5000 ... (b) 5010 ...
 *                    (c) 5020 ... (d) Total other expenditures included
 *                    in line 4950 — 5040". Each is a subset of 4950.
 *
 * ─── BALANCE-SHEET IDENTITIES ─────────────────────────────────────────────
 *
 *   IDENTITY_4200    field_4200 = field_4100 + field_4110 + ... + field_4170
 *                                (+ field_4180 or field_4190 for version-specific rows)
 *                    T3010 form line 584 (Schedule 6): "Total assets
 *                    (add lines 4100, 4110 to 4155, and 4160 to 4170)"
 *
 *   IDENTITY_4350    field_4350 = field_4300 + field_4310 + field_4320 + field_4330
 *                    T3010 form line 572 (Schedule 6): "Total liabilities
 *                    (add lines 4300 to 4330)"
 *
 * ─── CROSS-SCHEDULE EQUALITIES ────────────────────────────────────────────
 *
 *   COMP_4880_EQ_390    field_4880 (Schedule 6) = field_390 (Schedule 3)
 *                       T3010 form line 631 (Schedule 6): "Total expenditure
 *                       on all compensation (enter the amount reported at
 *                       line 390 in Schedule 3, if applicable) | 4880"
 *
 *   DQ_845_EQ_5000   Schedule 8 line 845 = field_5000 (Schedule 6)
 *                    CRA Open Data Dictionary v2.0 line 1023:
 *                    "Must be pre-populated with the amount from line
 *                    5000 from Schedule 6 of this return"
 *
 *   DQ_850_EQ_5045   Schedule 8 line 850 = field_5045 (Schedule 6)
 *                    Dictionary line 1024: "Must be pre-populated with
 *                    the amount from line 5045 from Schedule 6 of this return"
 *
 *   DQ_855_EQ_5050   Schedule 8 line 855 = field_5050 (Schedule 6)
 *                    Dictionary line 1025: "Must be pre-populated with
 *                    the amount from line 5050 from Schedule 6 of this return"
 *
 * ─── SCHEDULE DEPENDENCIES ────────────────────────────────────────────────
 *
 *   SCH3_DEP_FORWARD   If field_3400 (C9) = TRUE, Schedule 3 must be
 *                      populated. T3010 form line 133 (Section C9):
 *                      "Did the charity incur any expenses for
 *                      compensation of employees during the fiscal
 *                      period? ... Important: If yes, you must complete
 *                      Schedule 3, Compensation."
 *
 *   SCH3_DEP_REVERSE   If Schedule 3 is populated, field_3400 (C9)
 *                      must = TRUE. T3010 form line 467 (Schedule 3):
 *                      "If you complete this section, you must answer
 *                      yes to question C9."
 *
 * Outputs:
 *   cra.t3010_arithmetic_violations                             — one row per violation × rule
 *   data/reports/data-quality/t3010-arithmetic-impossibilities.{json,md}
 *
 * Usage:
 *   npm run data-quality:arithmetic
 *   node scripts/data-quality/02-t3010-arithmetic-impossibilities.js
 *   node scripts/data-quality/02-t3010-arithmetic-impossibilities.js --top 40
 */

const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

function parseArgs() {
  const args = { top: 20 };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--top' && next) { args.top = parseInt(next, 10) || args.top; i++; }
  }
  return args;
}
const args = parseArgs();
const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports', 'data-quality');

const TOLERANCE = 1;   // dollars — rounding tolerance for every identity

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrate(client) {
  log.info('Phase 1: Creating cra.t3010_arithmetic_violations...');
  await client.query(`
    DROP TABLE IF EXISTS cra.t3010_arithmetic_violations CASCADE;
    CREATE TABLE cra.t3010_arithmetic_violations (
      bn            varchar(15) NOT NULL,
      fpe           date        NOT NULL,
      fiscal_year   int         NOT NULL,
      legal_name    text,
      rule_code     text        NOT NULL,
      rule_family   text        NOT NULL,    -- EXPENDITURE | BALANCE_SHEET | CROSS_SCHEDULE | DEPENDENCY
      details       text,
      severity      numeric,
      PRIMARY KEY (bn, fpe, rule_code)
    );
    CREATE INDEX idx_a_rule     ON cra.t3010_arithmetic_violations (rule_code);
    CREATE INDEX idx_a_family   ON cra.t3010_arithmetic_violations (rule_family);
    CREATE INDEX idx_a_year     ON cra.t3010_arithmetic_violations (fiscal_year);
    CREATE INDEX idx_a_severity ON cra.t3010_arithmetic_violations (severity DESC);
  `);
}

// ─── Phase 2: run all 10 rules ───────────────────────────────────────────────

async function runChecks(client) {
  log.info('\nPhase 2: Running 10 identity / consistency / dependency checks...');

  const joinId = `
    LEFT JOIN cra.cra_identification ci
      ON ci.bn = fd.bn AND ci.fiscal_year = EXTRACT(YEAR FROM fd.fpe)::int
  `;

  // ─── EXPENDITURE-TREE IDENTITIES ───────────────────────────────────────────

  // IDENTITY_5100 — STRICT: both sides must be populated. A filing that
  // reports field_5100 but leaves all three components NULL (or vice versa)
  // is a COMPLETENESS issue, not an arithmetic impossibility, so it is
  // not flagged here. Only fires when 5100 is populated AND at least one
  // of 4950/5045/5050 is also populated AND the values disagree > $1.
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'IDENTITY_5100', 'EXPENDITURE',
      'field_5100 reported as $' || ROUND(fd.field_5100)::text ||
        ' but field_4950 + field_5045 + field_5050 = $' ||
        ROUND(COALESCE(fd.field_4950,0) + COALESCE(fd.field_5045,0) + COALESCE(fd.field_5050,0))::text ||
        ' (difference $' ||
        ROUND(ABS(fd.field_5100 - (COALESCE(fd.field_4950,0)+COALESCE(fd.field_5045,0)+COALESCE(fd.field_5050,0))))::text ||
        ')',
      ABS(fd.field_5100 - (COALESCE(fd.field_4950,0)+COALESCE(fd.field_5045,0)+COALESCE(fd.field_5050,0)))
    FROM cra.cra_financial_details fd ${joinId}
    WHERE fd.field_5100 IS NOT NULL
      AND (fd.field_4950 IS NOT NULL OR fd.field_5045 IS NOT NULL OR fd.field_5050 IS NOT NULL)
      AND ABS(fd.field_5100 - (COALESCE(fd.field_4950,0)+COALESCE(fd.field_5045,0)+COALESCE(fd.field_5050,0))) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // PARTITION_4950
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'PARTITION_4950', 'EXPENDITURE',
      'field_5000+5010+5020+5040 = $' ||
        ROUND(COALESCE(fd.field_5000,0)+COALESCE(fd.field_5010,0)+COALESCE(fd.field_5020,0)+COALESCE(fd.field_5040,0))::text ||
        ' exceeds field_4950 = $' || ROUND(COALESCE(fd.field_4950,0))::text,
      (COALESCE(fd.field_5000,0)+COALESCE(fd.field_5010,0)+COALESCE(fd.field_5020,0)+COALESCE(fd.field_5040,0))
        - COALESCE(fd.field_4950,0)
    FROM cra.cra_financial_details fd ${joinId}
    WHERE (COALESCE(fd.field_5000,0)+COALESCE(fd.field_5010,0)+COALESCE(fd.field_5020,0)+COALESCE(fd.field_5040,0))
          > COALESCE(fd.field_4950,0) + $1
      AND COALESCE(fd.field_4950,0) > 0
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // ─── BALANCE-SHEET IDENTITIES ─────────────────────────────────────────────

  // IDENTITY_4200 (assets) — STRICT per T3010 form line 584:
  // "Total assets (add lines 4100, 4110 to 4155, and 4160 to 4170)".
  // field_4180 (pre-v27 10-year gift balance) and field_4190 (v27+ impact
  // investments) are NOT part of this sum — the form text explicitly
  // stops at 4170. Sub-component fields 4101/4102 (splits of 4100) and
  // 4157/4158 (splits of 4155) are also NOT added since the parent
  // is the aggregate.
  // Rule only fires when field_4200 is populated AND at least one of
  // the sum's component fields is ALSO populated (otherwise Section D
  // filers who only report the total would false-positive).
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'IDENTITY_4200', 'BALANCE_SHEET',
      'field_4200 (total assets, $' || ROUND(fd.field_4200)::text ||
        ') ≠ field_4100 + 4110 + 4120 + 4130 + 4140 + 4150 + 4155 + 4160 + 4165 + 4166 + 4170 = $' ||
        ROUND(COALESCE(fd.field_4100,0)+COALESCE(fd.field_4110,0)+COALESCE(fd.field_4120,0)+
              COALESCE(fd.field_4130,0)+COALESCE(fd.field_4140,0)+COALESCE(fd.field_4150,0)+
              COALESCE(fd.field_4155,0)+COALESCE(fd.field_4160,0)+COALESCE(fd.field_4165,0)+
              COALESCE(fd.field_4166,0)+COALESCE(fd.field_4170,0))::text,
      ABS(fd.field_4200 - (
        COALESCE(fd.field_4100,0)+COALESCE(fd.field_4110,0)+COALESCE(fd.field_4120,0)+
        COALESCE(fd.field_4130,0)+COALESCE(fd.field_4140,0)+COALESCE(fd.field_4150,0)+
        COALESCE(fd.field_4155,0)+COALESCE(fd.field_4160,0)+COALESCE(fd.field_4165,0)+
        COALESCE(fd.field_4166,0)+COALESCE(fd.field_4170,0)))
    FROM cra.cra_financial_details fd ${joinId}
    WHERE fd.field_4200 IS NOT NULL
      AND (fd.field_4100 IS NOT NULL OR fd.field_4110 IS NOT NULL OR fd.field_4120 IS NOT NULL
           OR fd.field_4130 IS NOT NULL OR fd.field_4140 IS NOT NULL OR fd.field_4150 IS NOT NULL
           OR fd.field_4155 IS NOT NULL OR fd.field_4160 IS NOT NULL OR fd.field_4165 IS NOT NULL
           OR fd.field_4166 IS NOT NULL OR fd.field_4170 IS NOT NULL)
      AND ABS(fd.field_4200 - (
        COALESCE(fd.field_4100,0)+COALESCE(fd.field_4110,0)+COALESCE(fd.field_4120,0)+
        COALESCE(fd.field_4130,0)+COALESCE(fd.field_4140,0)+COALESCE(fd.field_4150,0)+
        COALESCE(fd.field_4155,0)+COALESCE(fd.field_4160,0)+COALESCE(fd.field_4165,0)+
        COALESCE(fd.field_4166,0)+COALESCE(fd.field_4170,0))) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // IDENTITY_4350 (liabilities) — STRICT: both total AND at least one component
  // must be populated. Section D filers who only report 4350 without the
  // Schedule 6 liability breakdown are legitimate.
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'IDENTITY_4350', 'BALANCE_SHEET',
      'field_4350 (total liabilities, $' || ROUND(fd.field_4350)::text ||
        ') ≠ field_4300 + field_4310 + field_4320 + field_4330 = $' ||
        ROUND(COALESCE(fd.field_4300,0)+COALESCE(fd.field_4310,0)+COALESCE(fd.field_4320,0)+COALESCE(fd.field_4330,0))::text,
      ABS(fd.field_4350 - (
        COALESCE(fd.field_4300,0)+COALESCE(fd.field_4310,0)+COALESCE(fd.field_4320,0)+COALESCE(fd.field_4330,0)))
    FROM cra.cra_financial_details fd ${joinId}
    WHERE fd.field_4350 IS NOT NULL
      AND (fd.field_4300 IS NOT NULL OR fd.field_4310 IS NOT NULL
           OR fd.field_4320 IS NOT NULL OR fd.field_4330 IS NOT NULL)
      AND ABS(fd.field_4350 - (
        COALESCE(fd.field_4300,0)+COALESCE(fd.field_4310,0)+COALESCE(fd.field_4320,0)+COALESCE(fd.field_4330,0))) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // ─── CROSS-SCHEDULE EQUALITIES ────────────────────────────────────────────

  // COMP_4880_EQ_390
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'COMP_4880_EQ_390', 'CROSS_SCHEDULE',
      'Schedule 6 field_4880 = $' || ROUND(fd.field_4880)::text ||
        ' but Schedule 3 field_390 = $' || ROUND(cc.field_390)::text ||
        '. Form line 631: "enter the amount reported at line 390 in Schedule 3"',
      ABS(fd.field_4880 - cc.field_390)
    FROM cra.cra_financial_details fd
    JOIN cra.cra_compensation cc ON cc.bn = fd.bn AND cc.fpe = fd.fpe
    ${joinId}
    WHERE fd.field_4880 IS NOT NULL AND cc.field_390 IS NOT NULL
      AND ABS(fd.field_4880 - cc.field_390) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // DQ_845_EQ_5000
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'DQ_845_EQ_5000', 'CROSS_SCHEDULE',
      'Schedule 8 line 845 = $' || ROUND(dq.field_845)::text ||
        ' but field_5000 (Schedule 6) = $' || ROUND(fd.field_5000)::text ||
        '. Dictionary line 1023: line 845 "must be pre-populated with the amount from line 5000 from Schedule 6 of this return"',
      ABS(dq.field_845 - fd.field_5000)
    FROM cra.cra_disbursement_quota dq
    JOIN cra.cra_financial_details fd ON dq.bn = fd.bn AND dq.fpe = fd.fpe
    ${joinId}
    WHERE dq.field_845 IS NOT NULL AND fd.field_5000 IS NOT NULL
      AND ABS(dq.field_845 - fd.field_5000) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // DQ_850_EQ_5045
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'DQ_850_EQ_5045', 'CROSS_SCHEDULE',
      'Schedule 8 line 850 = $' || ROUND(dq.field_850)::text ||
        ' but field_5045 (Schedule 6) = $' || ROUND(fd.field_5045)::text ||
        '. Dictionary line 1024: line 850 "must be pre-populated with the amount from line 5045 from Schedule 6 of this return"',
      ABS(dq.field_850 - fd.field_5045)
    FROM cra.cra_disbursement_quota dq
    JOIN cra.cra_financial_details fd ON dq.bn = fd.bn AND dq.fpe = fd.fpe
    ${joinId}
    WHERE dq.field_850 IS NOT NULL AND fd.field_5045 IS NOT NULL
      AND ABS(dq.field_850 - fd.field_5045) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // DQ_855_EQ_5050
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      fd.bn, fd.fpe, EXTRACT(YEAR FROM fd.fpe)::int, ci.legal_name,
      'DQ_855_EQ_5050', 'CROSS_SCHEDULE',
      'Schedule 8 line 855 = $' || ROUND(dq.field_855)::text ||
        ' but field_5050 (Schedule 6) = $' || ROUND(fd.field_5050)::text ||
        '. Dictionary line 1025: line 855 "must be pre-populated with the amount from line 5050 from Schedule 6 of this return"',
      ABS(dq.field_855 - fd.field_5050)
    FROM cra.cra_disbursement_quota dq
    JOIN cra.cra_financial_details fd ON dq.bn = fd.bn AND dq.fpe = fd.fpe
    ${joinId}
    WHERE dq.field_855 IS NOT NULL AND fd.field_5050 IS NOT NULL
      AND ABS(dq.field_855 - fd.field_5050) > $1
    ON CONFLICT DO NOTHING
  `, [TOLERANCE]);

  // ─── SCHEDULE DEPENDENCIES ────────────────────────────────────────────────

  // SCH3_DEP_FORWARD: C9=TRUE → Schedule 3 (cra_compensation row) must exist
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      g.bn, g.fpe, EXTRACT(YEAR FROM g.fpe)::int, ci.legal_name,
      'SCH3_DEP_FORWARD', 'DEPENDENCY',
      'field_3400 (C9) = TRUE but no Schedule 3 row exists in cra_compensation for this (bn,fpe). ' ||
      'T3010 form line 133: "Did the charity incur any expenses for compensation of employees ... If yes, you must complete Schedule 3"',
      1
    FROM cra.cra_financial_general g
    LEFT JOIN cra.cra_compensation cc ON cc.bn = g.bn AND cc.fpe = g.fpe
    LEFT JOIN cra.cra_identification ci
      ON ci.bn = g.bn AND ci.fiscal_year = EXTRACT(YEAR FROM g.fpe)::int
    WHERE g.field_3400 = TRUE AND cc.bn IS NULL
    ON CONFLICT DO NOTHING
  `);

  // SCH3_DEP_REVERSE: Schedule 3 populated → C9 must = TRUE
  await client.query(`
    INSERT INTO cra.t3010_arithmetic_violations
      (bn, fpe, fiscal_year, legal_name, rule_code, rule_family, details, severity)
    SELECT
      cc.bn, cc.fpe, EXTRACT(YEAR FROM cc.fpe)::int, ci.legal_name,
      'SCH3_DEP_REVERSE', 'DEPENDENCY',
      'Schedule 3 (cra_compensation) row exists but field_3400 (C9) = FALSE or NULL. ' ||
      'T3010 form line 467 (Schedule 3): "If you complete this section, you must answer yes to question C9"',
      COALESCE(cc.field_390, 0)
    FROM cra.cra_compensation cc
    JOIN cra.cra_financial_general g ON g.bn = cc.bn AND g.fpe = cc.fpe
    LEFT JOIN cra.cra_identification ci
      ON ci.bn = cc.bn AND ci.fiscal_year = EXTRACT(YEAR FROM cc.fpe)::int
    WHERE (g.field_3400 IS NULL OR g.field_3400 = FALSE)
    ON CONFLICT DO NOTHING
  `);

  const counts = await client.query(`
    SELECT rule_code, rule_family,
           COUNT(*)::int           AS rows,
           COUNT(DISTINCT bn)::int AS bns
    FROM cra.t3010_arithmetic_violations
    GROUP BY rule_code, rule_family
    ORDER BY rule_family, rule_code
  `);
  log.info('\n  Violations by rule:');
  for (const r of counts.rows) {
    log.info(`    ${(r.rule_family + ' / ' + r.rule_code).padEnd(42)} ${String(r.rows).padStart(6)} rows   ${String(r.bns).padStart(6)} BNs`);
  }
}

// ─── Phase 3: Reporting ──────────────────────────────────────────────────────

async function report(client) {
  log.info('\nPhase 3: Building report...');

  const scope = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM cra.cra_financial_details)::int                       AS total_filings,
      (SELECT COUNT(*)::int FROM cra.t3010_arithmetic_violations)                  AS total_violations,
      (SELECT COUNT(DISTINCT bn)::int FROM cra.t3010_arithmetic_violations)        AS distinct_bns,
      (SELECT COUNT(DISTINCT (bn, fpe))::int FROM cra.t3010_arithmetic_violations) AS distinct_charity_years
  `);

  const byRule = await client.query(`
    SELECT rule_family, rule_code,
           COUNT(*)::int              AS rows,
           COUNT(DISTINCT bn)::int    AS distinct_bns,
           SUM(severity)::numeric     AS sum_severity,
           MAX(severity)::numeric     AS max_severity
    FROM cra.t3010_arithmetic_violations
    GROUP BY rule_family, rule_code ORDER BY rule_family, rule_code
  `);

  const byYear = await client.query(`
    SELECT fiscal_year, rule_code, COUNT(*)::int AS n
    FROM cra.t3010_arithmetic_violations
    GROUP BY fiscal_year, rule_code
    ORDER BY fiscal_year, rule_code
  `);

  const topPerRule = {};
  for (const row of byRule.rows) {
    const r = await client.query(`
      SELECT bn, fiscal_year, legal_name, details, severity
      FROM cra.t3010_arithmetic_violations
      WHERE rule_code = $1
      ORDER BY severity DESC NULLS LAST
      LIMIT $2
    `, [row.rule_code, args.top]);
    topPerRule[row.rule_code] = r.rows;
  }

  return { scope: scope.rows[0], byRule: byRule.rows, byYear: byYear.rows, topPerRule };
}

const $ = (n) => n === null || n === undefined ? '—' : '$' + Math.round(Number(n)).toLocaleString();

async function emit(r) {
  log.section('RESULTS');

  const s = r.scope;
  console.log('');
  console.log('── Scope');
  console.log(`  Financial filings scanned:                ${Number(s.total_filings).toLocaleString()}`);
  console.log(`  Arithmetic violations recorded:            ${Number(s.total_violations).toLocaleString()}`);
  console.log(`  Distinct BNs with ≥1 violation:            ${Number(s.distinct_bns).toLocaleString()}`);
  console.log(`  Distinct charity-years with ≥1 violation:  ${Number(s.distinct_charity_years).toLocaleString()}`);

  console.log('');
  console.log('── Violations by rule family and rule');
  let lastFamily = '';
  for (const row of r.byRule) {
    if (row.rule_family !== lastFamily) {
      console.log(`\n  ${row.rule_family}`);
      lastFamily = row.rule_family;
    }
    console.log(
      `    ${row.rule_code.padEnd(22)} ` +
      `${String(row.rows).padStart(6)} rows   ` +
      `${String(row.distinct_bns).padStart(6)} BNs   ` +
      `Σ sev ${$(row.sum_severity).padStart(15)}   ` +
      `max ${$(row.max_severity).padStart(12)}`
    );
  }

  for (const [rule, rows] of Object.entries(r.topPerRule)) {
    if (!rows.length) continue;
    console.log('');
    console.log(`── Top ${Math.min(args.top, rows.length)} violators of ${rule}`);
    for (const row of rows) {
      const name = (row.legal_name || '(not in identification)').slice(0, 50);
      console.log(`  ${row.bn}  FY ${row.fiscal_year}  ${name.padEnd(50)}  severity=${$(row.severity).padStart(14)}`);
      console.log(`    ${(row.details || '').slice(0, 240)}`);
    }
  }

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 't3010-arithmetic-impossibilities.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), options: args, ...r }, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 't3010-arithmetic-impossibilities.md'), buildMd(r));
  log.info('');
  log.info('  JSON: data/reports/data-quality/t3010-arithmetic-impossibilities.json');
  log.info('  MD:   data/reports/data-quality/t3010-arithmetic-impossibilities.md');
}

function buildMd(r) {
  const s = r.scope;

  const ruleTable = r.byRule.map(row =>
    `| ${row.rule_family} | ${row.rule_code} | ${Number(row.rows).toLocaleString()} | ${Number(row.distinct_bns).toLocaleString()} | ${$(row.sum_severity)} | ${$(row.max_severity)} |`
  ).join('\n');

  // Pivot byYear (fiscal_year, rule_code, n) into a wide table
  const years = Array.from(new Set(r.byYear.map(x => x.fiscal_year))).sort();
  const rules = r.byRule.map(x => x.rule_code);
  const map = new Map(r.byYear.map(x => [`${x.fiscal_year}_${x.rule_code}`, x.n]));
  let yearPivot = `| FY | ${rules.join(' | ')} | Total |\n|---|${rules.map(() => '---:').join('|')}|---:|\n`;
  for (const y of years) {
    const cells = rules.map(rc => map.get(`${y}_${rc}`) || 0);
    const total = cells.reduce((a, b) => a + b, 0);
    yearPivot += `| ${y} | ${cells.join(' | ')} | ${total} |\n`;
  }

  const ruleTitles = {
    IDENTITY_5100:    'IDENTITY_5100 — field_5100 ≠ field_4950 + field_5045 + field_5050',
    PARTITION_4950:   'PARTITION_4950 — field_5000 + field_5010 + field_5020 + field_5040 > field_4950',
    IDENTITY_4200:    'IDENTITY_4200 — field_4200 (total assets) ≠ sum of asset lines 4100…4170',
    IDENTITY_4350:    'IDENTITY_4350 — field_4350 (total liabilities) ≠ field_4300 + 4310 + 4320 + 4330',
    COMP_4880_EQ_390: 'COMP_4880_EQ_390 — Schedule 6 field_4880 ≠ Schedule 3 field_390',
    DQ_845_EQ_5000:   'DQ_845_EQ_5000 — Schedule 8 line 845 ≠ field_5000 (Schedule 6)',
    DQ_850_EQ_5045:   'DQ_850_EQ_5045 — Schedule 8 line 850 ≠ field_5045 (Schedule 6)',
    DQ_855_EQ_5050:   'DQ_855_EQ_5050 — Schedule 8 line 855 ≠ field_5050 (Schedule 6)',
    SCH3_DEP_FORWARD: 'SCH3_DEP_FORWARD — field_3400 (C9) = TRUE but no Schedule 3 row',
    SCH3_DEP_REVERSE: 'SCH3_DEP_REVERSE — Schedule 3 row exists but field_3400 (C9) ≠ TRUE'
  };

  let topSections = '';
  for (const [rule, rows] of Object.entries(r.topPerRule)) {
    if (!rows.length) continue;
    topSections += `\n### ${ruleTitles[rule] || rule}\n\n`;
    topSections += '| BN | FY | Legal name | Severity | Supporting detail |\n|---|---:|---|---:|---|\n';
    for (const row of rows.slice(0, args.top)) {
      topSections += `| \`${row.bn}\` | ${row.fiscal_year} | ${(row.legal_name || '(not in identification)').replace(/\|/g, '/')} | ${$(row.severity)} | ${(row.details || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200)} |\n`;
    }
  }

  return `# CRA T3010 Arithmetic / Consistency Impossibilities

Generated: ${new Date().toISOString()}
Options: ${JSON.stringify(args)}

## Methodology: every rule is traced to form or dictionary text

This script flags filings that violate arithmetic identities,
cross-schedule equalities, or schedule dependencies stated directly in
one of two published CRA sources:

* **T3010 Registered Charity Information Return** (form text), reproduced
  in \`docs/guides-forms/T3010.md\`.
* **CRA Open Data Dictionary v2.0**, reproduced in
  \`docs/guides-forms/OPEN-DATA-DICTIONARY-V2.0 ENG.md\`.

No rule applies a threshold, a sign convention, or an assumption the
form does not make. Plausibility flags — magnitude outliers,
revenue-vs-expenditure ratios, sign rules on fields where the form or
dictionary allows negatives — are deliberately excluded. A filing that
violates any of these rules is structurally inconsistent on its face.

**Strict "both sides populated" rule.** Every identity (IDENTITY_5100,
IDENTITY_4200, IDENTITY_4350) only fires when BOTH the total AND at
least one component field are populated (NOT NULL) in the extract.
A filing where the total is reported but all components are NULL — or
vice versa — is treated as a **completeness** issue, not an arithmetic
impossibility, and is deliberately NOT flagged here. This is important
because Section D is the simplified schedule for charities with
revenue < \$100K: those filers report total assets (\`field_4200\`)
and total liabilities (\`field_4350\`) without the Schedule 6
breakdown lines. Treating a Section D balance sheet as "missing
component = 0 = violation" would produce tens of thousands of false
positives that are not filing errors at all.

Tolerance: **\$${TOLERANCE}** (rounding-level differences below this threshold
are not flagged).

## The 10 rules

### Expenditure-tree identities

| Rule | Check | Source |
|---|---|---|
| **IDENTITY_5100** | \`field_5100 = field_4950 + field_5045 + field_5050\` | T3010.md lines 281 & 657: "Total expenditures (add lines 4950, 5045 and 5050)" |
| **PARTITION_4950** | \`field_5000 + field_5010 + field_5020 + field_5040 ≤ field_4950\` | T3010.md lines 644, 648–651: "Of the amounts at lines 4950: ... 5000 ... 5010 ... 5020 ... 5040" |

### Balance-sheet identities

| Rule | Check | Source |
|---|---|---|
| **IDENTITY_4200** | \`field_4200 = field_4100 + 4110 + 4120 + 4130 + 4140 + 4150 + 4155 + 4160 + 4165 + 4166 + 4170\` | T3010.md line 584: "Total assets (add lines 4100, 4110 to 4155, and 4160 to 4170)". \`field_4180\` (pre-v27 10-year gift balance) and \`field_4190\` (v27+ impact investments) are NOT in the form sum. |
| **IDENTITY_4350** | \`field_4350 = field_4300 + field_4310 + field_4320 + field_4330\` | T3010.md line 572: "Total liabilities (add lines 4300 to 4330)" |

### Cross-schedule equalities

| Rule | Check | Source |
|---|---|---|
| **COMP_4880_EQ_390** | Schedule 6 \`field_4880\` = Schedule 3 \`field_390\` | T3010.md line 631: "Total expenditure on all compensation (enter the amount reported at line 390 in Schedule 3, if applicable) — 4880" |
| **DQ_845_EQ_5000** | Schedule 8 \`line 845\` = \`field_5000\` | Dictionary line 1023: "Must be pre-populated with the amount from line 5000 from Schedule 6 of this return" |
| **DQ_850_EQ_5045** | Schedule 8 \`line 850\` = \`field_5045\` | Dictionary line 1024: "Must be pre-populated with the amount from line 5045 from Schedule 6 of this return" |
| **DQ_855_EQ_5050** | Schedule 8 \`line 855\` = \`field_5050\` | Dictionary line 1025: "Must be pre-populated with the amount from line 5050 from Schedule 6 of this return" |

### Schedule dependencies

| Rule | Check | Source |
|---|---|---|
| **SCH3_DEP_FORWARD** | \`field_3400\` (C9) = TRUE → Schedule 3 row must exist in \`cra_compensation\` | T3010.md line 133 (Section C9): "Did the charity incur any expenses for compensation of employees during the fiscal period? ... Important: If yes, you must complete Schedule 3, Compensation." |
| **SCH3_DEP_REVERSE** | Schedule 3 row exists → \`field_3400\` (C9) must = TRUE | T3010.md line 467 (Schedule 3): "If you complete this section, you must answer yes to question C9." |

## Headline

| Metric | Value |
|---|---:|
| Financial filings scanned                  | ${Number(s.total_filings).toLocaleString()} |
| Total violations recorded                  | ${Number(s.total_violations).toLocaleString()} |
| Distinct BNs with ≥ 1 violation            | ${Number(s.distinct_bns).toLocaleString()} |
| Distinct charity-years with ≥ 1 violation  | ${Number(s.distinct_charity_years).toLocaleString()} |

## Violations by rule

| Family | Rule | Rows | Distinct BNs | Σ severity | Max severity |
|---|---|---:|---:|---:|---:|
${ruleTable}

## Violations by fiscal year

${yearPivot}

## Top violators by rule (full evidence, BN + FY + legal name + supporting detail)
${topSections}

## Reproducing

\`\`\`bash
cd CRA
npm run data-quality:arithmetic
node scripts/data-quality/02-t3010-arithmetic-impossibilities.js
node scripts/data-quality/02-t3010-arithmetic-impossibilities.js --top 40
\`\`\`

Persisted table: \`cra.t3010_arithmetic_violations\` — one row per
(bn, fpe, rule_code) with \`rule_family\` and a human-readable
\`details\` string for each.

## Caveats

* **Tolerance is \$${TOLERANCE}.** Rounding differences below that threshold are
  not flagged.
* **Severity** is the dollar magnitude of the violation where
  applicable (the difference between the reported total and the sum
  of its parts, the excess over a parent line, etc.). For
  \`SCH3_DEP_FORWARD\` severity is a placeholder 1; for
  \`SCH3_DEP_REVERSE\` it is the Schedule 3 \`field_390\` amount.
* **Rounding-only versions of the balance-sheet identities.** A
  small portion of the \`IDENTITY_4200\` and \`IDENTITY_4350\`
  violations are likely due to individual asset lines being reported
  in thousands while the totals are reported in ones (or vice versa).
  We still flag them — the form does not authorise mixed units.
* **Section D balance-sheet completeness is intentionally NOT flagged.**
  Section D (simplified schedule for charities with revenue < \$100K)
  requires a total (4200 / 4350) but does not require the breakdown
  lines. The strict "both sides populated" rule ensures those filings
  are not miscounted as identity violations.
* **Schedule 8 is only present for charities subject to the
  disbursement quota.** Rules DQ_845/850/855 only fire when both
  \`cra_disbursement_quota\` and \`cra_financial_details\` rows
  exist for the same (bn, fpe). Exempt charities are not checked.
* **One charity-year can trigger multiple rules.** The table stores
  one row per (bn, fpe, rule_code) so joins on (bn, fpe) may fan out.
`;
}

async function main() {
  log.section('Data-quality: T3010 arithmetic / consistency impossibilities');
  log.info(`Options: ${JSON.stringify(args)}`);
  const client = await db.getClient();
  try {
    await migrate(client);
    await runChecks(client);
    const r = await report(client);
    await emit(r);
    log.section('Arithmetic check complete');
  } catch (err) {
    log.error(`Fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

main();
