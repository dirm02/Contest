"""Governance overlap over CRA directors and canonical charity entities."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    min_orgs_per_director: int = 3,
    fiscal_year_min: int = 2023,
    top_n: int = 100,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(1, min(int(top_n), 150))
    min_orgs = max(2, min(int(min_orgs_per_director), 20))
    await emit_primitive_started(
        emit,
        "governance_overlap",
        {"min_orgs_per_director": min_orgs, "fiscal_year_min": fiscal_year_min, "top_n": limit},
    )
    sql = """
WITH director_orgs AS (
    SELECT
        general.norm_name(concat_ws(' ', cd.first_name, cd.initials, cd.last_name)) AS director_norm_name,
        regexp_replace(btrim(concat_ws(' ', cd.first_name, cd.initials, cd.last_name)), '\\s+', ' ', 'g') AS director_name,
        ci.bn,
        ci.legal_name,
        ci.fiscal_year
    FROM cra.cra_directors cd
    JOIN cra.cra_identification ci ON ci.bn = cd.bn AND ci.fiscal_year = extract(year from cd.fpe)::int
    WHERE (cd.first_name IS NOT NULL OR cd.last_name IS NOT NULL)
      AND btrim(concat_ws(' ', cd.first_name, cd.initials, cd.last_name)) <> ''
      AND ci.fiscal_year >= $1::int
),
canonical AS (
    SELECT DISTINCT ON (esl.source_pk ->> 'bn_root')
        esl.source_pk ->> 'bn_root' AS bn_root,
        gr.id AS entity_id,
        gr.canonical_name
    FROM general.entity_source_links esl
    JOIN general.entity_golden_records gr ON gr.id = esl.entity_id
    WHERE esl.source_schema = 'cra'
      AND esl.source_table = 'cra_identification'
    ORDER BY esl.source_pk ->> 'bn_root', esl.match_confidence DESC NULLS LAST, gr.id
),
funding AS (
    SELECT bn, sum(total_govt)::numeric AS total_government_funding
    FROM cra.govt_funding_by_charity
    GROUP BY bn
)
SELECT
    min(d.director_name) AS director_name,
    d.director_norm_name,
    count(DISTINCT d.bn)::int AS connected_org_count,
    sum(coalesce(f.total_government_funding, 0))::numeric AS combined_government_funding,
    jsonb_agg(
        DISTINCT jsonb_build_object(
            'bn', d.bn,
            'entity_id', c.entity_id,
            'canonical_name', c.canonical_name,
            'source_legal_name', d.legal_name,
            'total_government_funding', f.total_government_funding
        )
    ) AS connected_orgs
FROM director_orgs d
LEFT JOIN canonical c ON c.bn_root = left(d.bn, 9)
LEFT JOIN funding f ON f.bn = d.bn
GROUP BY d.director_norm_name
HAVING count(DISTINCT d.bn) >= $2::int
ORDER BY connected_org_count DESC, combined_government_funding DESC NULLS LAST, director_norm_name
LIMIT $3
""".strip()
    rows, log = await run_query(
        pool,
        query_name="governance_overlap",
        sql=sql,
        params=[fiscal_year_min, min_orgs, limit],
        emit=emit,
        primitive_name="governance_overlap",
    )
    result = PrimitiveResult(
        primitive_name="governance_overlap",
        rows=rows,
        sql_log=[log],
        caveats=["Director overlap is name-normalized and may combine people with the same name; treat rows as leads until manually confirmed."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
