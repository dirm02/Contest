"""Compile structured analytical query plans into safe SQL."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

from pydantic import Field

from .lexicon import ResolvedConcept
from .primitives.base import StrictModel, json_ready
from .responses import Aggregation, SortKey
from .schema_catalog import SchemaCatalog, TableSpec


IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TEMPLATE_IDS = {
    "abstain",
    "count_distinct",
    "aggregate_by_group",
    "top_n_with_filter",
    "intersection_across_filters",
    "delta_year_over_year",
    "percentile",
}


class JoinSpec(StrictModel):
    table: str
    on: list[tuple[str, str]]
    how: Literal["inner", "left"] = "inner"


class FilterSpec(StrictModel):
    column: str | None = None
    op: Literal["=", "!=", "<", "<=", ">", ">=", "ILIKE", "IN", "IS NOT NULL", "IS NULL"] | None = None
    value: str | int | float | bool | list[str] | list[int] | list[float] | None = None
    concept: str | None = None


class QueryPlan(StrictModel):
    template_id: str
    primary_table: str
    select_list: list[str] = Field(default_factory=list)
    joins: list[JoinSpec] = Field(default_factory=list)
    filters: list[FilterSpec] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    aggregations: list[Aggregation] = Field(default_factory=list)
    sort_by: list[SortKey] = Field(default_factory=list)
    limit: int = 1000
    expected_columns: list[str] = Field(default_factory=list)
    reasoning: str = ""


class CompiledQuery(StrictModel):
    sql: str
    query_hash: str
    query_name: str
    caveats: list[str] = Field(default_factory=list)


class CompileError(ValueError):
    pass


def compile_query_plan(
    plan: QueryPlan,
    catalog: SchemaCatalog,
    resolved_concepts: list[ResolvedConcept],
) -> CompiledQuery:
    if plan.template_id not in TEMPLATE_IDS:
        raise CompileError(f"unknown query template {plan.template_id!r}")
    if plan.template_id == "abstain":
        raise CompileError(plan.reasoning or "planner abstained")
    table = _table(catalog, plan.primary_table)
    concept_predicates = {concept.concept: concept.sql_predicate for concept in resolved_concepts}
    caveats = [caveat for concept in resolved_concepts for caveat in concept.caveats]

    aggregation_aliases = {aggregation.alias for aggregation in plan.aggregations}
    where = _render_filters(plan, table, concept_predicates, skip_columns=aggregation_aliases)
    joins = _render_joins(plan, table, catalog)
    limit = min(max(int(plan.limit or 1000), 1), 10000)

    if plan.template_id == "count_distinct":
        key = _safe_column(table, (plan.group_by or plan.select_list or table.primary_key or [table.columns[0].name])[0])
        sql = f"SELECT COUNT(DISTINCT {key})::int AS count FROM {table.fq_name}{joins}{where} LIMIT 1"
    elif plan.template_id == "percentile":
        target = _safe_column(table, (plan.aggregations[0].column if plan.aggregations else "amount"))
        sql = f"SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {target}) AS median_value FROM {table.fq_name}{joins}{where} LIMIT 1"
    elif plan.template_id == "aggregate_by_group":
        group_by = [_safe_column(table, column) for column in plan.group_by]
        aggregations = plan.aggregations or [Aggregation(column="amount", fn="sum", alias="total_amount")]
        select = [*group_by, *[_render_aggregation(table, aggregation) for aggregation in aggregations]]
        group = f" GROUP BY {', '.join(group_by)}" if group_by else ""
        having = _render_having(table, aggregations, plan.filters)
        order_by = _render_sort(plan.sort_by, table) or (" ORDER BY 2 DESC" if group_by else "")
        sql = f"SELECT {', '.join(select)} FROM {table.fq_name}{joins}{where}{group}{having}{order_by} LIMIT {limit}"
    elif plan.template_id == "top_n_with_filter":
        select_columns = plan.select_list or table.primary_key or [column.name for column in table.columns if not column.pii][:8]
        select = [_safe_column(table, column) for column in select_columns]
        if plan.aggregations:
            select.extend(_render_aggregation(table, aggregation) for aggregation in plan.aggregations)
            group_by = ", ".join(select[: len(select_columns)])
            group = f" GROUP BY {group_by}"
            having = _render_having(table, plan.aggregations, plan.filters)
        else:
            group = ""
            having = ""
        order_by = _render_sort(plan.sort_by, table)
        sql = f"SELECT {', '.join(select)} FROM {table.fq_name}{joins}{where}{group}{having}{order_by} LIMIT {limit}"
    elif plan.template_id == "intersection_across_filters":
        key = _safe_column(table, (plan.group_by or table.primary_key or [table.columns[0].name])[0])
        filters = _filter_clauses(plan, table, concept_predicates)
        if len(filters) < 2:
            raise CompileError("intersection_across_filters requires at least two filters")
        sql = _compile_intersection(table, key, filters, limit)
    elif plan.template_id == "delta_year_over_year":
        key = _safe_column(table, (plan.group_by or table.primary_key or [table.columns[0].name])[0])
        amount = _safe_column(table, plan.aggregations[0].column if plan.aggregations else "amount")
        year_col = _year_column(table)
        years = sorted(_filter_years(plan.filters))
        if len(years) < 2:
            raise CompileError("delta_year_over_year requires two years")
        sql = _compile_delta(table, key, amount, year_col, years[-2], years[-1], where)
    else:
        raise CompileError(f"unsupported query template {plan.template_id!r}")

    normalized = normalize_sql(sql)
    query_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    query_name = f"analytical_q_{plan.template_id}_{query_hash[:8]}"
    return CompiledQuery(sql=normalized, query_hash=query_hash, query_name=query_name, caveats=list(dict.fromkeys(caveats)))


def normalize_sql(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _render_filters(
    plan: QueryPlan,
    table: TableSpec,
    concept_predicates: dict[str, str],
    *,
    skip_columns: set[str] | None = None,
) -> str:
    clauses = _filter_clauses(plan, table, concept_predicates, skip_columns=skip_columns or set())
    return f" WHERE {' AND '.join(clauses)}" if clauses else ""


def _filter_clauses(
    plan: QueryPlan,
    table: TableSpec,
    concept_predicates: dict[str, str],
    *,
    skip_columns: set[str] | None = None,
) -> list[str]:
    clauses: list[str] = []
    for spec in plan.filters:
        if spec.column in (skip_columns or set()):
            continue
        if spec.concept:
            predicate = concept_predicates.get(spec.concept)
            if predicate:
                clauses.append(f"({predicate})")
            continue
        if spec.column and spec.op:
            clauses.append(_render_column_filter(table, spec))
    return clauses


def _render_column_filter(table: TableSpec, spec: FilterSpec) -> str:
    column_spec = table.column(spec.column or "")
    column = _safe_column(table, spec.column or "")
    op = spec.op or "="
    if column_spec and column_spec.type == "date" and isinstance(spec.value, int) and op == "=":
        return f"EXTRACT(YEAR FROM {column})::int = {spec.value}"
    if op in {"IS NULL", "IS NOT NULL"}:
        return f"{column} {op}"
    if op == "IN":
        values = spec.value if isinstance(spec.value, list) else [spec.value]
        return f"{column} IN ({', '.join(_literal(value) for value in values)})"
    return f"{column} {op} {_literal(spec.value)}"


def _render_joins(plan: QueryPlan, table: TableSpec, catalog: SchemaCatalog) -> str:
    chunks: list[str] = []
    for join in plan.joins:
        target = _table(catalog, join.table)
        for left, right in join.on:
            _safe_column(table, left)
            _safe_column(target, right)
        clauses = " AND ".join(f"{table.fq_name}.{left} = {target.fq_name}.{right}" for left, right in join.on)
        chunks.append(f" {join.how.upper()} JOIN {target.fq_name} ON {clauses}")
    return "".join(chunks)


def _render_aggregation(table: TableSpec, aggregation: Aggregation) -> str:
    alias = _safe_identifier(aggregation.alias)
    if aggregation.fn == "count":
        return f"COUNT({_safe_column(table, aggregation.column)})::int AS {alias}"
    if aggregation.fn == "median":
        return f"PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {_safe_column(table, aggregation.column)}) AS {alias}"
    fn = {"sum": "SUM", "avg": "AVG", "min": "MIN", "max": "MAX", "p95": "PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY"}.get(aggregation.fn)
    if aggregation.fn == "p95":
        return f"{fn} {_safe_column(table, aggregation.column)}) AS {alias}"
    if fn is None:
        raise CompileError(f"unsupported aggregation {aggregation.fn}")
    return f"{fn}({_safe_column(table, aggregation.column)}) AS {alias}"


def _render_sort(sort_by: list[SortKey], table: TableSpec) -> str:
    if not sort_by:
        return ""
    parts = [f"{_safe_column(table, key.column)} {key.dir.upper()}" for key in sort_by]
    return f" ORDER BY {', '.join(parts)}"


def _render_having(table: TableSpec, aggregations: list[Aggregation], filters: list[FilterSpec]) -> str:
    # Threshold filters over aggregate aliases are represented by alias column names.
    alias_filters = [spec for spec in filters if spec.column in {aggregation.alias for aggregation in aggregations}]
    if not alias_filters:
        return ""
    clauses = [f"{_safe_identifier(str(spec.column))} {spec.op or '>'} {_literal(spec.value)}" for spec in alias_filters]
    return " HAVING " + " AND ".join(clauses)


def _compile_intersection(table: TableSpec, key: str, filters: list[str], limit: int) -> str:
    ctes = []
    for index, clause in enumerate(filters[:4], start=1):
        ctes.append(f"f{index} AS (SELECT DISTINCT {key} AS entity_key FROM {table.fq_name} WHERE {clause})")
    joins = " ".join(f"JOIN f{index} USING (entity_key)" for index in range(2, len(ctes) + 1))
    return f"WITH {', '.join(ctes)} SELECT COUNT(DISTINCT f1.entity_key)::int AS count FROM f1 {joins} LIMIT {min(limit, 1)}"


def _compile_delta(table: TableSpec, key: str, amount: str, year_col: str, baseline_year: int, comparison_year: int, where: str) -> str:
    extra = where.replace(" WHERE ", " AND ", 1) if where else ""
    return (
        f"WITH baseline AS (SELECT {key} AS entity_key, SUM({amount}) AS baseline_amount FROM {table.fq_name} "
        f"WHERE {year_col} = {baseline_year}{extra} GROUP BY {key}), "
        f"comparison AS (SELECT {key} AS entity_key, SUM({amount}) AS comparison_amount FROM {table.fq_name} "
        f"WHERE {year_col} = {comparison_year}{extra} GROUP BY {key}) "
        "SELECT COALESCE(comparison.entity_key, baseline.entity_key) AS entity_key, baseline_amount, comparison_amount, "
        "(comparison_amount - baseline_amount) AS delta_amount "
        "FROM baseline FULL OUTER JOIN comparison USING (entity_key) "
        "WHERE COALESCE(comparison_amount, 0) <> COALESCE(baseline_amount, 0) "
        "ORDER BY delta_amount DESC NULLS LAST LIMIT 1000"
    )


def _filter_years(filters: list[FilterSpec]) -> list[int]:
    years: list[int] = []
    for spec in filters:
        if spec.column and "year" in spec.column and isinstance(spec.value, int):
            years.append(spec.value)
    return years


def _year_column(table: TableSpec) -> str:
    for name in ("fiscal_year", "year", "period"):
        if table.column(name):
            return name
    for column in table.columns:
        if column.units == "fiscal_year":
            return column.name
    raise CompileError(f"{table.fq_name} has no year column")


def _table(catalog: SchemaCatalog, table_name: str) -> TableSpec:
    table = catalog.table(table_name)
    if table is None or not table.safe_for_analytical:
        raise CompileError(f"table {table_name!r} is not allowed")
    return table


def _safe_column(table: TableSpec, column_name: str) -> str:
    column = table.column(column_name)
    if column is None:
        raise CompileError(f"column {column_name!r} is not present on {table.fq_name}")
    if column.pii:
        raise CompileError(f"column {column_name!r} is marked PII")
    return _safe_identifier(column.name)


def _safe_identifier(value: str) -> str:
    if not IDENT_RE.match(value):
        raise CompileError(f"unsafe identifier {value!r}")
    return value


def _literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def query_plan_hash(plan: QueryPlan) -> str:
    return hashlib.sha256(json.dumps(json_ready(plan.model_dump(mode="json")), sort_keys=True).encode("utf-8")).hexdigest()[:16]
