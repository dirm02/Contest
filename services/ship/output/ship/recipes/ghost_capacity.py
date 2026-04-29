"""Recipe: charities with high overhead signals and low reported compensation capacity."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives.base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


class Params(RecipeParams):
    min_overhead_pct: float = 0.7
    fiscal_year_min: int | None = 2023


def humanize(params: dict) -> str:
    pct = params.get("min_overhead_pct", 0.7)
    year = params.get("fiscal_year_min") or 2023
    return f"Ghost-capacity charities over {pct:.0%} overhead since {year}"


async def _ghost_capacity(pool: asyncpg.Pool, params: Params, *, emit: EmitCallback | None = None) -> PrimitiveResult:
    started = time.perf_counter()
    await emit_primitive_started(
        emit,
        "ghost_capacity",
        {"fiscal_year_min": params.fiscal_year_min, "min_overhead_pct": params.min_overhead_pct, "top_n": params.top_n},
    )
    sql = """
WITH latest_overhead AS (
    SELECT DISTINCT ON (bn)
        bn,
        fiscal_year,
        legal_name,
        revenue,
        total_expenditures,
        compensation,
        administration,
        fundraising,
        programs,
        strict_overhead_pct,
        broad_overhead_pct,
        outlier_flag
    FROM cra.overhead_by_charity
    WHERE ($1::int IS NULL OR fiscal_year >= $1)
      AND broad_overhead_pct >= $2::numeric
    ORDER BY bn, fiscal_year DESC
),
latest_comp AS (
    SELECT DISTINCT ON (bn)
        bn,
        fpe,
        coalesce(field_300, 0) + coalesce(field_305, 0) + coalesce(field_310, 0) + coalesce(field_315, 0) +
        coalesce(field_320, 0) + coalesce(field_325, 0) + coalesce(field_330, 0) + coalesce(field_335, 0) +
        coalesce(field_340, 0) + coalesce(field_345, 0) AS reported_compensated_staff
    FROM cra.cra_compensation
    ORDER BY bn, fpe DESC
),
canonical AS (
    SELECT DISTINCT ON (esl.source_pk ->> 'bn_root')
        esl.source_pk ->> 'bn_root' AS bn_root,
        gr.id AS entity_id,
        gr.canonical_name
    FROM general.entity_source_links esl
    JOIN general.entity_golden_records gr ON gr.id = esl.entity_id
    WHERE esl.source_schema = 'cra' AND esl.source_table = 'cra_identification'
    ORDER BY esl.source_pk ->> 'bn_root', esl.match_confidence DESC NULLS LAST, gr.id
)
SELECT
    c.entity_id,
    c.canonical_name,
    o.bn,
    o.legal_name AS source_legal_name,
    o.fiscal_year,
    o.revenue,
    o.total_expenditures,
    o.compensation,
    o.administration,
    o.fundraising,
    o.programs,
    o.strict_overhead_pct,
    o.broad_overhead_pct,
    o.outlier_flag,
    coalesce(comp.reported_compensated_staff, 0)::int AS reported_compensated_staff
FROM latest_overhead o
LEFT JOIN latest_comp comp USING (bn)
LEFT JOIN canonical c ON c.bn_root = left(o.bn, 9)
WHERE coalesce(comp.reported_compensated_staff, 0) = 0
ORDER BY o.broad_overhead_pct DESC, o.total_expenditures DESC NULLS LAST
LIMIT $3
""".strip()
    rows, log = await run_query(
        pool,
        query_name="ghost_capacity",
        sql=sql,
        params=[params.fiscal_year_min, params.min_overhead_pct, max(1, min(params.top_n, 100))],
        emit=emit,
        primitive_name="ghost_capacity",
    )
    result = PrimitiveResult(
        primitive_name="ghost_capacity",
        rows=rows,
        sql_log=[log],
        caveats=["CRA compensation bands do not prove staffing capacity; zero reported compensated staff is an analytical signal, not a finding of wrongdoing."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    result = await _ghost_capacity(pool, params, emit=emit)
    return recipe_result(
        recipe_id="ghost_capacity",
        question=question,
        params=params,
        source_runs=[result],
        findings=result.rows,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
