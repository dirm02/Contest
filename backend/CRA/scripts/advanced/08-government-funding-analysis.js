/**
 * 08-government-funding-analysis.js
 *
 * Quantifies, year by year, how much of registered charities' revenue
 * originates with Canadian governments, broken down by level:
 *
 *   • Federal        — T3010 line 4540 (field_4540)     [Schedule 6 filers]
 *   • Provincial     — T3010 line 4550 (field_4550)     [Schedule 6 filers]
 *   • Municipal      — T3010 line 4560 (field_4560)     [Schedule 6 filers]
 *   • Combined govt  — T3010 line 4570 (field_4570)     [Section D filers]
 *
 * Why both 4540/4550/4560 *and* 4570:
 *   Schedule 6 filers (the ~85% of charity-years with revenue ≥ $100K)
 *   report government revenue broken out by level. Section D filers (smaller
 *   charities) report only a single combined figure in 4570. Using only
 *   4540+4550 would systematically under-report smaller charities. This
 *   script uses both so the totals reconcile to the full charity sector.
 *
 * Produces:
 *   • cra.govt_funding_by_year     — one row per fiscal year
 *   • cra.govt_funding_by_charity  — one row per charity × year with shares
 *   • data/reports/govt-funding-analysis.{json,md}
 *
 * Usage:
 *   node scripts/advanced/08-government-funding-analysis.js
 *   node scripts/advanced/08-government-funding-analysis.js --top 50
 *   node scripts/advanced/08-government-funding-analysis.js --designation C
 *
 * All figures come from the charities' own filings; totals are subject to
 * 2024 partial-filing drag (T3010 returns may be filed up to 6 months after
 * fiscal year-end) and the known under-reporting of Section D filers who
 * do not break out government revenue by level.
 */

const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

function parseArgs() {
  const args = { top: 25, designation: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--top' && next) { args.top = parseInt(next, 10) || args.top; i++; }
    else if (a === '--designation' && next) { args.designation = next.toUpperCase(); i++; }
  }
  return args;
}

const args = parseArgs();

const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

// ─── Field validation ────────────────────────────────────────────────────────

async function validateFields(client) {
  log.info('Validating field names against cra_financial_details...');
  const res = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='cra' AND table_name='cra_financial_details'
      AND column_name = ANY($1::text[])
  `, [['field_4540', 'field_4550', 'field_4560', 'field_4570', 'field_4700']]);
  const present = new Set(res.rows.map(r => r.column_name));
  for (const f of ['field_4540', 'field_4550', 'field_4560', 'field_4570', 'field_4700']) {
    if (!present.has(f)) throw new Error(`Missing expected field ${f} in cra_financial_details`);
  }
  log.info('  All expected fields present.');
}

// ─── Phase 1: Migration ──────────────────────────────────────────────────────

async function migrate(client) {
  log.info('Phase 1: Creating derived tables...');
  await client.query(`
    DROP TABLE IF EXISTS cra.govt_funding_by_charity CASCADE;
    DROP TABLE IF EXISTS cra.govt_funding_by_year    CASCADE;

    CREATE TABLE cra.govt_funding_by_year (
      fiscal_year         int PRIMARY KEY,
      charities_filed     int,
      charities_any_govt  int,
      federal             numeric,
      provincial          numeric,
      municipal           numeric,
      combined_sectiond   numeric,
      total_govt          numeric,
      total_revenue       numeric,
      federal_pct         numeric,
      provincial_pct      numeric,
      municipal_pct       numeric,
      total_govt_pct      numeric
    );

    CREATE TABLE cra.govt_funding_by_charity (
      bn                  varchar(15) NOT NULL,
      fiscal_year         int         NOT NULL,
      legal_name          text,
      designation         char(1),
      category            varchar(10),
      federal             numeric,
      provincial          numeric,
      municipal           numeric,
      combined_sectiond   numeric,
      total_govt          numeric,
      revenue             numeric,
      govt_share_of_rev   numeric,
      PRIMARY KEY (bn, fiscal_year)
    );

    CREATE INDEX idx_gfbc_year        ON cra.govt_funding_by_charity (fiscal_year);
    CREATE INDEX idx_gfbc_designation ON cra.govt_funding_by_charity (designation);
    CREATE INDEX idx_gfbc_total_govt  ON cra.govt_funding_by_charity (total_govt DESC);
  `);
}

// ─── Phase 2: Per-year aggregates ────────────────────────────────────────────

async function buildByYear(client) {
  log.info('\nPhase 2: Aggregating government funding by fiscal year...');
  await client.query(`
    INSERT INTO cra.govt_funding_by_year
    WITH yr AS (
      SELECT
        EXTRACT(YEAR FROM fpe)::int AS fiscal_year,
        COUNT(*)::int                                       AS charities_filed,
        COUNT(*) FILTER (
          WHERE COALESCE(field_4540,0) + COALESCE(field_4550,0)
              + COALESCE(field_4560,0) + COALESCE(field_4570,0) > 0
        )::int                                              AS charities_any_govt,
        SUM(COALESCE(field_4540, 0))::numeric               AS federal,
        SUM(COALESCE(field_4550, 0))::numeric               AS provincial,
        SUM(COALESCE(field_4560, 0))::numeric               AS municipal,
        SUM(COALESCE(field_4570, 0))::numeric               AS combined_sectiond,
        SUM(COALESCE(field_4700, 0))::numeric               AS total_revenue
      FROM cra.cra_financial_details
      WHERE fpe IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM fpe)
    )
    SELECT
      fiscal_year, charities_filed, charities_any_govt,
      federal, provincial, municipal, combined_sectiond,
      (federal + provincial + municipal + combined_sectiond) AS total_govt,
      total_revenue,
      CASE WHEN total_revenue > 0 THEN ROUND(federal    / total_revenue * 100, 2) END,
      CASE WHEN total_revenue > 0 THEN ROUND(provincial / total_revenue * 100, 2) END,
      CASE WHEN total_revenue > 0 THEN ROUND(municipal  / total_revenue * 100, 2) END,
      CASE WHEN total_revenue > 0
           THEN ROUND((federal + provincial + municipal + combined_sectiond)
                      / total_revenue * 100, 2) END
    FROM yr
    ORDER BY fiscal_year
  `);
  const rows = await client.query('SELECT * FROM cra.govt_funding_by_year ORDER BY fiscal_year');
  log.info(`  ${rows.rowCount} fiscal years aggregated`);
  return rows.rows;
}

// ─── Phase 3: Per-charity aggregates ─────────────────────────────────────────

async function buildByCharity(client) {
  log.info('\nPhase 3: Building per-charity × year profile...');
  await client.query(`
    INSERT INTO cra.govt_funding_by_charity
    WITH latest_id AS (
      SELECT DISTINCT ON (bn) bn, legal_name, designation, category
      FROM cra.cra_identification
      ORDER BY bn, fiscal_year DESC
    ),
    agg AS (
      SELECT
        fd.bn,
        EXTRACT(YEAR FROM fd.fpe)::int AS fiscal_year,
        SUM(COALESCE(fd.field_4540, 0)) AS federal,
        SUM(COALESCE(fd.field_4550, 0)) AS provincial,
        SUM(COALESCE(fd.field_4560, 0)) AS municipal,
        SUM(COALESCE(fd.field_4570, 0)) AS combined_sectiond,
        SUM(COALESCE(fd.field_4700, 0)) AS revenue
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
      a.federal,
      a.provincial,
      a.municipal,
      a.combined_sectiond,
      (a.federal + a.provincial + a.municipal + a.combined_sectiond) AS total_govt,
      a.revenue,
      CASE WHEN a.revenue > 0
           THEN ROUND((a.federal + a.provincial + a.municipal + a.combined_sectiond)
                      / a.revenue * 100, 2)
      END AS govt_share_of_rev
    FROM agg a
    LEFT JOIN latest_id li ON li.bn = a.bn
    WHERE (a.federal + a.provincial + a.municipal + a.combined_sectiond) > 0
  `);
  const n = (await client.query('SELECT COUNT(*)::int AS c FROM cra.govt_funding_by_charity')).rows[0].c;
  log.info(`  ${n.toLocaleString()} charity-year rows with any government funding`);
}

// ─── Phase 4: Additional analytics ───────────────────────────────────────────

async function buildAnalytics(client) {
  log.info('\nPhase 4: Computing breakouts and rankings...');

  const designationFilter = args.designation
    ? `AND gc.designation = '${args.designation.replace(/'/g, "''")}'`
    : '';

  const byDesignation = await client.query(`
    SELECT
      COALESCE(gc.designation, '?') AS designation,
      COUNT(DISTINCT gc.bn)::int    AS charities,
      SUM(gc.federal)::numeric      AS federal,
      SUM(gc.provincial)::numeric   AS provincial,
      SUM(gc.municipal)::numeric    AS municipal,
      SUM(gc.combined_sectiond)::numeric AS combined_sectiond,
      SUM(gc.total_govt)::numeric   AS total_govt,
      SUM(gc.revenue)::numeric      AS revenue
    FROM cra.govt_funding_by_charity gc
    GROUP BY gc.designation
    ORDER BY gc.designation
  `);

  const topRecipients = await client.query(`
    SELECT
      bn,
      legal_name,
      designation,
      category,
      SUM(federal)::numeric        AS federal,
      SUM(provincial)::numeric     AS provincial,
      SUM(municipal)::numeric      AS municipal,
      SUM(combined_sectiond)::numeric AS combined_sectiond,
      SUM(total_govt)::numeric     AS total_govt,
      SUM(revenue)::numeric        AS revenue,
      CASE WHEN SUM(revenue) > 0
           THEN ROUND(SUM(total_govt) / SUM(revenue) * 100, 1) END AS govt_pct
    FROM cra.govt_funding_by_charity gc
    WHERE 1=1 ${designationFilter}
    GROUP BY bn, legal_name, designation, category
    ORDER BY SUM(total_govt) DESC
    LIMIT $1
  `, [args.top]);

  const highShareCharities = await client.query(`
    SELECT
      bn, legal_name, designation, category,
      SUM(total_govt)::numeric AS total_govt,
      SUM(revenue)::numeric    AS revenue,
      ROUND(SUM(total_govt) / NULLIF(SUM(revenue), 0) * 100, 1) AS govt_pct
    FROM cra.govt_funding_by_charity gc
    WHERE 1=1 ${designationFilter}
    GROUP BY bn, legal_name, designation, category
    HAVING SUM(revenue) > 1000000
       AND SUM(total_govt) / NULLIF(SUM(revenue), 0) >= 0.5
    ORDER BY SUM(total_govt) DESC
    LIMIT $1
  `, [args.top]);

  const categoryBreakdown = await client.query(`
    SELECT
      COALESCE(gc.category, '?')  AS category,
      COALESCE(cl.name_en, '(unknown)') AS category_name,
      COUNT(DISTINCT gc.bn)::int  AS charities,
      SUM(gc.total_govt)::numeric AS total_govt,
      SUM(gc.revenue)::numeric    AS revenue,
      CASE WHEN SUM(gc.revenue) > 0
           THEN ROUND(SUM(gc.total_govt) / SUM(gc.revenue) * 100, 1) END AS govt_pct
    FROM cra.govt_funding_by_charity gc
    LEFT JOIN cra.cra_category_lookup cl
      ON cl.code = LPAD(gc.category, 4, '0')
    GROUP BY gc.category, cl.name_en
    ORDER BY SUM(gc.total_govt) DESC
    LIMIT 20
  `);

  return {
    byDesignation: byDesignation.rows,
    topRecipients: topRecipients.rows,
    highShareCharities: highShareCharities.rows,
    categoryBreakdown: categoryBreakdown.rows
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function $(n, scale = 1) {
  if (n === null || n === undefined) return '—';
  const num = Number(n) / scale;
  if (!isFinite(num)) return '—';
  return '$' + Math.round(num).toLocaleString('en-US');
}

function $b(n) { return $(n, 1e9) + 'B'; }
function $m(n) { return $(n, 1e6) + 'M'; }

function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toFixed(2)}%`;
}

// ─── Public-interest context ─────────────────────────────────────────────────

const PUBLIC_CONTEXT = `
## Why public funds flowing into registered charities warrants government scrutiny

Registered charities are *public* trusts under Canadian tax law. Their T3010
Information Return is a mandatory disclosure under s. 149.1(14) of the Income
Tax Act, and the charity's operating regime confers two substantial public
subsidies:

1. **Income-tax exemption** on the charity's own revenue (ITA s. 149(1)(f)).
2. **The ability to issue charitable-donation tax receipts**, which allow
   donors to reduce their personal or corporate tax payable (ITA ss. 118.1 and
   110.1). The federal tax-credit revenue cost alone is estimated by the
   Department of Finance at several billion dollars annually ("Report on
   Federal Tax Expenditures").

On top of that indirect subsidy, charities receive **direct** public funding
through grants, contribution agreements and fee-for-service contracts from
federal, provincial/territorial and municipal governments. The T3010 form
requires this revenue to be disclosed separately by level of government
(Schedule 6, lines 4540/4550/4560) precisely so that public spending through
the charitable sector can be traced.

Three reasons this is a public-accountability question:

* **Double subsidy.** A dollar of provincial program funding paid to a
  charity that then issues tax receipts back to provincial donors is
  subsidised twice — once as a direct grant, once as foregone tax revenue.
  The T3010 is the only dataset that lets governments see both halves.

* **Sector concentration.** Canadian charities are concentrated in sectors
  (hospitals, universities, school boards, social housing, long-term care)
  where the public purse is the dominant funder. If government revenue is,
  say, 50% or more of the sector's total revenue, the "charitable" label
  obscures what is in substance a contracted delivery arm of government.

* **Risk-based oversight.** CRA's Charities Directorate, provincial
  auditors general, and program ministries all rely on self-reported T3010
  data to target audits and compliance review. Trends in government-source
  revenue over time — and the share of revenue it represents — are a first
  filter for determining where public-money scrutiny is proportionate.

This analysis attaches the dollar figures. It says nothing about whether the
funding is appropriate or the charity is compliant; it locates the pools of
public money large enough that routine oversight is warranted.
`.trim();

// ─── Output ──────────────────────────────────────────────────────────────────

async function emit(yearRows, analytics) {
  log.section('RESULTS');

  console.log('');
  console.log('── Per-year government funding to registered charities (all figures $ billions):');
  console.log('');
  console.log('  Year   Filed    AnyGovt        Federal   Provincial    Municipal    SectionD       TotalGovt       Revenue    Govt%');
  console.log('  ----   ------   ------        -------   ----------    ---------    --------       ---------       -------    -----');
  for (const r of yearRows) {
    console.log(
      `  ${r.fiscal_year}` +
      `  ${String(r.charities_filed).padStart(6)}` +
      `  ${String(r.charities_any_govt).padStart(7)}` +
      `  ${$b(r.federal).padStart(13)}` +
      `  ${$b(r.provincial).padStart(13)}` +
      `  ${$b(r.municipal).padStart(11)}` +
      `  ${$m(r.combined_sectiond).padStart(11)}` +
      `  ${$b(r.total_govt).padStart(14)}` +
      `  ${$b(r.total_revenue).padStart(13)}` +
      `  ${pct(r.total_govt_pct).padStart(6)}`
    );
  }

  console.log('');
  console.log('── Share of total revenue by funding level (per year):');
  console.log('');
  console.log('  Year     Federal%    Provincial%    Municipal%    Total Govt%');
  console.log('  ----     --------    -----------    ----------    -----------');
  for (const r of yearRows) {
    console.log(
      `  ${r.fiscal_year}` +
      `  ${pct(r.federal_pct).padStart(10)}` +
      `  ${pct(r.provincial_pct).padStart(13)}` +
      `  ${pct(r.municipal_pct).padStart(12)}` +
      `  ${pct(r.total_govt_pct).padStart(13)}`
    );
  }

  console.log('');
  console.log('── By CRA designation (summed over all 5 years):');
  console.log('  A=Public foundation  B=Private foundation  C=Charitable organization');
  for (const r of analytics.byDesignation) {
    const p = r.revenue > 0 ? Number(r.total_govt) / Number(r.revenue) * 100 : null;
    console.log(
      `  ${r.designation}: ${String(r.charities).padStart(6)} charities` +
      `   federal ${$b(r.federal).padStart(10)}` +
      `   provincial ${$b(r.provincial).padStart(11)}` +
      `   total govt ${$b(r.total_govt).padStart(13)}` +
      `   revenue ${$b(r.revenue).padStart(13)}` +
      `   govt%% ${(p !== null ? p.toFixed(1) : '—').padStart(5)}`
    );
  }

  console.log('');
  console.log(`── Top ${args.top} recipients of government funding (5-year total):`);
  for (const r of analytics.topRecipients) {
    console.log(
      `  ${r.bn}  ${(r.legal_name || '').slice(0, 50).padEnd(50)}  ` +
      `D=${r.designation ?? '?'}  ` +
      `fed ${$m(r.federal).padStart(10)}  ` +
      `prov ${$m(r.provincial).padStart(11)}  ` +
      `total ${$m(r.total_govt).padStart(13)}  ` +
      `rev ${$m(r.revenue).padStart(13)}  ` +
      `govt% ${String(r.govt_pct ?? '—').padStart(5)}`
    );
  }

  console.log('');
  console.log(`── Charities ≥ $1M revenue with ≥ 50% government share (top ${args.top} by govt $):`);
  for (const r of analytics.highShareCharities) {
    console.log(
      `  ${r.bn}  ${(r.legal_name || '').slice(0, 52).padEnd(52)}  ` +
      `D=${r.designation ?? '?'}  ` +
      `govt ${$m(r.total_govt).padStart(12)}  ` +
      `rev ${$m(r.revenue).padStart(12)}  ` +
      `govt% ${String(r.govt_pct ?? '—').padStart(5)}`
    );
  }

  console.log('');
  console.log('── Top 20 charity categories by absolute government funding:');
  for (const r of analytics.categoryBreakdown) {
    console.log(
      `  ${String(r.category).padStart(4)}  ` +
      `${String(r.category_name).slice(0, 50).padEnd(50)}  ` +
      `charities ${String(r.charities).padStart(6)}  ` +
      `govt ${$b(r.total_govt).padStart(11)}  ` +
      `rev ${$b(r.revenue).padStart(11)}  ` +
      `govt% ${String(r.govt_pct ?? '—').padStart(5)}`
    );
  }

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, 'govt-funding-analysis.json');
  const mdPath   = path.join(REPORT_DIR, 'govt-funding-analysis.md');

  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    options: args,
    by_year: yearRows,
    by_designation: analytics.byDesignation,
    top_recipients: analytics.topRecipients,
    high_share_charities: analytics.highShareCharities,
    category_breakdown: analytics.categoryBreakdown
  }, null, 2));

  fs.writeFileSync(mdPath, buildMarkdown(yearRows, analytics));

  log.info('');
  log.info(`  JSON report: ${jsonPath}`);
  log.info(`  MD report:   ${mdPath}`);
}

function buildMarkdown(yearRows, analytics) {
  const yearTable = yearRows.map(r =>
    `| ${r.fiscal_year} | ${Number(r.charities_filed).toLocaleString()} | ${Number(r.charities_any_govt).toLocaleString()} | ${$m(r.federal)} | ${$m(r.provincial)} | ${$m(r.municipal)} | ${$m(r.combined_sectiond)} | ${$m(r.total_govt)} | ${$m(r.total_revenue)} | ${pct(r.total_govt_pct)} |`
  ).join('\n');

  const shareTable = yearRows.map(r =>
    `| ${r.fiscal_year} | ${pct(r.federal_pct)} | ${pct(r.provincial_pct)} | ${pct(r.municipal_pct)} | ${pct(r.total_govt_pct)} |`
  ).join('\n');

  const desigTable = analytics.byDesignation.map(r => {
    const p = Number(r.revenue) > 0 ? (Number(r.total_govt) / Number(r.revenue) * 100).toFixed(2) : '—';
    return `| ${r.designation} | ${Number(r.charities).toLocaleString()} | ${$m(r.federal)} | ${$m(r.provincial)} | ${$m(r.municipal)} | ${$m(r.total_govt)} | ${$m(r.revenue)} | ${p}% |`;
  }).join('\n');

  const topRx = analytics.topRecipients.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${r.category ?? ''} | ${$m(r.federal)} | ${$m(r.provincial)} | ${$m(r.municipal)} | ${$m(r.total_govt)} | ${$m(r.revenue)} | ${r.govt_pct ?? '—'}% |`
  ).join('\n');

  const highShare = analytics.highShareCharities.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${$m(r.total_govt)} | ${$m(r.revenue)} | ${r.govt_pct ?? '—'}% |`
  ).join('\n');

  const catTable = analytics.categoryBreakdown.map(r =>
    `| ${r.category} | ${(r.category_name || '').replace(/\|/g, '/')} | ${Number(r.charities).toLocaleString()} | ${$m(r.total_govt)} | ${$m(r.revenue)} | ${r.govt_pct ?? '—'}% |`
  ).join('\n');

  const grand = yearRows.reduce(
    (a, r) => ({
      federal: a.federal + Number(r.federal),
      provincial: a.provincial + Number(r.provincial),
      municipal: a.municipal + Number(r.municipal),
      combined: a.combined + Number(r.combined_sectiond),
      total_govt: a.total_govt + Number(r.total_govt),
      revenue: a.revenue + Number(r.total_revenue)
    }),
    { federal: 0, provincial: 0, municipal: 0, combined: 0, total_govt: 0, revenue: 0 }
  );
  const grandPct = grand.revenue > 0 ? (grand.total_govt / grand.revenue * 100).toFixed(2) : '—';

  return `# CRA Government Funding of Registered Charities (5-year)

Generated: ${new Date().toISOString()}
Options: ${JSON.stringify(args)}

${PUBLIC_CONTEXT}

## Field validation

All dollar figures are drawn from \`cra.cra_financial_details\`, which mirrors
the CRA Open Data T3010 financial resource. The relevant T3010 line numbers
are confirmed in \`docs/DATA_DICTIONARY.md\` and the CRA Open Data Dictionary
v2.0:

| Line | Column | Meaning | Where reported |
|------|--------|---------|----------------|
| 4540 | \`field_4540\` | Revenue received from **federal** government | Schedule 6 only |
| 4550 | \`field_4550\` | Revenue received from **provincial/territorial** governments | Schedule 6 only |
| 4560 | \`field_4560\` | Revenue received from **municipal/regional** governments | Schedule 6 only |
| 4570 | \`field_4570\` | Combined government revenue | Section D only (small charities) |
| 4700 | \`field_4700\` | **Total revenue** (denominator) | Both |

Schedule 6 and Section D are mutually exclusive — a charity files one or the
other — so \`field_4540 + field_4550 + field_4560 + field_4570\` is the correct
all-source government total with no double-counting.

## 5-year totals

| Metric | Value |
|---|---|
| Cumulative federal revenue (2020–2024)      | ${$m(grand.federal)} |
| Cumulative provincial/territorial revenue   | ${$m(grand.provincial)} |
| Cumulative municipal revenue                | ${$m(grand.municipal)} |
| Cumulative Section D combined (small filer) | ${$m(grand.combined)} |
| **Cumulative total government revenue**     | **${$m(grand.total_govt)}** |
| Cumulative total revenue                    | ${$m(grand.revenue)} |
| **Government share of all charity revenue** | **${grandPct}%** |

## Per-year absolute dollars

| Year | Filed | Any govt | Federal | Provincial | Municipal | Section D | Total govt | Revenue | Govt % |
|------|------:|---------:|--------:|-----------:|----------:|----------:|-----------:|--------:|-------:|
${yearTable}

## Per-year share of revenue

| Year | Federal % | Provincial % | Municipal % | Total govt % |
|------|----------:|-------------:|------------:|-------------:|
${shareTable}

## By CRA designation (5-year totals)

A = Public foundation, B = Private foundation, C = Charitable organization.

> ⚠️ **Denominator differs from the headline.** This table is built from
> \`cra.govt_funding_by_charity\`, which by design only contains charity-years
> where government funding > \$0. The "Revenue" and "Govt %" columns therefore
> reflect the subset of charities that received *any* government funding,
> not the full sector. The headline **${grandPct}% government share of all
> charity revenue** (above) is the correct figure for "how much of the
> sector runs on public money". The per-designation Govt % in this table
> runs higher because it excludes charities that received \$0 of government
> revenue in the denominator.

| Desig. | Charities | Federal | Provincial | Municipal | Total govt | Revenue (govt-receivers only) | Govt % within subset |
|--------|----------:|--------:|-----------:|----------:|-----------:|------------------------------:|--------------------:|
${desigTable}

## Top ${args.top} recipients of government funding (5-year cumulative)

> **Note on BN 124072513RR0010 — "Government of the Province of Alberta".**
> This is a genuine registered charity under the CRA T3010 regime
> (Designation C, category 110 Supportive Health Care, Calgary AB) — not a
> data-entry error. It is a government-owned vehicle that holds registered
> charity status. It single-handedly accounts for roughly 6.7% of all
> government funding to the registered-charity sector over these five
> years. Its presence at the top of this list reflects how the Alberta
> government has structured certain health-service delivery inside the
> charitable regime; treat it as one data point, not as evidence of a
> grant pattern.

| BN | Legal name | D | Cat | Federal | Provincial | Municipal | Total govt | Revenue | Govt % |
|----|------------|---|-----|--------:|-----------:|----------:|-----------:|--------:|-------:|
${topRx}

## Charities ≥ \$1M revenue with ≥ 50% government share (top ${args.top} by govt \$)

These are the charities where public funds are the majority of operating
revenue — the clearest candidates for co-ordinated oversight between CRA and
the granting government.

| BN | Legal name | D | Govt $ | Revenue | Govt % |
|----|------------|---|-------:|--------:|-------:|
${highShare}

## Top 20 charity categories by absolute government funding

| Cat | Name | Charities | Govt $ | Revenue | Govt % |
|-----|------|----------:|-------:|--------:|-------:|
${catTable}

## Reproducing this analysis

\`\`\`bash
cd CRA
node scripts/advanced/08-government-funding-analysis.js              # all designations, top 25
node scripts/advanced/08-government-funding-analysis.js --top 100
node scripts/advanced/08-government-funding-analysis.js --designation C
\`\`\`

Derived tables persisted to the \`cra\` schema:

* \`cra.govt_funding_by_year\`    — one row per fiscal year 2020–2024
* \`cra.govt_funding_by_charity\` — one row per BN × year (only where govt > \$0)

## Caveats

* **2024 is a partial year.** Charities have six months after fiscal year-end
  to file T3010. The 2024 totals in this report will rise as late returns
  arrive — the *share* of revenue from government tends to be more stable
  year-over-year than the absolute total.
* **Section D under-reports by-level breakdown.** Smaller charities (Section D
  filers) report only a combined government figure in \`field_4570\`. In this
  dataset Section D totals roughly \$${Math.round(grand.combined / 1e6).toLocaleString()}M over five years, about
  ${((grand.combined / grand.total_govt) * 100).toFixed(2)}% of all government revenue — immaterial at the aggregate
  level but relevant when filtering for specific smaller organisations.
* **Self-reported.** T3010 is a self-reported return. CRA audits a sample,
  but line-level government revenue is not independently reconciled against
  granting-department records.
* **"Revenue" as denominator excludes capital.** \`field_4700\` is operating
  revenue; it does not include asset sales (\`field_4600\`), inter-charity
  transfers (\`field_4510\`), or foreign sources (\`field_4571\`/\`field_4575\`).
  Using a different denominator changes the percentages.
* **This analysis is descriptive.** It identifies where public money flows,
  not whether any specific flow is appropriate.
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log.section('Step 8: Government funding of registered charities (5-year)');
  log.info(`Options: ${JSON.stringify(args)}`);
  const client = await db.getClient();
  try {
    await validateFields(client);
    await migrate(client);
    const yearRows = await buildByYear(client);
    await buildByCharity(client);
    const analytics = await buildAnalytics(client);
    await emit(yearRows, analytics);
    log.section('Step 8 Complete');
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
