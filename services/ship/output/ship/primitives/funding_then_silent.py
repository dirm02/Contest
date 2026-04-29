"""High-government-funding charities that later stop appearing in filings."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    min_govt_share: float = 0.7,
    min_total_funding: float = 500_000,
    last_filed_before: int = 2024,
    top_n: int = 50,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(1, min(int(top_n), 100))
    await emit_primitive_started(
        emit,
        "funding_then_silent",
        {
            "min_govt_share": min_govt_share,
            "min_total_funding": min_total_funding,
            "last_filed_before": last_filed_before,
            "top_n": limit,
        },
    )
    sql = """
WITH govt AS (
    SELECT
        bn,
        max(legal_name) FILTER (WHERE legal_name IS NOT NULL) AS latest_legal_name,
        max(fiscal_year) AS latest_govt_funding_year,
        sum(total_govt)::numeric AS total_government_funding,
        sum(revenue)::numeric AS total_revenue,
        sum(total_govt)::numeric / nullif(sum(revenue), 0) AS govt_share,
        count(*)::int AS funded_year_count
    FROM cra.govt_funding_by_charity
    WHERE total_govt IS NOT NULL
    GROUP BY bn
),
latest_filing AS (
    SELECT
        bn,
        max(fiscal_year)::int AS latest_filing_year,
        (array_agg(legal_name ORDER BY fiscal_year DESC))[1] AS legal_name,
        (array_agg(category ORDER BY fiscal_year DESC))[1] AS category,
        (array_agg(designation ORDER BY fiscal_year DESC))[1] AS designation
    FROM cra.cra_identification
    GROUP BY bn
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
)
SELECT
    c.entity_id,
    c.canonical_name,
    g.bn,
    coalesce(l.legal_name, g.latest_legal_name) AS source_legal_name,
    l.latest_filing_year,
    g.latest_govt_funding_year,
    g.total_government_funding,
    g.total_revenue,
    g.govt_share,
    g.funded_year_count,
    l.category,
    l.designation
FROM govt g
JOIN latest_filing l USING (bn)
LEFT JOIN canonical c ON c.bn_root = left(g.bn, 9)
WHERE g.total_government_funding >= $1::numeric
  AND g.govt_share >= $2::numeric
  AND l.latest_filing_year < $3::int
ORDER BY g.total_government_funding DESC, g.govt_share DESC, c.canonical_name NULLS LAST
LIMIT $4
""".strip()
    rows, log = await run_query(
        pool,
        query_name="funding_then_silent",
        sql=sql,
        params=[min_total_funding, min_govt_share, last_filed_before, limit],
        emit=emit,
        primitive_name="funding_then_silent",
    )
    caveats = [
        "This identifies charities with high recorded government funding and older latest CRA filings; it does not prove dissolution by itself.",
        "Canonical names come from the entity-resolution layer when a CRA source link exists.",
    ]
    result = PrimitiveResult(
        primitive_name="funding_then_silent",
        rows=rows,
        sql_log=[log],
        caveats=caveats,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
