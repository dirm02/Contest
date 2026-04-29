"""Bounded time-series aggregation primitive."""

from __future__ import annotations

import time
from typing import Literal

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    source: Literal["ab_contracts", "ab_sole_source", "ab_grants", "fed_grants", "cra_government_funding"] = "fed_grants",
    metric: Literal["amount", "count"] = "amount",
    fiscal_year_min: int | None = None,
    fiscal_year_max: int | None = None,
    keyword: str | None = None,
    periods: int = 8,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(2, min(int(periods), 20))
    await emit_primitive_started(
        emit,
        "trend",
        {
            "source": source,
            "metric": metric,
            "fiscal_year_min": fiscal_year_min,
            "fiscal_year_max": fiscal_year_max,
            "keyword": keyword,
            "periods": limit,
        },
    )
    sql = """
WITH rows AS (
    SELECT 'ab_contracts'::text AS source, nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int AS period, amount::numeric AS amount, recipient::text AS text_field
    FROM ab.ab_contracts
    WHERE $1::text = 'ab_contracts'
    UNION ALL
    SELECT 'ab_sole_source', nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int, amount::numeric, contract_services::text
    FROM ab.ab_sole_source
    WHERE $1::text = 'ab_sole_source'
    UNION ALL
    SELECT 'ab_grants', nullif(substring(coalesce(display_fiscal_year, fiscal_year) from '([0-9]{4})'), '')::int, amount::numeric, coalesce(program, recipient)::text
    FROM ab.ab_grants
    WHERE $1::text = 'ab_grants'
    UNION ALL
    SELECT 'fed_grants', extract(year from agreement_start_date)::int, agreement_value::numeric, coalesce(prog_name_en, agreement_title_en, description_en)::text
    FROM fed.grants_contributions
    WHERE $1::text = 'fed_grants'
      AND agreement_start_date >= date '1900-01-01'
    UNION ALL
    SELECT 'cra_government_funding', fiscal_year::int, total_govt::numeric, legal_name::text
    FROM cra.govt_funding_by_charity
    WHERE $1::text = 'cra_government_funding'
),
filtered AS (
    SELECT *
    FROM rows
    WHERE period IS NOT NULL
      AND amount IS NOT NULL
      AND ($2::int IS NULL OR period >= $2)
      AND ($3::int IS NULL OR period <= $3)
      AND ($4::text IS NULL OR text_field ILIKE ('%' || $4 || '%'))
),
annual AS (
    SELECT
        source,
        period,
        CASE WHEN $5::text = 'count' THEN count(*)::numeric ELSE sum(amount)::numeric END AS metric_value,
        count(*)::int AS row_count
    FROM filtered
    GROUP BY source, period
),
windowed AS (
    SELECT
        source,
        period,
        metric_value,
        row_count,
        metric_value - lag(metric_value) OVER (ORDER BY period) AS yoy_delta,
        avg(metric_value) OVER (ORDER BY period ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rolling_3_period_average
    FROM annual
)
SELECT *
FROM windowed
ORDER BY period DESC
LIMIT $6
""".strip()
    rows, log = await run_query(
        pool,
        query_name=f"trend_{source}_{metric}",
        sql=sql,
        params=[source, fiscal_year_min, fiscal_year_max, keyword, metric, limit],
        emit=emit,
        primitive_name="trend",
    )
    result = PrimitiveResult(
        primitive_name="trend",
        rows=rows,
        sql_log=[log],
        caveats=["Trend periods use the date/year column available in each source table; sentinel dates before 1900 are excluded for federal grants."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
