"""Multi-year supplier incumbency over Alberta sole-source and contract data."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


async def run(
    pool: asyncpg.Pool,
    *,
    source: str = "ab_sole_source",
    ministry_filter: str | None = None,
    min_year_span: int = 2,
    top_n: int = 50,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    limit = max(1, min(int(top_n), 100))
    span = max(2, min(int(min_year_span), 20))
    await emit_primitive_started(
        emit,
        "multi_year_incumbency",
        {"source": source, "ministry_filter": ministry_filter, "min_year_span": span, "top_n": limit},
    )
    sql = """
WITH source_rows AS (
    SELECT
        'ab.ab_sole_source'::text AS source_table,
        'sole_source_contract'::text AS spending_class,
        coalesce(nullif(btrim(ministry), ''), 'unknown') AS ministry,
        regexp_replace(btrim(vendor), '\\s+', ' ', 'g') AS supplier_name,
        coalesce(nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int, extract(year from start_date)::int) AS period_year,
        amount::numeric AS amount,
        id::text AS sample_record_id
    FROM ab.ab_sole_source
    WHERE $1::text IN ('ab_sole_source', 'all')
      AND vendor IS NOT NULL AND btrim(vendor) <> ''
      AND amount IS NOT NULL AND amount > 0
      AND ($2::text IS NULL OR ministry ILIKE ('%' || $2 || '%'))
    UNION ALL
    SELECT
        'ab.ab_contracts',
        'competed_contract',
        coalesce(nullif(btrim(ministry), ''), 'unknown'),
        regexp_replace(btrim(recipient), '\\s+', ' ', 'g'),
        nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int,
        amount::numeric,
        id::text
    FROM ab.ab_contracts
    WHERE $1::text IN ('ab_contracts', 'all')
      AND recipient IS NOT NULL AND btrim(recipient) <> ''
      AND amount IS NOT NULL AND amount > 0
      AND ($2::text IS NULL OR ministry ILIKE ('%' || $2 || '%'))
),
annual AS (
    SELECT
        source_table,
        spending_class,
        ministry,
        supplier_name,
        period_year,
        count(*)::int AS annual_award_count,
        sum(amount)::numeric AS annual_amount,
        min(sample_record_id) AS sample_record_id
    FROM source_rows
    WHERE period_year IS NOT NULL
    GROUP BY source_table, spending_class, ministry, supplier_name, period_year
),
windowed AS (
    SELECT
        source_table,
        spending_class,
        ministry,
        supplier_name,
        count(*)::int AS supplier_year_count,
        min(period_year)::int AS first_year,
        max(period_year)::int AS latest_year,
        (max(period_year) - min(period_year) + 1)::int AS incumbency_window_years,
        sum(annual_award_count)::int AS award_count_window,
        sum(annual_amount)::numeric AS total_amount_window,
        jsonb_object_agg(period_year::text, annual_amount ORDER BY period_year) AS amount_by_year,
        (array_agg(sample_record_id ORDER BY annual_amount DESC))[1] AS sample_record_id
    FROM annual
    GROUP BY source_table, spending_class, ministry, supplier_name
)
SELECT *
FROM windowed
WHERE incumbency_window_years >= $3::int
ORDER BY total_amount_window DESC, incumbency_window_years DESC, supplier_name
LIMIT $4
""".strip()
    rows, log = await run_query(
        pool,
        query_name=f"multi_year_incumbency_{source}",
        sql=sql,
        params=[source, ministry_filter, span, limit],
        emit=emit,
        primitive_name="multi_year_incumbency",
    )
    result = PrimitiveResult(
        primitive_name="multi_year_incumbency",
        rows=rows,
        sql_log=[log],
        caveats=["Incumbency is a repeated-supplier metric over available fiscal-year labels; it does not prove improper procurement by itself."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
