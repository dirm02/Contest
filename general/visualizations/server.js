#!/usr/bin/env node
/**
 * visualizations/server.js — Dossier API server.
 *
 * Serves the dossier.html single-page app and exposes the API endpoints that
 * render a complete business overview for any entity in the golden-record
 * table. Runs on port 3801 by default so it can coexist with the pipeline
 * dashboard (3800).
 *
 * Endpoints:
 *   GET  /api/search?q=...               — find entities by name or BN
 *   GET  /api/entity/:id                 — full dossier (canonical, aliases,
 *                                           datasets, links, merge history,
 *                                           financial rollup)
 *   GET  /api/entity/:id/cra-years       — per-year T3010 detail: financials,
 *                                           directors, program areas, comp
 *   GET  /api/entity/:id/gifts-received  — qualified_donees where this entity
 *                                           is the DONEE (cross-charity gifts in)
 *   GET  /api/entity/:id/gifts-given     — qualified_donees where this entity
 *                                           is the DONOR (cross-charity gifts out)
 *   GET  /api/entity/:id/related         — candidate matches + splink partners
 *                                           that could be merged in-browser
 *   GET  /api/entity/:id/links           — every source link with its source
 *                                           record (join through fed/ab tables)
 *
 * Usage:
 *   npm run entities:dossier
 *   PORT=3801 node scripts/tools/dashboard.js  # dashboard on separate port
 */
const express = require('express');
const path = require('path');
const { pool } = require('../lib/db');

const PORT = parseInt(process.env.PORT || '3801', 10);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ────────────────────────────────────────────────────────────────────────────
// /api/search — find entities by name or BN.
// Ranks by: exact match > prefix > trigram similarity. Returns top 30.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    // Digits-only? search BN directly.
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 9) {
      const root = digits.slice(0, 9);
      const r = await pool.query(`
        SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources,
               array_length(e.alternate_names, 1) AS alias_count,
               (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = e.id) AS link_count
        FROM general.entities e
        WHERE e.bn_root = $1 AND e.merged_into IS NULL
        LIMIT 30
      `, [root]);
      return res.json({ results: r.rows, by: 'bn' });
    }

    const upper = q.toUpperCase();
    // Query rewritten to match the indexes in 03-migrate-entities.js:
    //   - idx_entities_active_name_trgm: partial GIN trgm on UPPER(canonical_name)
    //   - idx_entities_alt_names_trgm:   GIN trgm on UPPER(array_to_string(alternate_names, ' '))
    // The alternate_names-scan branch is now a single scalar LIKE on a
    // text expression (index-backed) instead of an EXISTS over unnest().
    // source_count is already materialized on the row by Phase 5, so we
    // skip the per-row entity_source_links subquery.
    const r = await pool.query(`
      SELECT e.id, e.canonical_name, e.bn_root, e.dataset_sources,
             array_length(e.alternate_names, 1) AS alias_count,
             COALESCE(e.source_count, 0) AS link_count,
             GREATEST(
               similarity(UPPER(e.canonical_name), $1),
               COALESCE((SELECT MAX(similarity(UPPER(n), $1))
                          FROM unnest(e.alternate_names) n), 0)
             ) AS score
      FROM general.entities e
      WHERE e.merged_into IS NULL
        AND (
          UPPER(e.canonical_name) LIKE '%' || $1 || '%'
          OR general.array_upper_join(e.alternate_names) LIKE '%' || $1 || '%'
          OR UPPER(e.canonical_name) % $1
        )
      ORDER BY score DESC NULLS LAST, e.id
      LIMIT 30
    `, [upper]);
    res.json({ results: r.rows, by: 'name' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id — full dossier
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'bad id' });

    const [ent, gr, links, merges] = await Promise.all([
      pool.query(`SELECT * FROM general.entities WHERE id = $1`, [id]),
      pool.query(`SELECT * FROM general.entity_golden_records WHERE id = $1`, [id]),
      pool.query(`
        SELECT source_schema, source_table, COUNT(*)::int AS c,
               array_agg(DISTINCT source_name) AS names
        FROM general.entity_source_links
        WHERE entity_id = $1
        GROUP BY source_schema, source_table
        ORDER BY source_schema, source_table
      `, [id]),
      pool.query(`
        SELECT m.absorbed_id, m.merge_method, m.merged_at, m.merged_by,
               m.links_redirected,
               ae.canonical_name AS absorbed_name,
               ae.bn_root AS absorbed_bn
        FROM general.entity_merges m
        JOIN general.entities ae ON ae.id = m.absorbed_id
        WHERE m.survivor_id = $1
        ORDER BY m.merged_at DESC
      `, [id]),
    ]);

    if (!ent.rows[0]) return res.status(404).json({ error: 'not found' });

    res.json({
      entity: ent.rows[0],
      golden: gr.rows[0] || null,
      links: links.rows,
      merge_history: merges.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/cra-years — per-year T3010 detail.
// Only has data if the entity has a BN root that matches CRA.
// Returns: [{ fiscal_year, fpe, identification, financials, directors[],
//             program_areas[], compensation, programs[] }, ...]
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/cra-years', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ years: [], bn: null });

    // Pull every year where CRA has data for this BN root. We key on
    // fpe (fiscal period end) which is consistent across sub-tables.
    const [ident, findet, fingen, dirs, comp, progs] = await Promise.all([
      pool.query(`
        SELECT bn, fiscal_year, legal_name, account_name, designation, category,
               sub_category, city, province, postal_code, registration_date
        FROM cra.cra_identification
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_4700 AS total_revenue,
               field_4500 AS revenue_receipted,
               field_4510 AS revenue_non_receipted,
               field_4530 AS revenue_other_charities,
               field_4540 AS revenue_government,
               field_4570 AS revenue_investment,
               field_4650 AS revenue_other,
               field_5100 AS total_expenditures,
               field_5000 AS program_spending,
               field_5050 AS gifts_to_donees,
               field_4200 AS assets,
               field_4250 AS liabilities,
               field_4020 AS cash
        FROM cra.cra_financial_details
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               program_area_1, program_area_2, program_area_3,
               program_percentage_1, program_percentage_2, program_percentage_3,
               field_1570, field_1600, field_1610, field_1620
        FROM cra.cra_financial_general
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               sequence_number, last_name, first_name, position, at_arms_length,
               start_date, end_date
        FROM cra.cra_directors
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, sequence_number
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr,
               field_300, field_305, field_310, field_315, field_320,
               field_325, field_330, field_335, field_340, field_345,
               field_370 AS total_fte, field_380 AS part_time, field_390 AS total_comp
        FROM cra.cra_compensation
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
      pool.query(`
        SELECT bn, fpe, EXTRACT(YEAR FROM fpe)::int AS yr, program_type, description
        FROM cra.cra_charitable_programs
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC
      `, [bn]),
    ]);

    // Group by year.
    const byYear = {};
    const add = (arr, key, row) => {
      const y = row.yr || (row.fiscal_year ? parseInt(row.fiscal_year, 10) : null);
      if (!y) return;
      if (!byYear[y]) byYear[y] = { year: y, directors: [], programs: [] };
      if (key === 'directors') byYear[y].directors.push(row);
      else if (key === 'programs') byYear[y].programs.push(row);
      else byYear[y][key] = row;
    };
    ident.rows.forEach(r => { byYear[r.fiscal_year] = byYear[r.fiscal_year] || { year: r.fiscal_year, directors: [], programs: [] }; byYear[r.fiscal_year].identification = r; });
    findet.rows.forEach(r => add(findet.rows, 'financials', r));
    fingen.rows.forEach(r => add(fingen.rows, 'program_areas', r));
    dirs.rows.forEach(r => add(dirs.rows, 'directors', r));
    comp.rows.forEach(r => add(comp.rows, 'compensation', r));
    progs.rows.forEach(r => add(progs.rows, 'programs', r));

    const years = Object.values(byYear).sort((a, b) => b.year - a.year);
    res.json({ years, bn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/gifts-received — other charities that gifted to this entity.
// Matches cra_qualified_donees where donee_bn ≈ this entity's BN.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/gifts-received', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ gifts: [], totals: {}, bn: null });

    const r = await pool.query(`
      SELECT qd.bn AS donor_bn,
             ci.legal_name AS donor_name,
             qd.donee_bn,
             qd.donee_name,
             EXTRACT(YEAR FROM qd.fpe)::int AS yr,
             qd.total_gifts,
             qd.gifts_in_kind,
             qd.associated
      FROM cra.cra_qualified_donees qd
      LEFT JOIN LATERAL (
        SELECT legal_name FROM cra.cra_identification ci2
        WHERE ci2.bn = qd.bn ORDER BY fiscal_year DESC LIMIT 1
      ) ci ON TRUE
      WHERE LEFT(qd.donee_bn, 9) = $1
      ORDER BY qd.fpe DESC, qd.total_gifts DESC NULLS LAST
    `, [bn]);

    const byYear = {};
    let total = 0;
    r.rows.forEach(g => {
      const y = g.yr;
      if (!y) return;
      if (!byYear[y]) byYear[y] = { year: y, total: 0, count: 0 };
      byYear[y].total += Number(g.total_gifts || 0);
      byYear[y].count++;
      total += Number(g.total_gifts || 0);
    });

    res.json({
      gifts: r.rows,
      by_year: Object.values(byYear).sort((a, b) => b.year - a.year),
      total,
      count: r.rows.length,
      distinct_donors: new Set(r.rows.map(x => x.donor_bn)).size,
      bn,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/gifts-given — this entity's own gifts to other charities
// (this entity appears as the donor in cra_qualified_donees).
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/gifts-given', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ gifts: [], totals: {}, bn: null });

    const r = await pool.query(`
      SELECT qd.donee_bn, qd.donee_name,
             EXTRACT(YEAR FROM qd.fpe)::int AS yr,
             SUM(qd.total_gifts) AS total_gifts,
             COUNT(*)::int AS count
      FROM cra.cra_qualified_donees qd
      WHERE LEFT(qd.bn, 9) = $1
      GROUP BY qd.donee_bn, qd.donee_name, EXTRACT(YEAR FROM qd.fpe)
      ORDER BY yr DESC, total_gifts DESC NULLS LAST
    `, [bn]);

    res.json({ gifts: r.rows, count: r.rows.length, bn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/related — potentially-same entities surfaced by the pipeline
// that weren't actually merged. Helps the analyst spot anything missed.
// Source: entity_merge_candidates with verdict != DIFFERENT, plus splink_predictions.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/related', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [candidatePairs, splinkPairs] = await Promise.all([
      pool.query(`
        SELECT
          CASE WHEN c.entity_id_a = $1 THEN c.entity_id_b ELSE c.entity_id_a END AS other_id,
          c.candidate_method, c.similarity_score, c.status,
          c.llm_verdict, c.llm_confidence, c.llm_reasoning,
          oth.canonical_name AS other_name, oth.bn_root AS other_bn,
          oth.dataset_sources AS other_ds,
          (SELECT COUNT(*)::int FROM general.entity_source_links WHERE entity_id = oth.id) AS other_link_count
        FROM general.entity_merge_candidates c
        JOIN general.entities oth ON oth.id = CASE WHEN c.entity_id_a = $1 THEN c.entity_id_b ELSE c.entity_id_a END
        WHERE ($1 IN (c.entity_id_a, c.entity_id_b))
          AND c.status IN ('related','uncertain','pending')
          AND oth.merged_into IS NULL
        ORDER BY c.similarity_score DESC NULLS LAST
        LIMIT 50
      `, [id]),
      // Splink predictions for source records linked to this entity, mapped to OTHER entities.
      pool.query(`
        WITH my_src AS (
          SELECT source_schema, source_table, source_pk, source_name
          FROM general.entity_source_links WHERE entity_id = $1
        )
        SELECT DISTINCT oth.id AS other_id, oth.canonical_name AS other_name,
               oth.bn_root AS other_bn, oth.dataset_sources AS other_ds,
               MAX(sp.match_probability) AS prob
        FROM general.splink_predictions sp
        JOIN general.entity_source_links esl
          ON (
            (sp.source_l = esl.source_schema || '.' || esl.source_table AND sp.record_l = esl.source_pk->>'id')
            OR (sp.source_r = esl.source_schema || '.' || esl.source_table AND sp.record_r = esl.source_pk->>'id')
          )
        JOIN general.entities oth ON oth.id = esl.entity_id
        WHERE sp.match_probability >= 0.50
          AND oth.id != $1
          AND oth.merged_into IS NULL
          AND EXISTS (
            SELECT 1 FROM my_src m
            WHERE (sp.source_l = m.source_schema || '.' || m.source_table OR sp.source_r = m.source_schema || '.' || m.source_table)
          )
        GROUP BY oth.id, oth.canonical_name, oth.bn_root, oth.dataset_sources
        ORDER BY prob DESC
        LIMIT 20
      `, [id]).catch(() => ({ rows: [] })),
    ]);

    res.json({
      candidates: candidatePairs.rows,
      splink: splinkPairs.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/funding-by-year — consolidated multi-source funding rollup.
// Combines CRA revenue/expenses, FED grant agreements, AB grants, AB contracts,
// AB sole-source into one per-year dataset for the funding chart.
//
// CRA uses bn_root to join. Non-CRA uses entity_source_links joined back to
// the source row.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/funding-by-year', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;

    const queries = [];

    // CRA revenue/expenditures
    if (bn) {
      queries.push(pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr,
               COALESCE(SUM(field_4700), 0)::float AS cra_revenue,
               COALESCE(SUM(field_5100), 0)::float AS cra_expenditures,
               COALESCE(SUM(field_5050), 0)::float AS cra_gifts_out,
               COALESCE(SUM(field_4530), 0)::float AS cra_gifts_in
        FROM cra.cra_financial_details
        WHERE LEFT(bn, 9) = $1
        GROUP BY EXTRACT(YEAR FROM fpe) ORDER BY yr
      `, [bn]));
    } else queries.push(Promise.resolve({ rows: [] }));

    // FED — bucket into Canadian federal fiscal year string "YYYY-YYYY".
    // FY runs April 1 → March 31. A grant starting 2023-10-01 is FY "2023-2024".
    // A grant starting 2024-02-15 is still FY "2023-2024" (the fiscal year
    // that ends 2024-03-31). This label format matches AB's display_fiscal_year.
    queries.push(pool.query(`
      SELECT
        CASE WHEN EXTRACT(MONTH FROM gc.agreement_start_date) >= 4
             THEN EXTRACT(YEAR FROM gc.agreement_start_date)::int || '-' ||
                  (EXTRACT(YEAR FROM gc.agreement_start_date)::int + 1)
             ELSE (EXTRACT(YEAR FROM gc.agreement_start_date)::int - 1) || '-' ||
                  EXTRACT(YEAR FROM gc.agreement_start_date)::int
        END AS fy,
        COALESCE(SUM(gc.agreement_value), 0)::float AS fed_total,
        COUNT(*)::int AS fed_count
      FROM general.entity_source_links sl
      JOIN fed.grants_contributions gc ON gc._id = (sl.source_pk->>'_id')::int
      WHERE sl.entity_id = $1
        AND sl.source_schema = 'fed'
        AND sl.source_table = 'grants_contributions'
        AND gc.is_amendment = false
        AND gc.agreement_start_date IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB grants — display_fiscal_year as-is, spaces stripped so "2023 - 2024"
    // becomes "2023-2024" (aligns with FED label format).
    queries.push(pool.query(`
      SELECT REPLACE(g.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(g.amount), 0)::float AS ab_grants_total,
             COUNT(*)::int AS ab_grants_count
      FROM general.entity_source_links sl
      JOIN ab.ab_grants g ON g.id = (sl.source_pk->>'id')::int
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_grants'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB contracts — same normalization.
    queries.push(pool.query(`
      SELECT REPLACE(c.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(c.amount), 0)::float AS ab_contracts_total,
             COUNT(*)::int AS ab_contracts_count
      FROM general.entity_source_links sl
      JOIN ab.ab_contracts c ON c.id = (sl.source_pk->>'id')::uuid
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_contracts'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    // AB sole-source — same normalization.
    queries.push(pool.query(`
      SELECT REPLACE(ss.display_fiscal_year, ' ', '') AS fy,
             COALESCE(SUM(ss.amount), 0)::float AS ab_ss_total,
             COUNT(*)::int AS ab_ss_count
      FROM general.entity_source_links sl
      JOIN ab.ab_sole_source ss ON ss.id = (sl.source_pk->>'id')::uuid
      WHERE sl.entity_id = $1 AND sl.source_schema = 'ab' AND sl.source_table = 'ab_sole_source'
      GROUP BY 1 ORDER BY 1
    `, [id]));

    const [cra, fed, abG, abC, abSS] = await Promise.all(queries);

    // Two separate outputs with native year formats preserved:
    //   - cra_calendar_years[]: integer calendar year from fpe
    //   - external_fiscal_years[]: "YYYY-YYYY" fiscal-year labels
    // NOT merged — CRA calendar years and government fiscal years are
    // different conceptual periods, so forcing them onto one axis would
    // be lossy. The dossier renders them as two charts.
    const craByYear = {};
    cra.rows.forEach(r => {
      craByYear[r.yr] = {
        year: r.yr,
        cra_revenue: Number(r.cra_revenue || 0),
        cra_expenditures: Number(r.cra_expenditures || 0),
        cra_gifts_in: Number(r.cra_gifts_in || 0),
        cra_gifts_out: Number(r.cra_gifts_out || 0),
      };
    });

    const fyByKey = {};
    const putFy = (fy, key, val) => {
      if (!fy) return;
      fyByKey[fy] = fyByKey[fy] || {
        fy, fed_grants: 0, ab_grants: 0, ab_contracts: 0, ab_sole_source: 0,
      };
      fyByKey[fy][key] += Number(val || 0);
    };
    fed.rows.forEach(r => putFy(r.fy,  'fed_grants',      r.fed_total));
    abG.rows.forEach(r => putFy(r.fy,  'ab_grants',       r.ab_grants_total));
    abC.rows.forEach(r => putFy(r.fy,  'ab_contracts',    r.ab_contracts_total));
    abSS.rows.forEach(r => putFy(r.fy, 'ab_sole_source',  r.ab_ss_total));

    res.json({
      bn,
      cra_calendar_years: Object.values(craByYear).sort((a, b) => a.year - b.year),
      external_fiscal_years: Object.values(fyByKey).sort((a, b) => a.fy.localeCompare(b.fy)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/accountability — overhead ratios, government funding
// breakdown, T3010 data-quality violations, loop-network participation.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/accountability', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ bn: null });

    const [overhead, govtFunding, sanity, arith, imposs, loops, hub, names] = await Promise.all([
      pool.query(`
        SELECT fiscal_year, revenue, total_expenditures, compensation,
               administration, fundraising, programs,
               strict_overhead_pct, broad_overhead_pct, outlier_flag
        FROM cra.overhead_by_charity
        WHERE bn = $1 ORDER BY fiscal_year DESC
      `, [bn + 'RR0001']).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, federal, provincial, municipal, combined_sectiond,
               total_govt, revenue, govt_share_of_rev
        FROM cra.govt_funding_by_charity
        WHERE bn = $1 ORDER BY fiscal_year DESC
      `, [bn + 'RR0001']).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, details, severity
        FROM cra.t3010_sanity_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, rule_family, details, severity
        FROM cra.t3010_arithmetic_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT fiscal_year, rule_code, sub_rule, details, severity
        FROM cra.t3010_impossibility_violations
        WHERE LEFT(bn, 9) = $1 ORDER BY fiscal_year DESC, severity DESC LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT lu.bn, lu.total_loops, lu.loops_2hop, lu.loops_3hop,
               lu.loops_4hop, lu.loops_5hop, lu.loops_6hop
        FROM cra.loop_universe lu
        WHERE LEFT(lu.bn, 9) = $1
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT hub_type, in_degree, out_degree, total_degree,
               total_inflow, total_outflow, scc_id
        FROM cra.identified_hubs
        WHERE LEFT(bn, 9) = $1 LIMIT 1
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT legal_name, account_name, first_year, last_year, years_present
        FROM cra.identification_name_history
        WHERE LEFT(bn, 9) = $1 ORDER BY first_year DESC
      `, [bn]).catch(() => ({ rows: [] })),
    ]);

    res.json({
      bn,
      overhead: overhead.rows,
      govt_funding: govtFunding.rows,
      violations: {
        sanity: sanity.rows,
        arithmetic: arith.rows,
        impossibility: imposs.rows,
      },
      loop_universe: loops.rows[0] || null,
      hub: hub.rows[0] || null,
      name_history: names.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /api/entity/:id/international — money and activities outside Canada.
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/entity/:id/international', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ent = await pool.query(`SELECT bn_root FROM general.entities WHERE id = $1`, [id]);
    const bn = ent.rows[0]?.bn_root;
    if (!bn) return res.json({ bn: null });

    const [countries, resources, exports, nonQualified] = await Promise.all([
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, country, COUNT(*)::int AS c
        FROM cra.cra_activities_outside_countries
        WHERE LEFT(bn, 9) = $1 GROUP BY EXTRACT(YEAR FROM fpe), country ORDER BY yr DESC, c DESC
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, individual_org_name, amount, country
        FROM cra.cra_resources_sent_outside
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, amount DESC NULLS LAST LIMIT 100
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, item_name, item_value, destination, country
        FROM cra.cra_exported_goods
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, item_value DESC NULLS LAST LIMIT 50
      `, [bn]).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT EXTRACT(YEAR FROM fpe)::int AS yr, recipient_name, purpose, cash_amount, non_cash_amount
        FROM cra.cra_non_qualified_donees
        WHERE LEFT(bn, 9) = $1 ORDER BY fpe DESC, cash_amount DESC NULLS LAST LIMIT 100
      `, [bn]).catch(() => ({ rows: [] })),
    ]);

    res.json({
      bn,
      countries: countries.rows,
      resources_sent: resources.rows,
      exported_goods: exports.rows,
      non_qualified_donees: nonQualified.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Index → dossier.html
// ────────────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dossier.html')));

app.listen(PORT, () => {
  console.log(`[dossier] http://localhost:${PORT}`);
});
