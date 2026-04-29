"""Entity discovery over the canonical cross-dataset funding view."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    criteria: str | None = None,
    dataset_filters: list[str] | None = None,
    top_n: int = 50,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(1, min(int(top_n), 100))
    datasets = dataset_filters or None
    await emit_primitive_started(
        emit,
        "discover_entities",
        {"criteria": criteria, "dataset_filters": datasets, "top_n": limit},
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
    total_all_funding
FROM general.vw_entity_funding
WHERE ($1::text IS NULL OR canonical_name ILIKE ('%' || $1::text || '%'))
  AND ($2::text[] IS NULL OR dataset_sources && $2::text[])
ORDER BY total_all_funding DESC NULLS LAST, source_count DESC NULLS LAST, canonical_name
LIMIT $3
""".strip()
    rows, log = await run_query(
        pool,
        query_name="discover_entities",
        sql=sql,
        params=[criteria, datasets, limit],
        emit=emit,
        primitive_name="discover_entities",
    )
    caveats = [f"Entity discovery returns the top {limit} canonical records by recorded funding, not a complete universe."]
    result = PrimitiveResult(
        primitive_name="discover_entities",
        rows=rows,
        sql_log=[log],
        caveats=caveats,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
