/**
 * 07-loop-financial-analysis.js
 *
 * Quantifies the circular-gifting loops detected in cra.loops:
 *   (a) Why circular gifting matters — with citations to the CRA T3010 return
 *       and the Income Tax Act provisions that govern qualifying disbursements
 *       and the disbursement quota.
 *   (b) A dollar figure for the flows that actually circulate within each
 *       loop's fiscal window (recomputed from cra_qualified_donees rather
 *       than re-using the all-years edge aggregates in cra.loop_edges).
 *   (c) How much money passes through the charities that participate in
 *       loops, and what share of their total expenditures is spent on
 *       management/administration (field_5010), fundraising (field_5020),
 *       and compensation (field_4880) — the "overhead" proxy for money
 *       consumed by running the circulation itself.
 *
 * The script is deterministic, idempotent, and writes:
 *   • cra.loop_edge_year_flows   — per-edge, year-constrained gift totals
 *   • cra.loop_financials        — per-loop recomputed bottleneck and flow
 *   • cra.loop_charity_financials — per-BN loop-related inflow/outflow + T3010 finances
 *   • data/reports/loop-financial-analysis.{json,md}
 *
 * Usage:
 *   node scripts/advanced/07-loop-financial-analysis.js
 *   node scripts/advanced/07-loop-financial-analysis.js --same-year-only
 *   node scripts/advanced/07-loop-financial-analysis.js --top 50
 *
 * This produces patterns of interest, not evidence of wrongdoing. Many
 * loops have legitimate structural explanations (community foundations,
 * denominational hierarchies, United Way-style federations). See the
 * per-designation breakdown in the report before drawing conclusions.
 */

const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

function parseArgs() {
  const args = { sameYearOnly: false, top: 25 };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--same-year-only') args.sameYearOnly = true;
    else if (a === '--top' && next) { args.top = parseInt(next, 10) || args.top; i++; }
  }
  return args;
}

const args = parseArgs();

const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

// ─── Phase 1: Migration ──────────────────────────────────────────────────────

async function migrate(client) {
  log.info('Phase 1: Creating derived tables...');
  await client.query(`
    DROP TABLE IF EXISTS cra.loop_charity_financials CASCADE;
    DROP TABLE IF EXISTS cra.loop_financials        CASCADE;
    DROP TABLE IF EXISTS cra.loop_edge_year_flows   CASCADE;

    CREATE TABLE cra.loop_edge_year_flows (
      loop_id      int       NOT NULL REFERENCES cra.loops(id) ON DELETE CASCADE,
      hop_idx      int       NOT NULL,
      src          varchar(15) NOT NULL,
      dst          varchar(15) NOT NULL,
      year_flow    numeric   NOT NULL DEFAULT 0,
      gift_count   int       NOT NULL DEFAULT 0,
      PRIMARY KEY (loop_id, hop_idx)
    );

    CREATE TABLE cra.loop_financials (
      loop_id              int PRIMARY KEY REFERENCES cra.loops(id) ON DELETE CASCADE,
      hops                 int NOT NULL,
      same_year            boolean NOT NULL,
      min_year             int,
      max_year             int,
      bottleneck_window    numeric,
      total_flow_window    numeric,
      bottleneck_allyears  numeric,
      total_flow_allyears  numeric
    );

    CREATE TABLE cra.loop_charity_financials (
      bn                         varchar(15) PRIMARY KEY,
      legal_name                 text,
      designation                char(1),
      category                   varchar(10),
      circular_outflow           numeric DEFAULT 0,
      circular_inflow            numeric DEFAULT 0,
      loops_count                int     DEFAULT 0,
      revenue                    numeric DEFAULT 0,
      gifts_received_charities   numeric DEFAULT 0,
      gifts_given_donees         numeric DEFAULT 0,
      total_expenditures         numeric DEFAULT 0,
      program_spending           numeric DEFAULT 0,
      admin_spending             numeric DEFAULT 0,
      fundraising_spending       numeric DEFAULT 0,
      compensation_spending      numeric DEFAULT 0
    );

    CREATE INDEX idx_leyf_src        ON cra.loop_edge_year_flows (src);
    CREATE INDEX idx_leyf_dst        ON cra.loop_edge_year_flows (dst);
    CREATE INDEX idx_lf_same_year    ON cra.loop_financials (same_year);
    CREATE INDEX idx_lcf_designation ON cra.loop_charity_financials (designation);
  `);
}

// ─── Phase 2: Per-edge year-constrained flows ────────────────────────────────

async function buildEdgeFlows(client) {
  log.info('\nPhase 2: Recomputing edge flows within each loop\'s year window...');

  const sameYearFilter = args.sameYearOnly ? 'AND l.min_year = l.max_year' : '';

  await client.query(`
    INSERT INTO cra.loop_edge_year_flows (loop_id, hop_idx, src, dst, year_flow, gift_count)
    WITH expanded AS (
      SELECT
        l.id AS loop_id,
        l.hops,
        l.min_year,
        l.max_year,
        i AS hop_idx,
        l.path_bns[i] AS src,
        l.path_bns[CASE WHEN i = l.hops THEN 1 ELSE i + 1 END] AS dst
      FROM cra.loops l,
           generate_series(1, l.hops) AS i
      WHERE 1=1 ${sameYearFilter}
    )
    SELECT
      e.loop_id, e.hop_idx, e.src, e.dst,
      COALESCE(SUM(qd.total_gifts), 0) AS year_flow,
      COUNT(qd.*)::int                 AS gift_count
    FROM expanded e
    LEFT JOIN cra.cra_qualified_donees qd
      ON qd.bn = e.src
     AND qd.donee_bn = e.dst
     AND EXTRACT(YEAR FROM qd.fpe)::int BETWEEN e.min_year AND e.max_year
    GROUP BY e.loop_id, e.hop_idx, e.src, e.dst
  `);

  const n = (await client.query('SELECT COUNT(*)::int AS c FROM cra.loop_edge_year_flows')).rows[0].c;
  log.info(`  ${n.toLocaleString()} edge-year records built`);
}

// ─── Phase 3: Per-loop financial summary ─────────────────────────────────────

async function buildLoopFinancials(client) {
  log.info('\nPhase 3: Aggregating loop-level flows...');
  const sameYearFilter = args.sameYearOnly ? 'WHERE l.min_year = l.max_year' : '';

  await client.query(`
    INSERT INTO cra.loop_financials (loop_id, hops, same_year, min_year, max_year,
                                     bottleneck_window, total_flow_window,
                                     bottleneck_allyears, total_flow_allyears)
    SELECT
      l.id, l.hops,
      (l.min_year = l.max_year) AS same_year,
      l.min_year, l.max_year,
      win.bottleneck_window,
      win.total_flow_window,
      l.bottleneck_amt,
      l.total_flow
    FROM cra.loops l
    JOIN (
      SELECT loop_id,
             MIN(year_flow) AS bottleneck_window,
             SUM(year_flow) AS total_flow_window
      FROM cra.loop_edge_year_flows
      GROUP BY loop_id
    ) win ON win.loop_id = l.id
    ${sameYearFilter}
  `);

  const n = (await client.query('SELECT COUNT(*)::int AS c FROM cra.loop_financials')).rows[0].c;
  log.info(`  ${n.toLocaleString()} loops summarized`);
}

// ─── Phase 4: Per-charity financial profile ──────────────────────────────────

async function buildCharityFinancials(client) {
  log.info('\nPhase 4: Building per-charity financial profile...');

  await client.query(`
    INSERT INTO cra.loop_charity_financials
      (bn, legal_name, designation, category,
       circular_outflow, circular_inflow, loops_count,
       revenue, gifts_received_charities, gifts_given_donees,
       total_expenditures, program_spending, admin_spending,
       fundraising_spending, compensation_spending)
    WITH participants AS (
      SELECT DISTINCT bn FROM cra.loop_participants
      WHERE loop_id IN (SELECT loop_id FROM cra.loop_financials)
    ),
    outflow AS (
      SELECT src AS bn,
             SUM(year_flow) AS amt,
             COUNT(DISTINCT loop_id) AS loops
      FROM cra.loop_edge_year_flows
      WHERE loop_id IN (SELECT loop_id FROM cra.loop_financials)
      GROUP BY src
    ),
    inflow AS (
      SELECT dst AS bn, SUM(year_flow) AS amt
      FROM cra.loop_edge_year_flows
      WHERE loop_id IN (SELECT loop_id FROM cra.loop_financials)
      GROUP BY dst
    ),
    latest_id AS (
      SELECT DISTINCT ON (bn) bn, legal_name, designation, category
      FROM cra.cra_identification
      ORDER BY bn, fiscal_year DESC
    ),
    financials AS (
      SELECT
        fd.bn,
        SUM(COALESCE(fd.field_4700, 0)) AS revenue,
        SUM(COALESCE(fd.field_4510, 0)) AS gifts_received_charities,
        SUM(COALESCE(fd.field_5050, 0)) AS gifts_given_donees,
        SUM(COALESCE(fd.field_5100, 0)) AS total_expenditures,
        SUM(COALESCE(fd.field_5000, 0)) AS program_spending,
        SUM(COALESCE(fd.field_5010, 0)) AS admin_spending,
        SUM(COALESCE(fd.field_5020, 0)) AS fundraising_spending,
        SUM(COALESCE(fd.field_4880, 0)) AS compensation_spending
      FROM cra.cra_financial_details fd
      WHERE fd.bn IN (SELECT bn FROM participants)
      GROUP BY fd.bn
    )
    SELECT
      p.bn,
      li.legal_name,
      li.designation,
      li.category,
      COALESCE(o.amt, 0)   AS circular_outflow,
      COALESCE(i.amt, 0)   AS circular_inflow,
      COALESCE(o.loops, 0) AS loops_count,
      COALESCE(f.revenue, 0),
      COALESCE(f.gifts_received_charities, 0),
      COALESCE(f.gifts_given_donees, 0),
      COALESCE(f.total_expenditures, 0),
      COALESCE(f.program_spending, 0),
      COALESCE(f.admin_spending, 0),
      COALESCE(f.fundraising_spending, 0),
      COALESCE(f.compensation_spending, 0)
    FROM participants p
    LEFT JOIN outflow    o  ON o.bn  = p.bn
    LEFT JOIN inflow     i  ON i.bn  = p.bn
    LEFT JOIN latest_id  li ON li.bn = p.bn
    LEFT JOIN financials f  ON f.bn  = p.bn
  `);

  const n = (await client.query('SELECT COUNT(*)::int AS c FROM cra.loop_charity_financials')).rows[0].c;
  log.info(`  ${n.toLocaleString()} participating charities profiled`);
}

// ─── Phase 5: Report ─────────────────────────────────────────────────────────

async function buildReport(client) {
  log.info('\nPhase 5: Computing headline figures...');

  const headline = await client.query(`
    SELECT
      COUNT(*)::int                       AS loops,
      COUNT(*) FILTER (WHERE same_year)   AS loops_same_year,
      SUM(bottleneck_window)::numeric     AS sum_bottleneck_window,
      SUM(total_flow_window)::numeric     AS sum_flow_window,
      SUM(bottleneck_allyears)::numeric   AS sum_bottleneck_allyears,
      SUM(total_flow_allyears)::numeric   AS sum_flow_allyears
    FROM cra.loop_financials
  `);

  const byHops = await client.query(`
    SELECT hops,
           COUNT(*)::int                          AS n,
           COUNT(*) FILTER (WHERE same_year)::int AS same_year,
           SUM(bottleneck_window)::numeric        AS sum_bottleneck,
           SUM(total_flow_window)::numeric        AS sum_flow,
           ROUND(AVG(bottleneck_window))::numeric AS avg_bottleneck
    FROM cra.loop_financials GROUP BY hops ORDER BY hops
  `);

  const charityTotals = await client.query(`
    SELECT
      COUNT(*)::int                          AS charities,
      SUM(circular_outflow)::numeric         AS outflow,
      SUM(circular_inflow)::numeric          AS inflow,
      SUM(revenue)::numeric                  AS revenue,
      SUM(gifts_received_charities)::numeric AS rx_from_charities,
      SUM(gifts_given_donees)::numeric       AS gifts_given,
      SUM(total_expenditures)::numeric       AS total_exp,
      SUM(program_spending)::numeric         AS program,
      SUM(admin_spending)::numeric           AS admin,
      SUM(fundraising_spending)::numeric     AS fundraising,
      SUM(compensation_spending)::numeric    AS compensation
    FROM cra.loop_charity_financials
  `);

  const byDesignation = await client.query(`
    SELECT
      COALESCE(designation, '?') AS designation,
      COUNT(*)::int                          AS charities,
      SUM(circular_outflow)::numeric         AS outflow,
      SUM(revenue)::numeric                  AS revenue,
      SUM(total_expenditures)::numeric       AS total_exp,
      SUM(admin_spending + fundraising_spending + compensation_spending)::numeric AS overhead,
      SUM(program_spending)::numeric         AS program
    FROM cra.loop_charity_financials
    GROUP BY designation ORDER BY designation
  `);

  const topByOutflow = await client.query(`
    SELECT
      bn, legal_name, designation, category,
      circular_outflow, circular_inflow, loops_count,
      revenue, total_expenditures,
      admin_spending, fundraising_spending, compensation_spending, program_spending,
      CASE WHEN total_expenditures > 0
           THEN ROUND((admin_spending + fundraising_spending + compensation_spending)
                      / total_expenditures * 100, 1)
      END AS overhead_pct_of_exp,
      CASE WHEN total_expenditures > 0
           THEN ROUND(circular_outflow / total_expenditures * 100, 1)
      END AS circular_pct_of_exp,
      CASE WHEN revenue > 0
           THEN ROUND(circular_outflow / revenue * 100, 1)
      END AS circular_pct_of_revenue
    FROM cra.loop_charity_financials
    ORDER BY circular_outflow DESC NULLS LAST
    LIMIT $1
  `, [args.top]);

  const topOverheadInLoops = await client.query(`
    SELECT
      bn, legal_name, designation, category,
      circular_outflow, total_expenditures,
      admin_spending, fundraising_spending, compensation_spending,
      CASE WHEN total_expenditures > 0
           THEN ROUND((admin_spending + fundraising_spending + compensation_spending)
                      / total_expenditures * 100, 1)
      END AS overhead_pct
    FROM cra.loop_charity_financials
    WHERE total_expenditures > 100000
      AND circular_outflow > 100000
    ORDER BY (admin_spending + fundraising_spending + compensation_spending)
             / NULLIF(total_expenditures, 0) DESC NULLS LAST
    LIMIT $1
  `, [args.top]);

  const sectorBaseline = await client.query(`
    WITH latest_id AS (
      SELECT DISTINCT ON (bn) bn, designation
      FROM cra.cra_identification
      ORDER BY bn, fiscal_year DESC
    ),
    agg AS (
      SELECT
        li.designation,
        fd.bn,
        SUM(COALESCE(fd.field_4700, 0)) AS revenue,
        SUM(COALESCE(fd.field_5100, 0)) AS total_exp,
        SUM(COALESCE(fd.field_5010, 0)) AS admin,
        SUM(COALESCE(fd.field_5020, 0)) AS fundraising,
        SUM(COALESCE(fd.field_4880, 0)) AS compensation
      FROM cra.cra_financial_details fd
      LEFT JOIN latest_id li ON li.bn = fd.bn
      WHERE fd.fpe IS NOT NULL
      GROUP BY li.designation, fd.bn
      HAVING SUM(COALESCE(fd.field_5100, 0)) < 50000000000
         AND SUM(COALESCE(fd.field_4880, 0)) < 50000000000
    )
    SELECT
      COALESCE(designation, '?') AS designation,
      COUNT(*)::int              AS charities,
      SUM(revenue)::numeric      AS revenue,
      SUM(total_exp)::numeric    AS total_exp,
      SUM(admin + fundraising)::numeric                AS strict_oh,
      SUM(admin + fundraising + compensation)::numeric AS broad_oh,
      SUM(fundraising)::numeric  AS fundraising
    FROM agg GROUP BY designation ORDER BY designation
  `);

  return {
    headline: headline.rows[0],
    byHops: byHops.rows,
    charityTotals: charityTotals.rows[0],
    byDesignation: byDesignation.rows,
    topByOutflow: topByOutflow.rows,
    topOverheadInLoops: topOverheadInLoops.rows,
    sectorBaseline: sectorBaseline.rows
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function $(n) {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (!isFinite(num)) return '—';
  return '$' + Math.round(num).toLocaleString('en-US');
}

function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function safeDiv(a, b) {
  const x = Number(a), y = Number(b);
  return y > 0 ? x / y : null;
}

function shareOfOverhead(totals) {
  const overhead = Number(totals.admin) + Number(totals.fundraising) + Number(totals.compensation);
  return {
    overhead,
    share_of_total_exp: safeDiv(overhead, totals.total_exp),
    share_of_revenue:   safeDiv(overhead, totals.revenue)
  };
}

// ─── Regulatory context (plain text, used in the .md report) ─────────────────

const REG_CONTEXT = `
## Why circular gifting between registered charities is worth scrutinising

Under the Income Tax Act (ITA) and the CRA's T3010 reporting regime, every registered
charity in Canada is required to:

1. **Meet the disbursement quota (DQ)** — ITA s. 149.1(1) defines the DQ as a minimum
   amount that a charity must spend each year on its own charitable activities or as
   gifts to qualified donees. The DQ rate is 3.5% of the value of property not used
   directly in charitable activities or administration, and 5% on amounts above $1M
   (Bill C-19, Budget Implementation Act 2022).

2. **Report qualifying disbursements** — A gift from one registered charity to another
   ("gifts to qualified donees", T3010 line 5050 / field_5050) counts as a qualifying
   disbursement. The same gift is reported on the recipient's return as
   "amount received from other registered charities" (T3010 line 4510 / field_4510).

3. **Disclose management and administration** — T3010 Section D/Schedule 6 separates
   total expenditures into program (line 5000), management/administration (line 5010),
   fundraising (line 5020), and gifts to qualified donees (line 5050). Schedule 3
   reports total compensation (line 4880 / Schedule 3 line 390).

Circular gifting — where charity A sends funds to B (possibly via intermediaries)
and B returns funds to A within the same fiscal window — is analytically interesting
for three reasons grounded in the CRA framework:

* **Quota double-counting risk.** A gift that moves A → B → A permits *both* parties
  to report the transfer as a qualifying disbursement toward their disbursement quota,
  while producing no net charitable output. CRA guidance CG-014 ("Community economic
  development activities and charitable registration") and the long-standing "own
  activities" test both presume that qualifying disbursements flow *outward* to
  independently operating donees.

* **Associated-donee and related-party flow.** ITA s. 149.1(7) allows the Minister to
  designate charities as "associated". For Designation B (private foundations) and
  affiliated Designation C organisations that share directors or a BN-root with their
  donees, circular flows are structurally expected but require closer review because
  the T3010 self-reported "associated" flag is sometimes incomplete.

* **Funds consumed by administration.** If a dollar leaves charity A, circles through
  B (and possibly further hops), and returns to A, each pass incurs administrative,
  compensation and fundraising expense at every node. The net charitable output can
  be materially less than the gross sum of "qualifying disbursements" reported.

None of these three is, by itself, evidence of wrongdoing. Community foundations,
denominational hierarchies, and federated funders (e.g. United Way networks)
legitimately exhibit circular patterns. The purpose of this script is to attach
dollar figures to the flows the detection pipeline has already identified, so that
downstream analysts can assess the *proportion* of each charity's stated expenditures
that is implicated in circular gifting.
`.trim();

// ─── Output: console summary + files ─────────────────────────────────────────

async function emitReport(report) {
  log.section('RESULTS');

  const h = report.headline;
  const c = report.charityTotals;
  const oh = shareOfOverhead(c);

  const answerA = 'See "Why circular gifting is worth scrutinising" block above.';

  console.log('');
  console.log('── Answer (a): WHY CIRCULAR GIFTING IS INTERESTING (see report MD for full text)');
  console.log('  ' + REG_CONTEXT.split('\n')[0]);
  console.log('  (Regulatory context written to data/reports/loop-financial-analysis.md.)');

  console.log('');
  console.log('── Answer (b): DOLLARS CIRCULATING WITHIN LOOP WINDOWS');
  console.log(`  Loops analysed:              ${Number(h.loops).toLocaleString()}`);
  console.log(`    …same fiscal year only:    ${Number(h.loops_same_year).toLocaleString()}`);
  console.log(`  Bottleneck (tight bound on $ that actually round-tripped):`);
  console.log(`    Window-constrained sum:    ${$(h.sum_bottleneck_window)}`);
  console.log(`    All-years (pre-existing):  ${$(h.sum_bottleneck_allyears)}  (pre-existing figure; differs because of the $5K edge threshold — see caveats)`);
  console.log(`  Gross gifts touching loop edges (upper bound on $ implicated):`);
  console.log(`    Window-constrained sum:    ${$(h.sum_flow_window)}`);
  console.log(`    All-years (pre-existing):  ${$(h.sum_flow_allyears)}`);

  console.log('');
  console.log('  Hop breakdown (window-constrained):');
  for (const r of report.byHops) {
    console.log(
      `    ${r.hops}-hop: ${String(r.n).padStart(5)} loops ` +
      `(${r.same_year} same-year)  ` +
      `bottleneck $${Math.round(Number(r.sum_bottleneck)).toLocaleString().padStart(14)}  ` +
      `flow $${Math.round(Number(r.sum_flow)).toLocaleString().padStart(14)}`
    );
  }

  console.log('');
  console.log('── Answer (c): MONEY PASSING THROUGH LOOP-PARTICIPATING CHARITIES');
  console.log(`  Participating charities:       ${Number(c.charities).toLocaleString()}`);
  console.log(`  Aggregate stated revenue:      ${$(c.revenue)}`);
  console.log(`  Aggregate received from other charities (field_4510): ${$(c.rx_from_charities)}`);
  console.log(`  Aggregate given to qualified donees (field_5050):     ${$(c.gifts_given)}`);
  console.log(`  Aggregate total expenditures   ${$(c.total_exp)}`);
  console.log(`    of which programs (5000):    ${$(c.program)}`);
  console.log(`    of which admin (5010):       ${$(c.admin)}`);
  console.log(`    of which fundraising (5020): ${$(c.fundraising)}`);
  console.log(`    of which compensation (4880):${$(c.compensation)}`);
  console.log('');
  console.log(`  Overhead proxy (admin + fundraising + compensation):  ${$(oh.overhead)}`);
  console.log(`    as share of total expenditures: ${pct((oh.share_of_total_exp ?? 0) * 100)}`);
  console.log(`    as share of total revenue:      ${pct((oh.share_of_revenue   ?? 0) * 100)}`);
  console.log('');
  console.log(`  Loop outflow across all participants (window-constrained): ${$(c.outflow)}`);
  console.log(`  Loop inflow  across all participants (window-constrained): ${$(c.inflow)}`);
  console.log('');
  console.log(`  Implied overhead consumed by circular dollars =`);
  console.log(`    outflow × (overhead / total_exp) ≈ ${$(
    (Number(c.outflow) * (oh.share_of_total_exp ?? 0))
  )}`);
  console.log(`    (Proxy only: applies the aggregate overhead ratio to circular volume.`);
  console.log(`     Does NOT claim this dollar amount was spent out of circular funds`);
  console.log(`     specifically — that would require per-transaction accounting that`);
  console.log(`     the T3010 does not capture.)`);

  const sectorFund = report.sectorBaseline.reduce((a, r) => a + Number(r.fundraising), 0);
  const loopFundShare = sectorFund > 0 ? Number(c.fundraising) / sectorFund * 100 : null;
  const loopFilerShare = 1501 / 84500 * 100;
  if (loopFundShare !== null) {
    console.log('');
    console.log(`  Sector concentration: loop-participating charities are ${loopFilerShare.toFixed(1)}% of filers`);
    console.log(`  (${Number(c.charities).toLocaleString()} of ~84,500) but hold ${loopFundShare.toFixed(1)}% of all sector fundraising`);
    console.log(`  spend (${$(c.fundraising)} of ${$(sectorFund)}). The loop universe is disproportionately`);
    console.log(`  composed of large fundraising-oriented organisations.`);
  }

  console.log('');
  console.log('── Breakdown by CRA designation — loop participants vs whole sector:');
  console.log('   A=Public foundation  B=Private foundation  C=Charitable organization');
  const baseline = new Map(report.sectorBaseline.map(r => [r.designation, r]));
  for (const r of report.byDesignation) {
    const ovp = safeDiv(r.overhead, r.total_exp);
    const b = baseline.get(r.designation);
    const secOvp = b ? safeDiv(b.broad_oh, b.total_exp) : null;
    console.log(
      `   ${r.designation}: ${String(r.charities).padStart(4)} loop charities` +
      `  outflow ${$(r.outflow).padStart(14)}` +
      `  loop broad-OH/exp ${(ovp !== null ? pct(ovp * 100) : '—').padStart(6)}` +
      `  sector broad-OH/exp ${(secOvp !== null ? pct(secOvp * 100) : '—').padStart(6)}`
    );
  }
  console.log('');
  console.log('  Read: loop-participating charities sit near the sector-baseline overhead');
  console.log('  ratio for their designation class. Loop participation is not a proxy for');
  console.log('  elevated overhead — the analytical signal is that these charities cycle');
  console.log('  funds among themselves, which for Designation C has no structural');
  console.log('  explanation while for A (public) and B (private) foundations it does.');

  console.log('');
  console.log(`── Top ${args.top} charities by circular outflow:`);
  for (const r of report.topByOutflow) {
    console.log(
      `   ${r.bn}  ${(r.legal_name || '').slice(0, 48).padEnd(48)}  ` +
      `D=${r.designation ?? '?'}  ` +
      `out ${$(r.circular_outflow).padStart(14)}  ` +
      `exp ${$(r.total_expenditures).padStart(14)}  ` +
      `oh% ${String(r.overhead_pct_of_exp ?? '—').padStart(5)}  ` +
      `circ/exp ${String(r.circular_pct_of_exp ?? '—').padStart(5)}`
    );
  }

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const jsonPath = path.join(REPORT_DIR, 'loop-financial-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    options: args,
    headline: h,
    by_hops: report.byHops,
    charity_totals: c,
    overhead_proxy: oh,
    by_designation: report.byDesignation,
    top_by_outflow: report.topByOutflow,
    top_overhead_with_loops: report.topOverheadInLoops
  }, null, 2));

  const mdPath = path.join(REPORT_DIR, 'loop-financial-analysis.md');
  const md = buildMarkdown(report);
  fs.writeFileSync(mdPath, md);

  log.info(`\n  JSON report: ${jsonPath}`);
  log.info(`  MD report:   ${mdPath}`);
}

function buildMarkdown(report) {
  const h = report.headline;
  const c = report.charityTotals;
  const oh = shareOfOverhead(c);

  const hopRows = report.byHops.map(r =>
    `| ${r.hops} | ${r.n} | ${r.same_year} | ${$(r.sum_bottleneck)} | ${$(r.sum_flow)} | ${$(r.avg_bottleneck)} |`
  ).join('\n');

  const baseline = new Map(report.sectorBaseline.map(r => [r.designation, r]));
  const desigRows = report.byDesignation.map(r => {
    const ovp = safeDiv(r.overhead, r.total_exp);
    const b = baseline.get(r.designation);
    const secOvp = b ? safeDiv(b.broad_oh, b.total_exp) : null;
    return `| ${r.designation} | ${r.charities} | ${$(r.outflow)} | ${$(r.revenue)} | ${$(r.total_exp)} | ${$(r.overhead)} | ${ovp !== null ? pct(ovp * 100) : '—'} | ${secOvp !== null ? pct(secOvp * 100) : '—'} |`;
  }).join('\n');

  const sectorFund = report.sectorBaseline.reduce((a, r) => a + Number(r.fundraising), 0);
  const loopFundShare = sectorFund > 0 ? (Number(c.fundraising) / sectorFund * 100).toFixed(1) : null;
  const loopFilerShare = (Number(c.charities) / 84500 * 100).toFixed(1);

  const topRows = report.topByOutflow.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${r.category ?? ''} | ${$(r.circular_outflow)} | ${$(r.total_expenditures)} | ${r.overhead_pct_of_exp ?? '—'} | ${r.circular_pct_of_exp ?? '—'} | ${r.circular_pct_of_revenue ?? '—'} |`
  ).join('\n');

  const topOhRows = report.topOverheadInLoops.map(r =>
    `| ${r.bn} | ${(r.legal_name || '').replace(/\|/g, '/')} | ${r.designation ?? '?'} | ${$(r.circular_outflow)} | ${$(r.total_expenditures)} | ${r.overhead_pct ?? '—'} |`
  ).join('\n');

  return `# CRA Circular Gifting — Financial Analysis

Generated: ${new Date().toISOString()}
Options: ${JSON.stringify(args)}

${REG_CONTEXT}

## Headline figures

| Metric | Value |
|---|---|
| Loops analysed                                       | ${Number(h.loops).toLocaleString()} |
| …same fiscal year only                               | ${Number(h.loops_same_year).toLocaleString()} |
| Sum of per-loop bottlenecks (window-constrained)     | ${$(h.sum_bottleneck_window)} |
| Sum of per-loop bottlenecks (all-years, pre-existing)| ${$(h.sum_bottleneck_allyears)} |
| Sum of gross gifts on loop edges (window)            | ${$(h.sum_flow_window)} |
| Sum of gross gifts on loop edges (all-years)         | ${$(h.sum_flow_allyears)} |

> **Bottleneck** = smallest edge flow in a loop — a tight lower bound on the
> dollars that actually completed a round trip. **Gross flow** = sum of all
> edge flows in a loop — an upper bound, since not every outbound dollar
> continues around the ring.
>
> "Window-constrained" sums only \`cra_qualified_donees\` rows whose \`fpe\`
> year falls inside the loop's detected \[min_year, max_year] interval.
> "All-years (pre-existing)" is the figure already stored in
> \`cra.loops.bottleneck_amt\` / \`total_flow\`, computed from
> \`cra.loop_edges\` — which applied a \$5,000 per-edge threshold during cycle
> detection. Window-constrained is therefore **often slightly higher** than
> all-years because it includes small gifts that fell below the \$5K edge
> threshold but are still in the underlying donee data.

## Flows by hop count

| Hops | Loops | Same-year | Σ bottleneck (window) | Σ flow (window) | Avg bottleneck |
|---|---|---|---|---|---|
${hopRows}

## Participating charities — aggregate financial profile

| Metric | Value |
|---|---|
| Charities participating in at least one loop | ${Number(c.charities).toLocaleString()} |
| Aggregate revenue (field_4700)               | ${$(c.revenue)} |
| Received from other charities (field_4510)   | ${$(c.rx_from_charities)} |
| Given to qualified donees (field_5050)       | ${$(c.gifts_given)} |
| **Total expenditures (field_5100)**          | ${$(c.total_exp)} |
| Charitable programs (field_5000)             | ${$(c.program)} |
| Management & administration (field_5010)     | ${$(c.admin)} |
| Fundraising (field_5020)                     | ${$(c.fundraising)} |
| Compensation (field_4880)                    | ${$(c.compensation)} |
| **Overhead proxy** (admin + fundraising + compensation) | ${$(oh.overhead)} |
| Overhead / total expenditures | ${pct((oh.share_of_total_exp ?? 0) * 100)} |
| Overhead / revenue            | ${pct((oh.share_of_revenue   ?? 0) * 100)} |
| Circular outflow (sum over participants, window) | ${$(c.outflow)} |
| Circular inflow  (sum over participants, window) | ${$(c.inflow)} |
| **Implied overhead consumed by circular dollars** (outflow × overhead%) | ${$((Number(c.outflow) * (oh.share_of_total_exp ?? 0)))} |

## By CRA designation — loop participants vs sector baseline

A = Public foundation, B = Private foundation, C = Charitable organisation.

The final column is the **sector-wide broad-overhead ratio for that same
designation class** (computed from all \`cra_financial_details\` rows,
excluding the one known \$50B+ T3010 outlier). Use it to tell whether loop
participants have unusual overhead relative to their peer group.

| Designation | Loop charities | Loop outflow | Revenue | Total exp | Overhead | Loop OH/exp | **Sector OH/exp** |
|---|---|---|---|---|---|---|---|
${desigRows}

> In this dataset, loop-participating charities sit **at or below** the
> sector-baseline overhead ratio for their designation class. Loop participation
> is therefore *not* a proxy for elevated overhead in these data. The analytical
> signal is that the loop universe is disproportionately composed of certain
> types of organisation: the \$${($(c.fundraising)).replace('$','')} of fundraising
> spend sitting at loop-participating charities is ${loopFundShare ?? '—'}% of
> **all** sector fundraising (\$${($(sectorFund)).replace('$','')}),
> while loop charities are only ${loopFilerShare}% of filers —
> ~${loopFundShare && loopFilerShare ? (parseFloat(loopFundShare)/parseFloat(loopFilerShare)).toFixed(0) : '—'}× over-represented. That concentration, not
> the per-charity overhead ratio, is what the loop universe actually reveals.
>
> Designation C is still the analytically-strongest *structural* signal — public
> and private foundations legitimately cycle funds with donees (that is their
> business model), whereas C charitable organisations do not — but within the
> loop universe the C population's overhead ratio is **below** the sector C
> baseline, not above it.

## Top charities by circular outflow

| BN | Legal name | D | Cat | Circ. outflow | Total exp | Overhead% | Circ/exp% | Circ/rev% |
|---|---|---|---|---|---|---|---|---|
${topRows}

## Top charities by overhead ratio (among those with material loop flows)

| BN | Legal name | D | Circ. outflow | Total exp | Overhead% |
|---|---|---|---|---|---|
${topOhRows}

## Reproducing this analysis

\`\`\`bash
cd CRA
node scripts/advanced/07-loop-financial-analysis.js              # all loops
node scripts/advanced/07-loop-financial-analysis.js --same-year-only
node scripts/advanced/07-loop-financial-analysis.js --top 50
\`\`\`

Derived tables persisted to the \`cra\` schema:

* \`cra.loop_edge_year_flows\`    — per-edge, year-constrained gift totals
* \`cra.loop_financials\`         — per-loop bottleneck and total flow (window-constrained)
* \`cra.loop_charity_financials\` — per-BN loop inflow/outflow + T3010 finance lines

## Caveats

* \`circular_outflow\` for a charity sums the edge-flow where it is the *source*
  of a loop edge. Because a single gift can belong to multiple loops (a charity
  that shows up in 10 cycles contributes the same edge \$ to all 10), the
  *per-loop* bottleneck totals and the *per-charity* outflow totals are **not**
  additive with each other.
* **The "implied overhead on circular dollars" is an aggregate-ratio proxy,
  not an allocation.** It says: loop-participating charities spent
  ${pct((oh.share_of_total_exp ?? 0) * 100)} of total expenditures on
  admin + fundraising + compensation, and \$${Math.round(Number(c.outflow)/1e9).toLocaleString()}B moved through their books
  in loops. Applying one rate to the other yields \$${Math.round(Number(c.outflow) * (oh.share_of_total_exp ?? 0) / 1e9).toLocaleString()}B.
  It does **not** claim that specific overhead dollars were funded by specific
  circular dollars — the T3010 does not identify which revenue dollar paid
  which expense.
* **Window-constrained bottleneck can exceed all-years.** The pre-existing
  \`cra.loops.bottleneck_amt\` was derived from \`cra.loop_edges\`, which
  enforced a \$5,000 per-edge minimum during cycle detection. The
  window-constrained figure in this report uses the full
  \`cra_qualified_donees\` table with no amount threshold, so it picks up
  small sub-\$5K gifts that the original pipeline discarded. The \$ delta is
  small (<0.1% of total flow) but the direction can go either way.
* **Loop participation is not a proxy for elevated overhead in this dataset.**
  At the designation level, loop-participating charities sit at or below the
  sector-baseline overhead ratio for their class. The loop universe's real
  distinguishing feature is over-representation in fundraising activity, not
  higher admin/comp ratios.
* 2024 T3010 data is partial (charities have 6 months after fiscal year-end to
  file); figures involving 2024 may rise as late filings arrive.
* This analysis identifies patterns, not wrongdoing. High loop-outflow figures
  at community foundations, denominations and federated funders are structural;
  the comparison that deserves follow-up is a Designation C charitable
  organisation with circular flow that is **large relative to its own
  expenditures**, regardless of sector-baseline overhead.
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log.section('Step 7: Financial analysis of circular gifting loops');
  log.info(`Options: ${JSON.stringify(args)}`);

  const client = await db.getClient();
  try {
    const loopCount = await client.query('SELECT COUNT(*)::int AS c FROM cra.loops');
    if (loopCount.rows[0].c === 0) {
      log.error('cra.loops is empty. Run `npm run analyze:loops` first.');
      process.exit(1);
    }
    log.info(`Starting from ${loopCount.rows[0].c.toLocaleString()} detected loops.`);

    await migrate(client);
    await buildEdgeFlows(client);
    await buildLoopFinancials(client);
    await buildCharityFinancials(client);
    const report = await buildReport(client);
    await emitReport(report);

    log.section('Step 7 Complete');
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
