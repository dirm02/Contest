/**
 * 09-overhead-analysis.js
 *
 * Per-fiscal-year table of registered charities' overhead, compensation and
 * administrative costs in absolute dollars and as a share of revenue and
 * total expenditures.
 *
 * T3010 line mappings (validated against docs/DATA_DICTIONARY.md):
 *   field_4880 — Total expenditure on all compensation  (line 4880 / Sch.3 line 390)
 *   field_5010 — Management and administration          (line 5010)
 *   field_5020 — Fundraising                            (line 5020 — Sch. 6 only)
 *   field_5000 — Charitable programs                    (line 5000)
 *   field_5100 — Total expenditures                     (line 5100 = 4950 + 5045 + 5050)
 *   field_4700 — Total revenue                          (line 4700)
 *
 * Two "overhead" definitions are reported so the reader can pick:
 *   strict_overhead = admin + fundraising       (the conventional definition
 *                                                used in charity-watchdog
 *                                                literature and T3010 reviews)
 *   broad_overhead  = admin + fundraising + compensation
 *                                               (a more expansive definition;
 *                                                note compensation often
 *                                                includes program-delivery
 *                                                staff, so double-counting
 *                                                is possible against programs)
 *
 * Outputs:
 *   cra.overhead_by_year              — headline per-year table
 *   cra.overhead_by_year_designation  — per-year × A/B/C designation
 *   cra.overhead_by_charity           — per-BN × year (for drill-down)
 *   data/reports/overhead-analysis.{json,md}
 *
 * Usage:
 *   node scripts/advanced/09-overhead-analysis.js
 *   node scripts/advanced/09-overhead-analysis.js --top 50
 */

const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

function parseArgs() {
  const args = { top: 25 };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--top' && next) { args.top = parseInt(next, 10) || args.top; i++; }
  }
  return args;
}

const args = parseArgs();
const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

const FIELDS = ['field_4880', 'field_5010', 'field_5020', 'field_5000',
                'field_5100', 'field_4700', 'field_4950'];

// A charity-year whose total_expenditures exceeds $50B is almost certainly a
// T3010 data-entry error (no registered charity in Canada spends that much;
// the 2024 revenue of the *entire sector* is ~$442B). Apply the same test to
// compensation. This is a conservative floor — it catches the clear typos
// (e.g. cents-reported-as-dollars) without touching the real large entries.
const OUTLIER_EXP_THRESHOLD = 50_000_000_000;

// ─── Field validation ────────────────────────────────────────────────────────

async function validateFields(client) {
  log.info('Validating field names against cra_financial_details...');
  const res = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='cra' AND table_name='cra_financial_details'
      AND column_name = ANY($1::text[])
  `, [FIELDS]);
  const present = new Set(res.rows.map(r => r.column_name));
  for (const f of FIELDS) {
    if (!present.has(f)) throw new Error(`Missing expected field ${f}`);
  }
  log.info('  All expected fields present.');
}

// ─── Phase 1: Migration ──────────────────────────────────────────────────────

async function migrate(client) {
  log.info('Phase 1: Creating derived tables...');
  await client.query(`
    DROP TABLE IF EXISTS cra.overhead_by_charity           CASCADE;
    DROP TABLE IF EXISTS cra.overhead_by_year_designation  CASCADE;
    DROP TABLE IF EXISTS cra.overhead_by_year              CASCADE;

    CREATE TABLE cra.overhead_by_year (
      fiscal_year              int PRIMARY KEY,
      charities_filed          int,
      outliers_excluded        int,
      revenue                  numeric,
      total_expenditures       numeric,
      compensation             numeric,
      administration           numeric,
      fundraising              numeric,
      programs                 numeric,
      strict_overhead          numeric,
      broad_overhead           numeric,
      comp_pct_rev             numeric,
      admin_pct_rev            numeric,
      fundraising_pct_rev      numeric,
      strict_overhead_pct_rev  numeric,
      broad_overhead_pct_rev   numeric,
      comp_pct_exp             numeric,
      admin_pct_exp            numeric,
      fundraising_pct_exp      numeric,
      strict_overhead_pct_exp  numeric,
      broad_overhead_pct_exp   numeric
    );

    CREATE TABLE cra.overhead_by_year_designation (
      fiscal_year              int NOT NULL,
      designation              char(1) NOT NULL,
      charities                int,
      revenue                  numeric,
      total_expenditures       numeric,
      compensation             numeric,
      administration           numeric,
      fundraising              numeric,
      programs                 numeric,
      strict_overhead          numeric,
      broad_overhead           numeric,
      strict_overhead_pct_rev  numeric,
      broad_overhead_pct_rev   numeric,
      strict_overhead_pct_exp  numeric,
      broad_overhead_pct_exp   numeric,
      PRIMARY KEY (fiscal_year, designation)
    );

    CREATE TABLE cra.overhead_by_charity (
      bn                    varchar(15) NOT NULL,
      fiscal_year           int NOT NULL,
      legal_name            text,
      designation           char(1),
      category              varchar(10),
      revenue               numeric,
      total_expenditures    numeric,
      compensation          numeric,
      administration        numeric,
      fundraising           numeric,
      programs              numeric,
      strict_overhead       numeric,
      broad_overhead        numeric,
      strict_overhead_pct   numeric,
      broad_overhead_pct    numeric,
      outlier_flag          boolean DEFAULT false,
      PRIMARY KEY (bn, fiscal_year)
    );

    CREATE INDEX idx_obc_year        ON cra.overhead_by_charity (fiscal_year);
    CREATE INDEX idx_obc_designation ON cra.overhead_by_charity (designation);
    CREATE INDEX idx_obc_strict_pct  ON cra.overhead_by_charity (strict_overhead_pct DESC);
  `);
}

// ─── Phase 2: Per-charity × year ─────────────────────────────────────────────

async function buildByCharity(client) {
  log.info('\nPhase 2: Building per-charity × year profile (with outlier flag)...');
  await client.query(`
    INSERT INTO cra.overhead_by_charity
    WITH latest_id AS (
      SELECT DISTINCT ON (bn) bn, legal_name, designation, category
      FROM cra.cra_identification
      ORDER BY bn, fiscal_year DESC
    ),
    agg AS (
      SELECT
        fd.bn,
        EXTRACT(YEAR FROM fd.fpe)::int AS fiscal_year,
        SUM(COALESCE(fd.field_4700, 0)) AS revenue,
        SUM(COALESCE(fd.field_5100, 0)) AS total_expenditures,
        SUM(COALESCE(fd.field_4880, 0)) AS compensation,
        SUM(COALESCE(fd.field_5010, 0)) AS administration,
        SUM(COALESCE(fd.field_5020, 0)) AS fundraising,
        SUM(COALESCE(fd.field_5000, 0)) AS programs
      FROM cra.cra_financial_details fd
      WHERE fd.fpe IS NOT NULL
      GROUP BY fd.bn, EXTRACT(YEAR FROM fd.fpe)
    )
    SELECT
      a.bn,
      a.fiscal_year,
      li.legal_name,
      li.designation,
      li.category,
      a.revenue,
      a.total_expenditures,
      a.compensation,
      a.administration,
      a.fundraising,
      a.programs,
      (a.administration + a.fundraising)                        AS strict_overhead,
      (a.administration + a.fundraising + a.compensation)       AS broad_overhead,
      CASE WHEN a.revenue > 0
           THEN ROUND((a.administration + a.fundraising) / a.revenue * 100, 2) END
        AS strict_overhead_pct,
      CASE WHEN a.revenue > 0
           THEN ROUND((a.administration + a.fundraising + a.compensation) / a.revenue * 100, 2) END
        AS broad_overhead_pct,
      (a.total_expenditures > $1 OR a.compensation > $1) AS outlier_flag
    FROM agg a
    LEFT JOIN latest_id li ON li.bn = a.bn
  `, [OUTLIER_EXP_THRESHOLD]);

  const n   = (await client.query('SELECT COUNT(*)::int AS c FROM cra.overhead_by_charity')).rows[0].c;
  const out = (await client.query('SELECT COUNT(*)::int AS c FROM cra.overhead_by_charity WHERE outlier_flag')).rows[0].c;
  log.info(`  ${n.toLocaleString()} charity-year rows  (${out} flagged as outliers, excluded from aggregates)`);
  return out;
}

// ─── Phase 3: Per-year and per-year × designation ────────────────────────────

async function buildByYear(client) {
  log.info('\nPhase 3: Aggregating per-year totals (excluding flagged outliers)...');

  await client.query(`
    INSERT INTO cra.overhead_by_year
    WITH agg AS (
      SELECT
        fiscal_year,
        COUNT(*)::int                              AS charities_filed,
        SUM(CASE WHEN outlier_flag THEN 1 ELSE 0 END)::int AS outliers_excluded,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE revenue            END)::numeric AS revenue,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE total_expenditures END)::numeric AS total_expenditures,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE compensation       END)::numeric AS compensation,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE administration     END)::numeric AS administration,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE fundraising        END)::numeric AS fundraising,
        SUM(CASE WHEN outlier_flag THEN 0 ELSE programs           END)::numeric AS programs
      FROM cra.overhead_by_charity
      GROUP BY fiscal_year
    )
    SELECT
      fiscal_year, charities_filed, outliers_excluded,
      revenue, total_expenditures,
      compensation, administration, fundraising, programs,
      (administration + fundraising)                              AS strict_overhead,
      (administration + fundraising + compensation)               AS broad_overhead,
      CASE WHEN revenue > 0 THEN ROUND(compensation   / revenue * 100, 2) END,
      CASE WHEN revenue > 0 THEN ROUND(administration / revenue * 100, 2) END,
      CASE WHEN revenue > 0 THEN ROUND(fundraising    / revenue * 100, 2) END,
      CASE WHEN revenue > 0 THEN ROUND((administration + fundraising) / revenue * 100, 2) END,
      CASE WHEN revenue > 0 THEN ROUND((administration + fundraising + compensation) / revenue * 100, 2) END,
      CASE WHEN total_expenditures > 0 THEN ROUND(compensation   / total_expenditures * 100, 2) END,
      CASE WHEN total_expenditures > 0 THEN ROUND(administration / total_expenditures * 100, 2) END,
      CASE WHEN total_expenditures > 0 THEN ROUND(fundraising    / total_expenditures * 100, 2) END,
      CASE WHEN total_expenditures > 0 THEN ROUND((administration + fundraising) / total_expenditures * 100, 2) END,
      CASE WHEN total_expenditures > 0 THEN ROUND((administration + fundraising + compensation) / total_expenditures * 100, 2) END
    FROM agg
    ORDER BY fiscal_year
  `);

  await client.query(`
    INSERT INTO cra.overhead_by_year_designation
    WITH agg AS (
      SELECT
        fiscal_year,
        COALESCE(designation, '?') AS designation,
        COUNT(*)::int                          AS charities,
        SUM(revenue)::numeric                  AS revenue,
        SUM(total_expenditures)::numeric       AS total_expenditures,
        SUM(compensation)::numeric             AS compensation,
        SUM(administration)::numeric           AS administration,
        SUM(fundraising)::numeric              AS fundraising,
        SUM(programs)::numeric                 AS programs
      FROM cra.overhead_by_charity
      WHERE NOT outlier_flag
      GROUP BY fiscal_year, COALESCE(designation, '?')
    )
    SELECT
      fiscal_year, designation, charities,
      revenue, total_expenditures,
      compensation, administration, fundraising, programs,
      (administration + fundraising)                        AS strict_overhead,
      (administration + fundraising + compensation)         AS broad_overhead,
      CASE WHEN revenue > 0
           THEN ROUND((administration + fundraising) / revenue * 100, 2) END,
      CASE WHEN revenue > 0
           THEN ROUND((administration + fundraising + compensation) / revenue * 100, 2) END,
      CASE WHEN total_expenditures > 0
           THEN ROUND((administration + fundraising) / total_expenditures * 100, 2) END,
      CASE WHEN total_expenditures > 0
           THEN ROUND((administration + fundraising + compensation) / total_expenditures * 100, 2) END
    FROM agg
    ORDER BY fiscal_year, designation
  `);

  const y  = (await client.query('SELECT COUNT(*)::int AS c FROM cra.overhead_by_year')).rows[0].c;
  const yd = (await client.query('SELECT COUNT(*)::int AS c FROM cra.overhead_by_year_designation')).rows[0].c;
  log.info(`  ${y} fiscal years, ${yd} year × designation rows`);
}

// ─── Phase 4: Extras for the report ──────────────────────────────────────────

async function buildAnalytics(client) {
  log.info('\nPhase 4: Ranking charities by overhead...');

  const topAbsOverhead = await client.query(`
    SELECT
      bn, legal_name, designation, category,
      SUM(revenue)::numeric                  AS revenue,
      SUM(total_expenditures)::numeric       AS total_expenditures,
      SUM(compensation)::numeric             AS compensation,
      SUM(administration)::numeric           AS administration,
      SUM(fundraising)::numeric              AS fundraising,
      SUM(strict_overhead)::numeric          AS strict_overhead,
      SUM(broad_overhead)::numeric           AS broad_overhead,
      CASE WHEN SUM(revenue) > 0
           THEN ROUND(SUM(strict_overhead) / SUM(revenue) * 100, 1) END AS strict_pct,
      CASE WHEN SUM(revenue) > 0
           THEN ROUND(SUM(broad_overhead)  / SUM(revenue) * 100, 1) END AS broad_pct
    FROM cra.overhead_by_charity
    WHERE NOT outlier_flag
    GROUP BY bn, legal_name, designation, category
    ORDER BY SUM(strict_overhead) DESC NULLS LAST
    LIMIT $1
  `, [args.top]);

  const topPctOverhead = await client.query(`
    SELECT
      bn, legal_name, designation, category,
      SUM(revenue)::numeric                  AS revenue,
      SUM(strict_overhead)::numeric          AS strict_overhead,
      SUM(broad_overhead)::numeric           AS broad_overhead,
      ROUND(SUM(strict_overhead) / NULLIF(SUM(revenue),0) * 100, 1) AS strict_pct,
      ROUND(SUM(broad_overhead)  / NULLIF(SUM(revenue),0) * 100, 1) AS broad_pct
    FROM cra.overhead_by_charity
    WHERE NOT outlier_flag
    GROUP BY bn, legal_name, designation, category
    HAVING SUM(revenue) > 5000000
       AND SUM(strict_overhead) > 500000
    ORDER BY SUM(strict_overhead) / NULLIF(SUM(revenue),0) DESC NULLS LAST
    LIMIT $1
  `, [args.top]);

  const outliers = await client.query(`
    SELECT bn, fiscal_year, legal_name, designation,
           revenue, total_expenditures, compensation
    FROM cra.overhead_by_charity
    WHERE outlier_flag
    ORDER BY GREATEST(total_expenditures, compensation) DESC
  `);

  const byDes = await client.query(`
    SELECT * FROM cra.overhead_by_year_designation
    ORDER BY fiscal_year, designation
  `);

  return {
    topAbsOverhead: topAbsOverhead.rows,
    topPctOverhead: topPctOverhead.rows,
    outliers: outliers.rows,
    byDesignation: byDes.rows
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function $(n, scale = 1) {
  if (n === null || n === undefined) return '—';
  const num = Number(n) / scale;
  if (!isFinite(num)) return '—';
  return '$' + Math.round(num).toLocaleString('en-US');
}
const $b = (n) => $(n, 1e9) + 'B';
const $m = (n) => $(n, 1e6) + 'M';
const pct = (n) => n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}%`;

// ─── Output ──────────────────────────────────────────────────────────────────

async function emit(yearRows, analytics) {
  log.section('RESULTS');

  // ── Headline: per-year overhead table ─────────────────────────────────────
  console.log('');
  console.log('── Per-year absolute dollars ($ billions unless noted):');
  console.log('');
  console.log('  Year  Filed  Revenue  TotalExp  Compensation  Admin   Fund   Programs  StrictOH  BroadOH');
  console.log('  ----  -----  -------  --------  ------------  -----   ----   --------  --------  -------');
  for (const r of yearRows) {
    console.log(
      `  ${r.fiscal_year}` +
      `  ${String(r.charities_filed).padStart(5)}` +
      `  ${$b(r.revenue).padStart(7)}` +
      `  ${$b(r.total_expenditures).padStart(8)}` +
      `  ${$b(r.compensation).padStart(12)}` +
      `  ${$b(r.administration).padStart(5)}` +
      `  ${$b(r.fundraising).padStart(4)}` +
      `  ${$b(r.programs).padStart(8)}` +
      `  ${$b(r.strict_overhead).padStart(8)}` +
      `  ${$b(r.broad_overhead).padStart(7)}`
    );
  }

  console.log('');
  console.log('── Per-year % of REVENUE:');
  console.log('');
  console.log('  Year    Comp%   Admin%  Fund%   Strict OH%   Broad OH%');
  console.log('  ----    -----   ------  -----   ----------   ---------');
  for (const r of yearRows) {
    console.log(
      `  ${r.fiscal_year}` +
      `   ${pct(r.comp_pct_rev).padStart(6)}` +
      `  ${pct(r.admin_pct_rev).padStart(6)}` +
      `  ${pct(r.fundraising_pct_rev).padStart(6)}` +
      `   ${pct(r.strict_overhead_pct_rev).padStart(9)}` +
      `   ${pct(r.broad_overhead_pct_rev).padStart(8)}`
    );
  }

  console.log('');
  console.log('── Per-year % of TOTAL EXPENDITURES:');
  console.log('');
  console.log('  Year    Comp%   Admin%  Fund%   Strict OH%   Broad OH%');
  console.log('  ----    -----   ------  -----   ----------   ---------');
  for (const r of yearRows) {
    console.log(
      `  ${r.fiscal_year}` +
      `   ${pct(r.comp_pct_exp).padStart(6)}` +
      `  ${pct(r.admin_pct_exp).padStart(6)}` +
      `  ${pct(r.fundraising_pct_exp).padStart(6)}` +
      `   ${pct(r.strict_overhead_pct_exp).padStart(9)}` +
      `   ${pct(r.broad_overhead_pct_exp).padStart(8)}`
    );
  }

  console.log('');
  console.log('── Per-year × designation — strict overhead% of revenue:');
  const byYr = new Map();
  for (const r of analytics.byDesignation) {
    if (!byYr.has(r.fiscal_year)) byYr.set(r.fiscal_year, {});
    byYr.get(r.fiscal_year)[r.designation] = r;
  }
  console.log('  Year    A (public fdn)     B (private fdn)    C (charitable org)');
  for (const [yr, m] of [...byYr.entries()].sort((a, b) => a[0] - b[0])) {
    const fmt = (d) => {
      if (!m[d]) return ''.padEnd(18);
      return `${pct(m[d].strict_overhead_pct_rev).padStart(7)} on ${$b(m[d].revenue).padStart(7)}`;
    };
    console.log(`  ${yr}   ${fmt('A')}   ${fmt('B')}   ${fmt('C')}`);
  }

  console.log('');
  console.log(`── Top ${args.top} charities by absolute STRICT overhead (5-year):`);
  for (const r of analytics.topAbsOverhead) {
    console.log(
      `  ${r.bn}  ${(r.legal_name || '').slice(0, 44).padEnd(44)}  ` +
      `D=${r.designation ?? '?'}  ` +
      `admin ${$m(r.administration).padStart(10)}  ` +
      `fund ${$m(r.fundraising).padStart(10)}  ` +
      `strictOH ${$m(r.strict_overhead).padStart(11)}  ` +
      `broadOH ${$m(r.broad_overhead).padStart(12)}  ` +
      `strict% ${String(r.strict_pct ?? '—').padStart(5)}  ` +
      `broad% ${String(r.broad_pct ?? '—').padStart(5)}`
    );
  }

  console.log('');
  console.log(`── Highest strict-overhead % (revenue > $5M, overhead > $500K):`);
  for (const r of analytics.topPctOverhead) {
    console.log(
      `  ${r.bn}  ${(r.legal_name || '').slice(0, 50).padEnd(50)}  ` +
      `D=${r.designation ?? '?'}  ` +
      `rev ${$m(r.revenue).padStart(12)}  ` +
      `strictOH ${$m(r.strict_overhead).padStart(11)}  ` +
      `strict% ${String(r.strict_pct ?? '—').padStart(5)}  ` +
      `broad% ${String(r.broad_pct ?? '—').padStart(5)}`
    );
  }

  if (analytics.outliers.length) {
    console.log('');
    console.log(`── Data-quality outliers excluded from aggregates (${analytics.outliers.length}):`);
    console.log('  These charity-years reported total expenditures or compensation > $50B,');
    console.log('  which exceeds any single Canadian charity\'s plausible scale. Most are');
    console.log('  likely unit-of-measure errors in the T3010 return.');
    for (const r of analytics.outliers) {
      console.log(
        `  ${r.bn}  ${r.fiscal_year}  ${(r.legal_name || '').slice(0, 40).padEnd(40)}  ` +
        `rev ${$m(r.revenue).padStart(12)}  ` +
        `totExp ${$m(r.total_expenditures).padStart(12)}  ` +
        `comp ${$m(r.compensation).padStart(12)}`
      );
    }
  }

  // ── Write files
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, 'overhead-analysis.json');
  const mdPath   = path.join(REPORT_DIR, 'overhead-analysis.md');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    options: args,
    outlier_threshold: OUTLIER_EXP_THRESHOLD,
    by_year: yearRows,
    by_year_designation: analytics.byDesignation,
    top_absolute_overhead: analytics.topAbsOverhead,
    top_percent_overhead:  analytics.topPctOverhead,
    outliers_excluded:     analytics.outliers
  }, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(yearRows, analytics));
  log.info('');
  log.info(`  JSON report: ${jsonPath}`);
  log.info(`  MD report:   ${mdPath}`);
}

function buildMarkdown(yearRows, analytics) {
  const abs = yearRows.map(r =>
    `| ${r.fiscal_year} | ${Number(r.charities_filed).toLocaleString()} | ${r.outliers_excluded} | ${$m(r.revenue)} | ${$m(r.total_expenditures)} | ${$m(r.compensation)} | ${$m(r.administration)} | ${$m(r.fundraising)} | ${$m(r.programs)} | ${$m(r.strict_overhead)} | ${$m(r.broad_overhead)} |`
  ).join('\n');

  const pctRev = yearRows.map(r =>
    `| ${r.fiscal_year} | ${pct(r.comp_pct_rev)} | ${pct(r.admin_pct_rev)} | ${pct(r.fundraising_pct_rev)} | ${pct(r.strict_overhead_pct_rev)} | ${pct(r.broad_overhead_pct_rev)} |`
  ).join('\n');

  const pctExp = yearRows.map(r =>
    `| ${r.fiscal_year} | ${pct(r.comp_pct_exp)} | ${pct(r.admin_pct_exp)} | ${pct(r.fundraising_pct_exp)} | ${pct(r.strict_overhead_pct_exp)} | ${pct(r.broad_overhead_pct_exp)} |`
  ).join('\n');

  const byYearDes = analytics.byDesignation.map(r =>
    `| ${r.fiscal_year} | ${r.designation} | ${Number(r.charities).toLocaleString()} | ${$m(r.revenue)} | ${$m(r.strict_overhead)} | ${pct(r.strict_overhead_pct_rev)} | ${pct(r.strict_overhead_pct_exp)} | ${$m(r.broad_overhead)} | ${pct(r.broad_overhead_pct_rev)} |`
  ).join('\n');

  const topAbs = analytics.topAbsOverhead.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${$m(r.revenue)} | ${$m(r.administration)} | ${$m(r.fundraising)} | ${$m(r.compensation)} | ${$m(r.strict_overhead)} | ${r.strict_pct ?? '—'}% | ${r.broad_pct ?? '—'}% |`
  ).join('\n');

  const topPct = analytics.topPctOverhead.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${$m(r.revenue)} | ${$m(r.strict_overhead)} | ${r.strict_pct ?? '—'}% | ${r.broad_pct ?? '—'}% |`
  ).join('\n');

  const outlierRows = analytics.outliers.map(r =>
    `| ${r.bn} | ${r.fiscal_year} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${$m(r.revenue)} | ${$m(r.total_expenditures)} | ${$m(r.compensation)} |`
  ).join('\n');

  return `# CRA Charity Overhead, Compensation & Administration (5-year)

Generated: ${new Date().toISOString()}
Options: ${JSON.stringify(args)}

## What this report shows

For each fiscal year 2020–2024, the absolute dollar figures filed by
registered charities on the T3010 Information Return for:

* **Compensation** — \`field_4880\` (T3010 line 4880 = Schedule 3 line 390)
* **Administration** — \`field_5010\` (T3010 line 5010)
* **Fundraising** — \`field_5020\` (T3010 line 5020 — Schedule 6 only)
* **Programs** — \`field_5000\` (T3010 line 5000)
* **Total expenditures** — \`field_5100\` (T3010 line 5100)
* **Revenue** — \`field_4700\` (T3010 line 4700)

Two overhead definitions are reported:

| Definition | Formula | Usage |
|---|---|---|
| **Strict overhead** | administration + fundraising | The conventional charity-watchdog ratio; CRA publishes ~35% as a rough threshold for scrutiny. |
| **Broad overhead** | administration + fundraising + **compensation** | Surfaces organisations whose largest cost is paid staff rather than program delivery. Note compensation often includes program-delivery staff, so this overlaps with "programs" at many charities. |

Each measure is shown in absolute dollars, as % of **revenue** (the funding
the charity received), and as % of **total expenditures** (what the charity
actually spent).

## Absolute dollars — per fiscal year ($ millions)

| Year | Filed | Outliers excl. | Revenue | Total exp | Compensation | Admin | Fundraising | Programs | Strict OH | Broad OH |
|------|------:|---------------:|--------:|----------:|-------------:|------:|------------:|---------:|----------:|---------:|
${abs}

## Percent of revenue — per fiscal year

| Year | Comp % | Admin % | Fundraising % | **Strict overhead %** | **Broad overhead %** |
|------|------:|------:|------:|------:|------:|
${pctRev}

## Percent of total expenditures — per fiscal year

| Year | Comp % | Admin % | Fundraising % | **Strict overhead %** | **Broad overhead %** |
|------|------:|------:|------:|------:|------:|
${pctExp}

## Per-year × CRA designation

A = Public foundation, B = Private foundation, C = Charitable organization.

| Year | Desig. | Charities | Revenue | Strict OH | Strict OH / rev | Strict OH / exp | Broad OH | Broad OH / rev |
|------|--------|----------:|--------:|----------:|----------------:|----------------:|---------:|---------------:|
${byYearDes}

## Top ${args.top} charities by absolute strict overhead (5-year cumulative)

| BN | Legal name | D | Revenue | Administration | Fundraising | Compensation | Strict OH | Strict % | Broad % |
|----|------------|---|--------:|---------------:|------------:|-------------:|----------:|---------:|--------:|
${topAbs}

## Highest strict-overhead % (revenue > \$5M, strict overhead > \$500K)

| BN | Legal name | D | Revenue | Strict OH | Strict % | Broad % |
|----|------------|---|--------:|----------:|---------:|--------:|
${topPct}

${analytics.outliers.length ? `## Data-quality outliers excluded

Charity-years where total expenditures or compensation exceeded \$${(OUTLIER_EXP_THRESHOLD/1e9).toFixed(0)}B —
larger than any single Canadian charity plausibly operates — are excluded
from aggregates because they are almost certainly T3010 data-entry errors
(e.g. unit-of-measure mistakes).

| BN | Year | Legal name | Revenue | Total exp (reported) | Compensation (reported) |
|----|------|------------|--------:|---------------------:|------------------------:|
${outlierRows}
` : ''}

## Reproducing this analysis

\`\`\`bash
cd CRA
node scripts/advanced/09-overhead-analysis.js              # default top 25
node scripts/advanced/09-overhead-analysis.js --top 100
\`\`\`

Derived tables persisted to the \`cra\` schema:

* \`cra.overhead_by_year\`             — one row per fiscal year
* \`cra.overhead_by_year_designation\` — per year × A/B/C
* \`cra.overhead_by_charity\`          — per BN × year (with \`outlier_flag\`)

## Caveats

* **"Compensation" and "programs" overlap.** Schedule 3 compensation
  (line 4880) typically includes program-delivery staff (teachers, nurses,
  social workers). Subtracting compensation from total expenditures and
  calling the remainder "programs" is misleading. This is why programs
  (line 5000) and compensation (line 4880) are reported separately here.
* **Sector expectations differ.** Designation A (public foundations) and B
  (private foundations) legitimately report higher administration ratios
  because they manage endowments. Designation C (charitable organisations)
  is where high strict-overhead figures are most worth follow-up.
* **Fundraising is Schedule 6 only.** Small charities filing Section D do
  not report fundraising separately, so national fundraising totals are
  slightly understated (though the affected charities are small in aggregate).
* **2024 is partial.** Late filings can still arrive; 2024 totals may rise.
* **Revenue denominator caveat.** Foundations often show overhead > 100%
  of reported revenue because endowment draws are expensed but do not
  count as revenue under line 4700. Strict overhead as % of total
  *expenditures* is a more stable benchmark than % of revenue for that
  population.
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log.section('Step 9: Per-year overhead, compensation & administration');
  log.info(`Options: ${JSON.stringify(args)}`);
  const client = await db.getClient();
  try {
    await validateFields(client);
    await migrate(client);
    await buildByCharity(client);
    await buildByYear(client);
    const rows = await client.query('SELECT * FROM cra.overhead_by_year ORDER BY fiscal_year');
    const analytics = await buildAnalytics(client);
    await emit(rows.rows, analytics);
    log.section('Step 9 Complete');
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
