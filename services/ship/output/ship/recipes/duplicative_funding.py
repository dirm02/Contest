"""Recipe: organizations receiving funding across multiple public-source families."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives.base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


class Params(RecipeParams):
    min_source_count: int = 2


def humanize(params: dict) -> str:
    count = params.get("min_source_count") or 2
    amount = params.get("min_amount")
    suffix = f" over ${amount:,.0f}" if amount else ""
    return f"Recipients funded by {count}+ source families{suffix}"


async def _duplicative(pool: asyncpg.Pool, params: Params, *, emit: EmitCallback | None = None) -> PrimitiveResult:
    started = time.perf_counter()
    await emit_primitive_started(
        emit,
        "duplicative_funding",
        {"min_amount": params.min_amount, "min_source_count": params.min_source_count, "top_n": params.top_n},
    )
    sql = """
SELECT
    entity_id,
    canonical_name,
    dataset_sources,
    source_count,
    cra_total_revenue,
    fed_total_grants,
    ab_total_grants,
    ab_total_contracts,
    ab_total_sole_source,
    total_all_funding,
    ((fed_total_grants > 0)::int + (ab_total_grants > 0)::int + (ab_total_contracts > 0)::int + (ab_total_sole_source > 0)::int + (cra_total_revenue > 0)::int) AS positive_funding_source_count
FROM general.vw_entity_funding
WHERE total_all_funding >= coalesce($1::numeric, 0)
  AND ((fed_total_grants > 0)::int + (ab_total_grants > 0)::int + (ab_total_contracts > 0)::int + (ab_total_sole_source > 0)::int + (cra_total_revenue > 0)::int) >= $2::int
ORDER BY total_all_funding DESC NULLS LAST, positive_funding_source_count DESC, canonical_name
LIMIT $3
""".strip()
    rows, log = await run_query(
        pool,
        query_name="duplicative_funding",
        sql=sql,
        params=[params.min_amount, max(2, min(params.min_source_count, 5)), max(1, min(params.top_n, 100))],
        emit=emit,
        primitive_name="duplicative_funding",
    )
    result = PrimitiveResult(
        primitive_name="duplicative_funding",
        rows=rows,
        sql_log=[log],
        caveats=["Cross-source funding overlap is an audit lead; programs can legitimately fund the same canonical recipient for different purposes."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    result = await _duplicative(pool, params, emit=emit)
    return recipe_result(
        recipe_id="duplicative_funding",
        question=question,
        params=params,
        source_runs=[result],
        findings=result.rows,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
