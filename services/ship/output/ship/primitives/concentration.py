"""Supplier/recipient concentration metrics across bounded public spending sources."""

from __future__ import annotations

import time
from typing import Literal

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


SourceKind = Literal["ab_contracts", "ab_sole_source", "ab_grants", "fed_grants", "all"]


async def run(
    pool: asyncpg.Pool,
    *,
    source: SourceKind = "all",
    ministry_filter: str | None = None,
    fiscal_year_min: int | None = None,
    fiscal_year_max: int | None = None,
    min_segment_amount: float = 100_000,
    segment_limit: int = 20,
    top_suppliers_per_segment: int = 5,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    seg_limit = max(1, min(int(segment_limit), 50))
    supplier_limit = max(1, min(int(top_suppliers_per_segment), 10))
    await emit_primitive_started(
        emit,
        "concentration",
        {
            "source": source,
            "ministry_filter": ministry_filter,
            "fiscal_year_min": fiscal_year_min,
            "fiscal_year_max": fiscal_year_max,
            "min_segment_amount": min_segment_amount,
            "segment_limit": seg_limit,
            "top_suppliers_per_segment": supplier_limit,
        },
    )
    sql = """
WITH source_rows AS (
    SELECT
        'ab.ab_contracts'::text AS source_table,
        'competed_contract'::text AS spending_class,
        coalesce(nullif(btrim(ministry), ''), 'unknown') AS segment_owner,
        coalesce(nullif(btrim(display_fiscal_year), ''), 'unknown') AS fiscal_year,
        null::text AS category_proxy,
        null::text AS region_proxy,
        regexp_replace(btrim(recipient), '\\s+', ' ', 'g') AS supplier_name,
        amount::numeric AS amount,
        id::text AS sample_record_id
    FROM ab.ab_contracts
    WHERE ($1::text IN ('ab_contracts', 'all'))
      AND recipient IS NOT NULL AND btrim(recipient) <> ''
      AND amount IS NOT NULL AND amount > 0
      AND ($2::text IS NULL OR ministry ILIKE ('%' || $2 || '%'))
      AND ($3::int IS NULL OR nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int >= $3)
      AND ($4::int IS NULL OR nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int <= $4)
    UNION ALL
    SELECT
        'ab.ab_sole_source',
        'sole_source_contract',
        coalesce(nullif(btrim(ministry), ''), 'unknown'),
        coalesce(nullif(btrim(display_fiscal_year), ''), 'unknown'),
        nullif(regexp_replace(btrim(contract_services), '\\s+', ' ', 'g'), ''),
        coalesce(nullif(btrim(department_city), ''), 'unknown'),
        regexp_replace(btrim(vendor), '\\s+', ' ', 'g'),
        amount::numeric,
        id::text
    FROM ab.ab_sole_source
    WHERE ($1::text IN ('ab_sole_source', 'all'))
      AND vendor IS NOT NULL AND btrim(vendor) <> ''
      AND amount IS NOT NULL AND amount > 0
      AND ($2::text IS NULL OR ministry ILIKE ('%' || $2 || '%'))
      AND ($3::int IS NULL OR nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int >= $3)
      AND ($4::int IS NULL OR nullif(substring(display_fiscal_year from '([0-9]{4})'), '')::int <= $4)
    UNION ALL
    SELECT
        'fed.grants_contributions',
        'federal_grant',
        coalesce(nullif(btrim(owner_org_title), ''), nullif(btrim(owner_org), ''), 'unknown'),
        coalesce(extract(year from agreement_start_date)::int::text, 'unknown'),
        nullif(regexp_replace(btrim(prog_name_en), '\\s+', ' ', 'g'), ''),
        coalesce(nullif(btrim(recipient_province), ''), 'unknown'),
        regexp_replace(btrim(recipient_legal_name), '\\s+', ' ', 'g'),
        agreement_value::numeric,
        _id::text
    FROM fed.grants_contributions
    WHERE ($1::text IN ('fed_grants', 'all'))
      AND recipient_legal_name IS NOT NULL AND btrim(recipient_legal_name) <> ''
      AND agreement_value IS NOT NULL AND agreement_value > 0
      AND agreement_start_date >= date '1900-01-01'
      AND ($2::text IS NULL OR owner_org_title ILIKE ('%' || $2 || '%') OR owner_org ILIKE ('%' || $2 || '%'))
      AND ($3::int IS NULL OR extract(year from agreement_start_date)::int >= $3)
      AND ($4::int IS NULL OR extract(year from agreement_start_date)::int <= $4)
),
supplier_totals AS (
    SELECT
        source_table,
        spending_class,
        segment_owner,
        fiscal_year,
        supplier_name,
        count(*)::int AS award_count,
        sum(amount)::numeric AS supplier_amount,
        min(sample_record_id) AS sample_record_id
    FROM source_rows
    GROUP BY source_table, spending_class, segment_owner, fiscal_year, supplier_name
),
ranked AS (
    SELECT
        *,
        count(*) OVER segment AS supplier_count,
        sum(award_count) OVER segment AS segment_award_count,
        sum(supplier_amount) OVER segment AS segment_total_amount,
        row_number() OVER (
            PARTITION BY source_table, spending_class, segment_owner, fiscal_year
            ORDER BY supplier_amount DESC, supplier_name
        ) AS supplier_rank
    FROM supplier_totals
    WINDOW segment AS (PARTITION BY source_table, spending_class, segment_owner, fiscal_year)
),
metrics AS (
    SELECT
        *,
        supplier_amount / nullif(segment_total_amount, 0) AS supplier_share,
        max(supplier_amount) OVER segment / nullif(segment_total_amount, 0) AS cr1,
        sum(CASE WHEN supplier_rank <= 3 THEN supplier_amount ELSE 0 END) OVER segment / nullif(segment_total_amount, 0) AS cr3,
        sum(power(supplier_amount / nullif(segment_total_amount, 0), 2)) OVER segment AS hhi
    FROM ranked
    WHERE segment_total_amount >= $5::numeric
    WINDOW segment AS (PARTITION BY source_table, spending_class, segment_owner, fiscal_year)
),
segments AS (
    SELECT
        *,
        dense_rank() OVER (ORDER BY hhi DESC, segment_total_amount DESC, segment_owner, fiscal_year) AS segment_rank
    FROM metrics
)
SELECT
    source_table,
    spending_class,
    segment_rank::int,
    supplier_rank::int,
    segment_owner,
    fiscal_year,
    supplier_name,
    supplier_count::int,
    segment_award_count::int,
    award_count::int,
    segment_total_amount,
    supplier_amount,
    supplier_share,
    cr1,
    cr3,
    hhi,
    hhi * 10000 AS hhi_10000,
    sample_record_id
FROM segments
WHERE segment_rank <= $6::int
  AND supplier_rank <= $7::int
ORDER BY segment_rank, supplier_rank, supplier_name
""".strip()
    rows, log = await run_query(
        pool,
        query_name=f"concentration_{source}",
        sql=sql,
        params=[source, ministry_filter, fiscal_year_min, fiscal_year_max, min_segment_amount, seg_limit, supplier_limit],
        emit=emit,
        primitive_name="concentration",
    )
    caveats = [
        "Concentration is computed from bounded public spending rows and grouped by available source dimensions.",
        "Federal grants are recipient-concentration, not procurement competition, unless the source question explicitly treats grants as spending concentration.",
    ]
    result = PrimitiveResult(
        primitive_name="concentration",
        rows=rows,
        sql_log=[log],
        caveats=caveats,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
