"""Lightweight source coverage and missingness audit."""

from __future__ import annotations

import time

import asyncpg

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started, run_query


SOURCE_TABLES = {
    "alberta": [("ab", "ab_contracts"), ("ab", "ab_sole_source"), ("ab", "ab_grants"), ("ab", "ab_non_profit")],
    "ab": [("ab", "ab_contracts"), ("ab", "ab_sole_source"), ("ab", "ab_grants"), ("ab", "ab_non_profit")],
    "federal": [("fed", "grants_contributions")],
    "fed": [("fed", "grants_contributions")],
    "cra": [("cra", "cra_identification"), ("cra", "govt_funding_by_charity"), ("cra", "overhead_by_charity")],
    "general": [("general", "entity_golden_records"), ("general", "entity_source_links"), ("general", "vw_entity_funding")],
}


async def run(
    pool: asyncpg.Pool,
    *,
    source_families: list[str] | None = None,
    expected_fields_per_obligation: dict[str, list[str]] | None = None,
    top_n: int = 100,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    selected: list[tuple[str, str]] = []
    for family in source_families or ["ab", "fed", "cra", "general"]:
        selected.extend(SOURCE_TABLES.get(family.lower(), []))
    if not selected:
        selected = SOURCE_TABLES["ab"] + SOURCE_TABLES["federal"] + SOURCE_TABLES["cra"] + SOURCE_TABLES["general"]
    selected = list(dict.fromkeys(selected))[: max(1, min(int(top_n), 100))]
    schemas = [schema for schema, _ in selected]
    tables = [table for _, table in selected]
    expected_fields = sorted({field for fields in (expected_fields_per_obligation or {}).values() for field in fields})
    await emit_primitive_started(
        emit,
        "coverage_audit",
        {"source_families": source_families or ["ab", "fed", "cra", "general"], "table_count": len(selected)},
    )
    sql = """
WITH selected AS (
    SELECT unnest($1::text[]) AS table_schema, unnest($2::text[]) AS table_name
),
row_estimates AS (
    SELECT
        n.nspname AS table_schema,
        c.relname AS table_name,
        greatest(c.reltuples, 0)::bigint AS row_count_estimate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN selected s ON s.table_schema = n.nspname AND s.table_name = c.relname
),
columns AS (
    SELECT
        c.table_schema,
        c.table_name,
        jsonb_object_agg(
            c.column_name,
            jsonb_build_object(
                'type', c.data_type,
                'null_rate', ps.null_frac,
                'distinct_estimate', ps.n_distinct
            )
            ORDER BY c.ordinal_position
        ) AS columns
    FROM information_schema.columns c
    JOIN selected s USING (table_schema, table_name)
    LEFT JOIN pg_stats ps
      ON ps.schemaname = c.table_schema
     AND ps.tablename = c.table_name
     AND ps.attname = c.column_name
    GROUP BY c.table_schema, c.table_name
)
SELECT
    r.table_schema || '.' || r.table_name AS source_table,
    r.row_count_estimate,
    coalesce(c.columns, '{}'::jsonb) AS field_stats,
    $3::text[] AS expected_fields
FROM row_estimates r
LEFT JOIN columns c USING (table_schema, table_name)
ORDER BY r.table_schema, r.table_name
""".strip()
    rows, log = await run_query(
        pool,
        query_name="coverage_audit",
        sql=sql,
        params=[schemas, tables, expected_fields],
        emit=emit,
        primitive_name="coverage_audit",
    )
    caveats = ["Coverage audit uses PostgreSQL statistics for row estimates and null rates; values may lag until ANALYZE refreshes stats."]
    result = PrimitiveResult(
        primitive_name="coverage_audit",
        rows=rows,
        sql_log=[log],
        caveats=caveats,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result
