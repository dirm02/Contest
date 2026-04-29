"""Funding-loop discovery using pre-computed CRA cycle tables."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    min_total_amount: float = 100_000,
    exclude_denominational: bool = True,
    top_n: int = 50,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(1, min(int(top_n), 100))
    await emit_primitive_started(
        emit,
        "funding_cycles",
        {"min_total_amount": min_total_amount, "exclude_denominational": exclude_denominational, "top_n": limit},
    )
    sql = """
WITH top_cycles AS (
    SELECT
        id AS cycle_id,
        hops,
        path_bns,
        path_display,
        bottleneck_amt,
        total_flow,
        min_year,
        max_year
    FROM cra.johnson_cycles
    WHERE total_flow >= $1::numeric
    ORDER BY total_flow DESC, bottleneck_amt DESC, id
    LIMIT $2
),
participants AS (
    SELECT
        lp.loop_id AS cycle_id,
        jsonb_agg(
            DISTINCT jsonb_build_object(
                'bn', lp.bn,
                'canonical_name', gr.canonical_name,
                'latest_legal_name', ci.legal_name,
                'designation', ci.designation,
                'category', ci.category
            )
        ) AS participants,
        bool_or(coalesce(ci.category, '') ILIKE '%relig%' OR coalesce(ci.category, '') ILIKE '%church%') AS has_denominational_marker
    FROM cra.loop_participants lp
    LEFT JOIN LATERAL (
        SELECT legal_name, designation, category
        FROM cra.cra_identification ci
        WHERE ci.bn = lp.bn
        ORDER BY ci.fiscal_year DESC
        LIMIT 1
    ) ci ON true
    LEFT JOIN general.entity_source_links esl
        ON esl.source_schema = 'cra'
       AND esl.source_table = 'cra_identification'
       AND esl.source_pk ->> 'bn_root' = left(lp.bn, 9)
    LEFT JOIN general.entity_golden_records gr ON gr.id = esl.entity_id
    WHERE lp.loop_id IN (SELECT cycle_id FROM top_cycles)
    GROUP BY lp.loop_id
)
SELECT
    t.cycle_id,
    t.hops,
    t.path_display,
    t.bottleneck_amt,
    t.total_flow,
    t.min_year,
    t.max_year,
    coalesce(p.participants, '[]'::jsonb) AS participants,
    coalesce(p.has_denominational_marker, false) AS has_denominational_marker
FROM top_cycles t
LEFT JOIN participants p USING (cycle_id)
WHERE ($3::boolean IS false OR coalesce(p.has_denominational_marker, false) IS false)
ORDER BY t.total_flow DESC, t.bottleneck_amt DESC, t.cycle_id
""".strip()
    rows, log = await run_query(
        pool,
        query_name="funding_cycles",
        sql=sql,
        params=[min_total_amount, limit, exclude_denominational],
        emit=emit,
        primitive_name="funding_cycles",
    )
    caveats = [
        "Funding loops use pre-computed CRA cycle tables over qualified-donee gift flows.",
        "Denominational/federated exclusion is a conservative category-text heuristic, not a legal classification.",
    ]
    result = PrimitiveResult(
        primitive_name="funding_cycles",
        rows=rows,
        sql_log=[log],
        caveats=caveats,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
