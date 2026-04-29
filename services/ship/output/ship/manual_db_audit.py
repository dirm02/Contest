"""Independent manual database audit for the shipped recipe paths."""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

from output.ship.primitives.base import create_pool, json_ready, rows_to_dicts
from output.ship.recipes.catalog import RECIPES, coerce_params
from output.ship.verify import _verify_url


AUDIT_CASES: list[dict[str, Any]] = [
    {
        "recipe_id": "funding_loops",
        "question": "What loops exist between Alberta charities?",
        "params": {"top_n": 5, "min_total_amount": 1000, "exclude_denominational": False},
    },
    {
        "recipe_id": "zombie_recipients",
        "question": "Which charities had government funding above 70% of revenue and stopped filing?",
        "params": {"top_n": 5, "min_govt_share": 0.7, "min_total_funding": 500000, "last_filed_before": 2024},
    },
    {
        "recipe_id": "ghost_capacity",
        "question": "Which charities have high overhead but no staff?",
        "params": {"top_n": 5, "min_overhead_pct": 0.7, "fiscal_year_min": 2023},
    },
    {
        "recipe_id": "duplicative_funding",
        "question": "Which organizations receive both federal and Alberta funding?",
        "params": {"top_n": 5, "min_source_count": 2},
    },
    {
        "recipe_id": "vendor_concentration",
        "question": "How concentrated is public spending across suppliers?",
        "params": {"top_n": 5, "source": "all", "min_segment_amount": 100000},
    },
    {
        "recipe_id": "sole_source_amendment",
        "question": "Show the largest sole-source contract concentration.",
        "params": {"top_n": 5, "min_segment_amount": 50000},
    },
    {
        "recipe_id": "contract_intelligence",
        "question": "What contract spending patterns stand out?",
        "params": {"top_n": 5},
    },
    {
        "recipe_id": "related_parties",
        "question": "Are there directors who sit on multiple funded charity boards?",
        "params": {"top_n": 5, "min_orgs_per_director": 3, "fiscal_year_min": 2024},
    },
    {
        "recipe_id": "policy_misalignment",
        "question": "What policy-spending coverage is visible over time?",
        "params": {"top_n": 5},
    },
    {
        "recipe_id": "adverse_media",
        "question": "Are large funded recipients linked to regulator or audit records?",
        "params": {"top_n": 1, "web_candidates": 1},
    },
]


def _status(checks: list[dict[str, Any]]) -> str:
    if any(check["status"] == "fail" for check in checks):
        return "fail"
    if any(check["status"] == "warn" for check in checks):
        return "warn"
    return "pass"


def _ok(name: str, details: str, *, recipe_value: Any = None, manual_value: Any = None) -> dict[str, Any]:
    return {"name": name, "status": "pass", "details": details, "recipe_value": recipe_value, "manual_value": manual_value}


def _fail(name: str, details: str, *, recipe_value: Any = None, manual_value: Any = None) -> dict[str, Any]:
    return {"name": name, "status": "fail", "details": details, "recipe_value": recipe_value, "manual_value": manual_value}


def _warn(name: str, details: str, *, recipe_value: Any = None, manual_value: Any = None) -> dict[str, Any]:
    return {"name": name, "status": "warn", "details": details, "recipe_value": recipe_value, "manual_value": manual_value}


def _near(left: Any, right: Any, rel_tol: float = 0.005, abs_tol: float = 0.01) -> bool:
    if left is None or right is None:
        return left == right
    if isinstance(left, int) and isinstance(right, int):
        return left == right
    lval = float(left)
    rval = float(right)
    return abs(lval - rval) <= max(abs(rval) * rel_tol, abs_tol)


async def _fetch(pool: asyncpg.Pool, sql: str, *params: Any) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        async with conn.transaction(readonly=True):
            await conn.execute("SET LOCAL statement_timeout = 30000")
            rows = await conn.fetch(sql, *params)
    return rows_to_dicts(rows)


async def _run_recipe(recipe_id: str, question: str, params: dict[str, Any], pool: asyncpg.Pool) -> dict[str, Any]:
    spec = RECIPES[recipe_id]
    typed_params = coerce_params(recipe_id, params)
    started = time.perf_counter()
    result = await spec.run(question, typed_params, pool)
    return {
        "recipe_id": recipe_id,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "result": result.model_dump(mode="json"),
    }


async def _manual_funding_loops(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    first = (result["findings"] or [None])[0]
    if not first:
        return [_fail("non_empty", "Recipe returned no funding-loop rows.")]
    rows = await _fetch(
        pool,
        """
        SELECT id AS cycle_id, hops, path_display, bottleneck_amt, total_flow, min_year, max_year
        FROM cra.johnson_cycles
        WHERE id = $1
        """,
        first["cycle_id"],
    )
    if not rows:
        return [_fail("cycle_exists", "Manual query could not find recipe cycle_id.", recipe_value=first["cycle_id"])]
    manual = rows[0]
    checks.append(_ok("cycle_exists", "Recipe cycle_id exists in cra.johnson_cycles.", recipe_value=first["cycle_id"], manual_value=manual["cycle_id"]))
    for key in ("hops", "total_flow", "bottleneck_amt", "min_year", "max_year"):
        checks.append(_ok(key, f"{key} matches manual cycle row.", recipe_value=first[key], manual_value=manual[key]) if _near(first[key], manual[key]) else _fail(key, f"{key} differs from manual cycle row.", recipe_value=first[key], manual_value=manual[key]))
    return checks


async def _manual_zombie(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    first = (result["findings"] or [None])[0]
    if not first:
        return [_fail("non_empty", "Recipe returned no zombie-recipient rows.")]
    rows = await _fetch(
        pool,
        """
        WITH govt AS (
            SELECT bn, sum(total_govt)::numeric AS total_government_funding,
                   sum(revenue)::numeric AS total_revenue,
                   sum(total_govt)::numeric / nullif(sum(revenue), 0) AS govt_share
            FROM cra.govt_funding_by_charity
            WHERE bn = $1
            GROUP BY bn
        ),
        latest AS (
            SELECT bn, max(fiscal_year)::int AS latest_filing_year
            FROM cra.cra_identification
            WHERE bn = $1
            GROUP BY bn
        )
        SELECT g.*, l.latest_filing_year
        FROM govt g
        JOIN latest l USING (bn)
        """,
        first["bn"],
    )
    if not rows:
        return [_fail("bn_exists", "Manual query could not find recipe BN.", recipe_value=first["bn"])]
    manual = rows[0]
    checks.append(_ok("bn_exists", "Recipe BN exists in CRA government funding and identification tables.", recipe_value=first["bn"], manual_value=manual["bn"]))
    for key in ("total_government_funding", "total_revenue", "govt_share", "latest_filing_year"):
        checks.append(_ok(key, f"{key} matches manual CRA rollup.", recipe_value=first[key], manual_value=manual[key]) if _near(first[key], manual[key]) else _fail(key, f"{key} differs from manual CRA rollup.", recipe_value=first[key], manual_value=manual[key]))
    return checks


async def _manual_ghost(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    first = (result["findings"] or [None])[0]
    if not first:
        return [_fail("non_empty", "Recipe returned no ghost-capacity rows.")]
    rows = await _fetch(
        pool,
        """
        WITH selected_overhead AS (
            SELECT *
            FROM cra.overhead_by_charity
            WHERE bn = $1
              AND fiscal_year = $2::int
        ),
        latest_comp AS (
            SELECT DISTINCT ON (bn)
                bn,
                coalesce(field_300, 0) + coalesce(field_305, 0) + coalesce(field_310, 0) + coalesce(field_315, 0) +
                coalesce(field_320, 0) + coalesce(field_325, 0) + coalesce(field_330, 0) + coalesce(field_335, 0) +
                coalesce(field_340, 0) + coalesce(field_345, 0) AS reported_compensated_staff
            FROM cra.cra_compensation
            WHERE bn = $1
            ORDER BY bn, fpe DESC
        )
        SELECT o.bn, o.fiscal_year, o.broad_overhead_pct, coalesce(c.reported_compensated_staff, 0)::int AS reported_compensated_staff
        FROM selected_overhead o
        LEFT JOIN latest_comp c USING (bn)
        """,
        first["bn"],
        first["fiscal_year"],
    )
    if not rows:
        return [_fail("bn_exists", "Manual query could not find recipe BN.", recipe_value=first["bn"])]
    manual = rows[0]
    checks = [_ok("bn_exists", "Recipe BN exists in overhead table.", recipe_value=first["bn"], manual_value=manual["bn"])]
    for key in ("fiscal_year", "broad_overhead_pct", "reported_compensated_staff"):
        checks.append(_ok(key, f"{key} matches latest manual overhead/compensation row.", recipe_value=first[key], manual_value=manual[key]) if _near(first[key], manual[key]) else _fail(key, f"{key} differs from manual overhead/compensation row.", recipe_value=first[key], manual_value=manual[key]))
    return checks


async def _manual_duplicative(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    first = (result["findings"] or [None])[0]
    if not first:
        return [_fail("non_empty", "Recipe returned no duplicative-funding rows.")]
    rows = await _fetch(
        pool,
        """
        SELECT entity_id, canonical_name, total_all_funding,
               ((fed_total_grants > 0)::int + (ab_total_grants > 0)::int + (ab_total_contracts > 0)::int + (ab_total_sole_source > 0)::int + (cra_total_revenue > 0)::int) AS positive_funding_source_count
        FROM general.vw_entity_funding
        WHERE entity_id = $1
        """,
        first["entity_id"],
    )
    if not rows:
        return [_fail("entity_exists", "Manual query could not find entity in funding view.", recipe_value=first["entity_id"])]
    manual = rows[0]
    checks = [_ok("entity_exists", "Recipe entity exists in general.vw_entity_funding.", recipe_value=first["entity_id"], manual_value=manual["entity_id"])]
    for key in ("canonical_name", "total_all_funding", "positive_funding_source_count"):
        matches = first[key] == manual[key] if isinstance(first[key], str) else _near(first[key], manual[key])
        checks.append(_ok(key, f"{key} matches manual funding-view row.", recipe_value=first[key], manual_value=manual[key]) if matches else _fail(key, f"{key} differs from manual funding-view row.", recipe_value=first[key], manual_value=manual[key]))
    return checks


async def _manual_concentration_row(pool: asyncpg.Pool, row: dict[str, Any]) -> list[dict[str, Any]]:
    source_table = row["source_table"]
    if source_table == "ab.ab_contracts":
        manual = await _fetch(
            pool,
            """
            WITH segment AS (
                SELECT regexp_replace(btrim(recipient), '\\s+', ' ', 'g') AS supplier_name, amount::numeric AS amount
                FROM ab.ab_contracts
                WHERE coalesce(nullif(btrim(ministry), ''), 'unknown') = $1
                  AND coalesce(nullif(btrim(display_fiscal_year), ''), 'unknown') = $2
                  AND recipient IS NOT NULL AND btrim(recipient) <> ''
                  AND amount IS NOT NULL AND amount > 0
            )
            SELECT sum(amount)::numeric AS segment_total_amount,
                   sum(amount) FILTER (WHERE supplier_name = $3)::numeric AS supplier_amount,
                   count(DISTINCT supplier_name)::int AS supplier_count,
                   count(*) FILTER (WHERE supplier_name = $3)::int AS award_count
            FROM segment
            """,
            row["segment_owner"],
            row["fiscal_year"],
            row["supplier_name"],
        )
    elif source_table == "ab.ab_sole_source":
        manual = await _fetch(
            pool,
            """
            WITH segment AS (
                SELECT regexp_replace(btrim(vendor), '\\s+', ' ', 'g') AS supplier_name, amount::numeric AS amount
                FROM ab.ab_sole_source
                WHERE coalesce(nullif(btrim(ministry), ''), 'unknown') = $1
                  AND coalesce(nullif(btrim(display_fiscal_year), ''), 'unknown') = $2
                  AND vendor IS NOT NULL AND btrim(vendor) <> ''
                  AND amount IS NOT NULL AND amount > 0
            )
            SELECT sum(amount)::numeric AS segment_total_amount,
                   sum(amount) FILTER (WHERE supplier_name = $3)::numeric AS supplier_amount,
                   count(DISTINCT supplier_name)::int AS supplier_count,
                   count(*) FILTER (WHERE supplier_name = $3)::int AS award_count
            FROM segment
            """,
            row["segment_owner"],
            row["fiscal_year"],
            row["supplier_name"],
        )
    elif source_table == "fed.grants_contributions":
        manual = await _fetch(
            pool,
            """
            WITH segment AS (
                SELECT regexp_replace(btrim(recipient_legal_name), '\\s+', ' ', 'g') AS supplier_name, agreement_value::numeric AS amount
                FROM fed.grants_contributions
                WHERE coalesce(nullif(btrim(owner_org_title), ''), nullif(btrim(owner_org), ''), 'unknown') = $1
                  AND coalesce(extract(year from agreement_start_date)::int::text, 'unknown') = $2
                  AND recipient_legal_name IS NOT NULL AND btrim(recipient_legal_name) <> ''
                  AND agreement_value IS NOT NULL AND agreement_value > 0
                  AND agreement_start_date >= date '1900-01-01'
            )
            SELECT sum(amount)::numeric AS segment_total_amount,
                   sum(amount) FILTER (WHERE supplier_name = $3)::numeric AS supplier_amount,
                   count(DISTINCT supplier_name)::int AS supplier_count,
                   count(*) FILTER (WHERE supplier_name = $3)::int AS award_count
            FROM segment
            """,
            row["segment_owner"],
            row["fiscal_year"],
            row["supplier_name"],
        )
    else:
        return [_warn("source_table", "Manual concentration check does not cover this source_table.", recipe_value=source_table)]
    if not manual:
        return [_fail("manual_segment", "Manual segment query returned no row.")]
    mrow = manual[0]
    checks = []
    for key in ("segment_total_amount", "supplier_amount", "supplier_count", "award_count"):
        checks.append(_ok(key, f"{key} matches manual segment aggregation.", recipe_value=row[key], manual_value=mrow[key]) if _near(row[key], mrow[key]) else _fail(key, f"{key} differs from manual segment aggregation.", recipe_value=row[key], manual_value=mrow[key]))
    return checks


async def _manual_incumbency(pool: asyncpg.Pool, row: dict[str, Any]) -> list[dict[str, Any]]:
    source = row["source_table"]
    if source == "ab.ab_sole_source":
        manual = await _fetch(
            pool,
            """
            WITH annual AS (
                SELECT coalesce(nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int, extract(year from start_date)::int) AS period_year,
                       count(*)::int AS annual_award_count,
                       sum(amount)::numeric AS annual_amount
                FROM ab.ab_sole_source
                WHERE coalesce(nullif(btrim(ministry), ''), 'unknown') = $1
                  AND regexp_replace(btrim(vendor), '\\s+', ' ', 'g') = $2
                  AND amount IS NOT NULL AND amount > 0
                GROUP BY period_year
            )
            SELECT count(*)::int AS supplier_year_count,
                   min(period_year)::int AS first_year,
                   max(period_year)::int AS latest_year,
                   (max(period_year) - min(period_year) + 1)::int AS incumbency_window_years,
                   sum(annual_award_count)::int AS award_count_window,
                   sum(annual_amount)::numeric AS total_amount_window
            FROM annual
            WHERE period_year IS NOT NULL
            """,
            row["ministry"],
            row["supplier_name"],
        )
    else:
        manual = await _fetch(
            pool,
            """
            WITH annual AS (
                SELECT nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int AS period_year,
                       count(*)::int AS annual_award_count,
                       sum(amount)::numeric AS annual_amount
                FROM ab.ab_contracts
                WHERE coalesce(nullif(btrim(ministry), ''), 'unknown') = $1
                  AND regexp_replace(btrim(recipient), '\\s+', ' ', 'g') = $2
                  AND amount IS NOT NULL AND amount > 0
                GROUP BY period_year
            )
            SELECT count(*)::int AS supplier_year_count,
                   min(period_year)::int AS first_year,
                   max(period_year)::int AS latest_year,
                   (max(period_year) - min(period_year) + 1)::int AS incumbency_window_years,
                   sum(annual_award_count)::int AS award_count_window,
                   sum(annual_amount)::numeric AS total_amount_window
            FROM annual
            WHERE period_year IS NOT NULL
            """,
            row["ministry"],
            row["supplier_name"],
        )
    mrow = manual[0]
    checks = []
    for key in ("supplier_year_count", "first_year", "latest_year", "incumbency_window_years", "award_count_window", "total_amount_window"):
        checks.append(_ok(key, f"{key} matches manual incumbency aggregation.", recipe_value=row[key], manual_value=mrow[key]) if _near(row[key], mrow[key]) else _fail(key, f"{key} differs from manual incumbency aggregation.", recipe_value=row[key], manual_value=mrow[key]))
    return checks


async def _manual_vendor(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    concentration_rows = [row for row in result["findings"] if row.get("source_table")]
    checks = await _manual_concentration_row(pool, concentration_rows[0]) if concentration_rows else [_fail("concentration_non_empty", "No concentration rows.")]
    incumbency_rows = [row for row in result["findings"] if row.get("finding_type") == "multi_year_incumbency"]
    if incumbency_rows:
        checks.extend(await _manual_incumbency(pool, incumbency_rows[0]))
    else:
        checks.append(_warn("incumbency_non_empty", "Recipe returned no incumbency rows to manually compare."))
    return checks


async def _manual_trend(pool: asyncpg.Pool, row: dict[str, Any], source: str) -> list[dict[str, Any]]:
    if source == "ab_sole_source":
        sql = """
        SELECT sum(amount)::numeric AS metric_value, count(*)::int AS row_count
        FROM ab.ab_sole_source
        WHERE nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int = $1
          AND amount IS NOT NULL
        """
    elif source == "ab_contracts":
        sql = """
        SELECT sum(amount)::numeric AS metric_value, count(*)::int AS row_count
        FROM ab.ab_contracts
        WHERE nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int = $1
          AND amount IS NOT NULL
        """
    else:
        sql = """
        SELECT sum(amount)::numeric AS metric_value, count(*)::int AS row_count
        FROM ab.ab_grants
        WHERE nullif(substring(coalesce(display_fiscal_year, fiscal_year) from '([0-9]{4})'), '')::int = $1
          AND amount IS NOT NULL
        """
    manual = (await _fetch(pool, sql, row["period"]))[0]
    checks = []
    for key in ("metric_value", "row_count"):
        checks.append(_ok(key, f"{source} trend {key} matches manual period aggregation.", recipe_value=row[key], manual_value=manual[key]) if _near(row[key], manual[key]) else _fail(key, f"{source} trend {key} differs from manual period aggregation.", recipe_value=row[key], manual_value=manual[key]))
    return checks


async def _manual_sole_source(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    checks = await _manual_concentration_row(pool, result["findings"][0]) if result["findings"] else [_fail("non_empty", "No sole-source findings.")]
    trends = [row for row in result["findings"] if row.get("finding_type") == "sole_source_trend"]
    if trends:
        checks.extend(await _manual_trend(pool, trends[0], "ab_sole_source"))
    return checks


async def _manual_contract(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    checks = await _manual_concentration_row(pool, result["findings"][0]) if result["findings"] else [_fail("non_empty", "No contract findings.")]
    trends = [row for row in result["findings"] if row.get("finding_type") == "contract_trend"]
    if trends:
        checks.extend(await _manual_trend(pool, trends[0], "ab_contracts"))
    return checks


async def _manual_related(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    first = (result["findings"] or [None])[0]
    if not first:
        return [_fail("non_empty", "Recipe returned no related-party rows.")]
    rows = await _fetch(
        pool,
        """
        WITH director_orgs AS (
            SELECT general.norm_name(concat_ws(' ', cd.first_name, cd.initials, cd.last_name)) AS director_norm_name,
                   ci.bn
            FROM cra.cra_directors cd
            JOIN cra.cra_identification ci ON ci.bn = cd.bn AND ci.fiscal_year = extract(year from cd.fpe)::int
            WHERE ci.fiscal_year >= 2024
        ),
        funding AS (
            SELECT bn, sum(total_govt)::numeric AS total_government_funding
            FROM cra.govt_funding_by_charity
            GROUP BY bn
        )
        SELECT count(DISTINCT d.bn)::int AS connected_org_count,
               sum(coalesce(f.total_government_funding, 0))::numeric AS combined_government_funding
        FROM director_orgs d
        LEFT JOIN funding f USING (bn)
        WHERE d.director_norm_name = $1
        """,
        first["director_norm_name"],
    )
    manual = rows[0]
    checks = []
    for key in ("connected_org_count", "combined_government_funding"):
        checks.append(_ok(key, f"{key} matches manual director aggregation.", recipe_value=first[key], manual_value=manual[key]) if _near(first[key], manual[key]) else _fail(key, f"{key} differs from manual director aggregation.", recipe_value=first[key], manual_value=manual[key]))
    return checks


async def _manual_policy(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    trends = [row for row in result["findings"] if row.get("finding_type") == "policy_spending_trend"]
    checks = await _manual_trend(pool, trends[0], "ab_grants") if trends else [_fail("trend_non_empty", "No policy trend rows.")]
    audits = [row for row in result["findings"] if row.get("finding_type") == "coverage_audit"]
    if audits:
        first = audits[0]
        schema, table = first["source_table"].split(".", 1)
        manual = await _fetch(
            pool,
            """
            SELECT greatest(c.reltuples, 0)::bigint AS row_count_estimate
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2
            """,
            schema,
            table,
        )
        checks.append(_ok("coverage_row_estimate", "Coverage audit row estimate matches pg_class.", recipe_value=first["row_count_estimate"], manual_value=manual[0]["row_count_estimate"]) if _near(first["row_count_estimate"], manual[0]["row_count_estimate"]) else _fail("coverage_row_estimate", "Coverage audit row estimate differs from pg_class.", recipe_value=first["row_count_estimate"], manual_value=manual[0]["row_count_estimate"]))
    return checks


async def _manual_adverse(pool: asyncpg.Pool, result: dict[str, Any]) -> list[dict[str, Any]]:
    findings = result["findings"]
    checks: list[dict[str, Any]] = []
    rows = await _fetch(
        pool,
        """
        SELECT entity_id, canonical_name, total_all_funding
        FROM general.vw_entity_funding
        ORDER BY total_all_funding DESC NULLS LAST, source_count DESC NULLS LAST, canonical_name
        LIMIT 1
        """,
    )
    if not findings:
        return [_fail("web_findings", "Adverse-media recipe returned no web findings.")]
    first = findings[0]
    manual = rows[0]
    checks.append(_ok("top_funded_entity", "First web candidate maps to the top manually queried funding entity.", recipe_value={"entity_id": first["entity_id"], "canonical_name": first["canonical_name"]}, manual_value={"entity_id": manual["entity_id"], "canonical_name": manual["canonical_name"]}) if first["entity_id"] == manual["entity_id"] else _fail("top_funded_entity", "First web candidate does not map to top manual funding entity.", recipe_value=first["entity_id"], manual_value=manual["entity_id"]))
    for item in findings:
        failure = await _verify_url(item["source_url"], f"{item['canonical_name']} {item['snippet']}")
        checks.append(_ok("url_live", "Web finding URL resolves and contains identifying claim text.", recipe_value=item["source_url"]) if failure is None else _fail("url_live", failure, recipe_value=item["source_url"]))
    return checks


MANUAL_CHECKS = {
    "funding_loops": _manual_funding_loops,
    "zombie_recipients": _manual_zombie,
    "ghost_capacity": _manual_ghost,
    "duplicative_funding": _manual_duplicative,
    "vendor_concentration": _manual_vendor,
    "sole_source_amendment": _manual_sole_source,
    "contract_intelligence": _manual_contract,
    "related_parties": _manual_related,
    "policy_misalignment": _manual_policy,
    "adverse_media": _manual_adverse,
}


def _key_facts(result: dict[str, Any]) -> dict[str, Any]:
    first = (result["findings"] or [{}])[0]
    keys = [
        "entity_id",
        "canonical_name",
        "bn",
        "cycle_id",
        "source_table",
        "segment_owner",
        "fiscal_year",
        "supplier_name",
        "director_norm_name",
        "period",
        "source_url",
        "total_all_funding",
        "total_flow",
        "total_government_funding",
        "segment_total_amount",
        "supplier_amount",
        "metric_value",
    ]
    return {key: first.get(key) for key in keys if key in first}


def _render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Manual Database Audit",
        "",
        f"Checked at: `{payload['checked_at']}`",
        "",
        "This audit reruns each shipped `output/ship/` recipe and compares the recipe's leading factual outputs against separate manual SQL over the underlying source tables/views. It is intentionally narrower than full product verification: the goal is to test whether the core rows and numeric magnitudes agree with the database, not to re-score prose style.",
        "",
        "| Recipe | Status | Recipe Latency | Manual Checks | Key Fact |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for item in payload["recipes"]:
        key_fact = json.dumps(item["key_facts"], ensure_ascii=False, sort_keys=True)
        lines.append(f"| `{item['recipe_id']}` | {item['status']} | {item['recipe_latency_ms']}ms | {item['passed_checks']}/{item['total_checks']} | `{key_fact}` |")
    lines.extend(["", "## Details", ""])
    for item in payload["recipes"]:
        lines.extend([f"### {item['recipe_id']}", "", f"Status: **{item['status']}**", ""])
        for check in item["checks"]:
            lines.append(f"- `{check['status']}` `{check['name']}`: {check['details']}")
            if check.get("recipe_value") is not None or check.get("manual_value") is not None:
                lines.append(f"  - recipe: `{json.dumps(check.get('recipe_value'), ensure_ascii=False, sort_keys=True)}`")
                lines.append(f"  - manual: `{json.dumps(check.get('manual_value'), ensure_ascii=False, sort_keys=True)}`")
        lines.append("")
    lines.extend([
        "## Interpretation",
        "",
        "- `pass` means the recipe's checked rows/numbers matched an independent manual database query, within numeric tolerance where relevant.",
        "- `warn` means the recipe returned a usable result but the manual audit did not cover a secondary facet, usually because the recipe had no optional secondary row to compare.",
        "- `fail` means the recipe output did not match the manual database/source check and should not be treated as shipped until repaired.",
    ])
    return "\n".join(lines) + "\n"


async def audit() -> dict[str, Any]:
    pool = await create_pool()
    checked_at = datetime.now(UTC).isoformat()
    recipes: list[dict[str, Any]] = []
    try:
        for case in AUDIT_CASES:
            recipe_id = case["recipe_id"]
            recipe_run = await _run_recipe(recipe_id, case["question"], case["params"], pool)
            result = recipe_run["result"]
            checks = await MANUAL_CHECKS[recipe_id](pool, result)
            recipes.append(
                {
                    "recipe_id": recipe_id,
                    "status": _status(checks),
                    "recipe_latency_ms": recipe_run["latency_ms"],
                    "key_facts": _key_facts(result),
                    "passed_checks": sum(1 for check in checks if check["status"] == "pass"),
                    "total_checks": len(checks),
                    "checks": checks,
                }
            )
    finally:
        await pool.close()
    return {"checked_at": checked_at, "recipes": json_ready(recipes)}


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Run independent manual DB checks for output/ship recipes.")
    parser.add_argument("--json-out", default="output/ship/manual_db_audit_results.json")
    parser.add_argument("--md-out", default="output/ship/MANUAL_DB_AUDIT.md")
    args = parser.parse_args()
    payload = await audit()
    Path(args.json_out).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    Path(args.md_out).write_text(_render_markdown(payload), encoding="utf-8")
    print(json.dumps({"status": _status([{"status": item["status"]} for item in payload["recipes"]]), "checked_at": payload["checked_at"], "recipes": payload["recipes"]}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(_main())
