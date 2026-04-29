"""Deterministic in-process refinement and composition over cached findings."""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import asyncpg

from .classifier import PlannedOperation
from .diff import _row_key
from .predicate_parser import PredicateParseError, parse_predicate
from .primitives.base import json_ready
from .responses import (
    AggregateOp,
    CommentaryOp,
    CompareOp,
    FilterOp,
    IntersectOp,
    JoinOp,
    Operation,
    ProjectOp,
    SliceOp,
    SortKey,
    SortOp,
    UnionOp,
)


REFINEMENT_KINDS = {"filter", "project", "sort", "slice", "aggregate"}
COMPOSITION_KINDS = {"join", "union", "intersect", "compare"}
NUMERIC_COLUMNS = (
    "total_funding_known",
    "total_government_funding",
    "total_all_funding",
    "total_flow",
    "total_amount",
    "agreement_value",
    "amount",
    "combined_funding",
    "segment_total_amount",
    "metric_value",
    "count",
)


@dataclass
class LoadedRun:
    run_id: str
    recipe_id: str
    params: dict[str, Any]
    findings: list[dict[str, Any]]
    sql_log: list[dict[str, Any]]
    summary: dict[str, Any] | None = None
    created_at: str | None = None


@dataclass
class RefinementResult:
    findings: list[dict[str, Any]]
    op_record: Operation
    recipe_id: str
    params: dict[str, Any]
    source_run_ids: list[str]
    based_on_run_id: str | None
    op_hash: str
    caveats: list[str] = field(default_factory=list)
    timing_ms: int = 0
    cached_run_id: str | None = None
    sql_log: list[dict[str, Any]] = field(default_factory=list)


class RunRegistry:
    """Loads persisted ship run rows and caches decoded findings per process."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self._cache: dict[str, LoadedRun] = {}

    async def load(self, run_id: str) -> LoadedRun:
        if run_id in self._cache:
            return self._cache[run_id]
        row = await self.pool.fetchrow(
            """
SELECT run_id, recipe_id, params, findings, sql_log, summary, created_at
FROM investigator.ship_recipe_runs
WHERE run_id = $1
""".strip(),
            UUID(run_id),
        )
        if row is None:
            raise ValueError(f"recipe_run {run_id} not found")
        payload = _record_to_json(row)
        loaded = LoadedRun(
            run_id=str(payload["run_id"]),
            recipe_id=str(payload["recipe_id"]),
            params=dict(payload.get("params") or {}),
            findings=list(payload.get("findings") or []),
            sql_log=list(payload.get("sql_log") or []),
            summary=payload.get("summary"),
            created_at=payload.get("created_at"),
        )
        self._cache[run_id] = loaded
        return loaded


class Refiner:
    """Executes operation plans against cached findings."""

    def __init__(self, registry: RunRegistry) -> None:
        self.registry = registry

    async def execute(self, op: PlannedOperation) -> RefinementResult:
        started = time.perf_counter()
        if op.kind == "filter":
            result = await self._filter(op)
        elif op.kind == "project":
            result = await self._project(op)
        elif op.kind == "sort":
            result = await self._sort(op)
        elif op.kind == "slice":
            result = await self._slice(op)
        elif op.kind == "aggregate":
            result = await self._aggregate(op)
        elif op.kind == "join":
            result = await self._join(op)
        elif op.kind == "union":
            result = await self._union(op)
        elif op.kind == "intersect":
            result = await self._intersect(op)
        elif op.kind == "compare":
            result = await self._compare(op)
        elif op.kind == "commentary":
            result = await self._commentary(op)
        else:
            raise ValueError(f"unsupported refinement operation {op.kind!r}")
        result.timing_ms = int((time.perf_counter() - started) * 1000)
        return result

    async def _filter(self, op: PlannedOperation) -> RefinementResult:
        run = await self.registry.load(_required(op.source_run_id, "source_run_id"))
        predicate = op.predicate or "true"
        caveats: list[str] = []
        try:
            parsed = parse_predicate(predicate, _columns(run.findings))
            findings = [row for row in run.findings if parsed.evaluate(row)]
            normalized = parsed.normalized
        except PredicateParseError as exc:
            findings = run.findings
            normalized = predicate
            caveats.append(f"The requested filter could not be applied safely: {exc}. The source run was left unchanged.")
        op_record = FilterOp(
            source_run_id=run.run_id,
            description=op.description,
            before_count=len(run.findings),
            after_count=len(findings),
            predicate=normalized,
        )
        return self._result(op, findings, op_record, [run], caveats=caveats)

    async def _project(self, op: PlannedOperation) -> RefinementResult:
        run = await self.registry.load(_required(op.source_run_id, "source_run_id"))
        available = set(_columns(run.findings))
        columns = [column for column in (op.columns or []) if column in available]
        caveats = [] if columns else ["No requested projection columns were present; the source rows were left unchanged."]
        findings = [{column: row.get(column) for column in columns} for row in run.findings] if columns else run.findings
        op_record = ProjectOp(source_run_id=run.run_id, description=op.description, columns=columns or _columns(run.findings))
        return self._result(op, findings, op_record, [run], caveats=caveats)

    async def _sort(self, op: PlannedOperation) -> RefinementResult:
        run = await self.registry.load(_required(op.source_run_id, "source_run_id"))
        sort_by = op.sort_by or [SortKey(column=_best_numeric_column(run.findings) or _columns(run.findings)[0], dir="desc")]
        findings = list(run.findings)
        for sort_key in reversed(sort_by):
            findings.sort(key=lambda row, column=sort_key.column: _sort_value(row.get(column)), reverse=sort_key.dir == "desc")
        op_record = SortOp(source_run_id=run.run_id, description=op.description, sort_by=sort_by)
        return self._result(op, findings, op_record, [run])

    async def _slice(self, op: PlannedOperation) -> RefinementResult:
        run = await self.registry.load(_required(op.source_run_id, "source_run_id"))
        offset = max(0, int(op.offset or 0))
        limit = min(max(1, int(op.limit or 25)), 1000)
        findings = run.findings[offset : offset + limit]
        op_record = SliceOp(source_run_id=run.run_id, description=op.description, offset=offset, limit=limit)
        return self._result(op, findings, op_record, [run])

    async def _aggregate(self, op: PlannedOperation) -> RefinementResult:
        run = await self.registry.load(_required(op.source_run_id, "source_run_id"))
        group_by = op.group_by or [_columns(run.findings)[0]]
        aggregations = op.aggregations or []
        if not aggregations:
            aggregations = []
        buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        for row in run.findings:
            key = tuple(row.get(column) for column in group_by)
            buckets.setdefault(key, []).append(row)
        findings: list[dict[str, Any]] = []
        for key, rows in buckets.items():
            out = {column: key[index] for index, column in enumerate(group_by)}
            if not aggregations:
                out["count"] = len(rows)
            for aggregation in aggregations:
                values = [_to_number(row.get(aggregation.column)) for row in rows]
                nums = [value for value in values if value is not None]
                out[aggregation.alias] = _aggregate_values(nums, aggregation.fn)
            findings.append(out)
        op_record = AggregateOp(source_run_id=run.run_id, description=op.description, group_by=group_by, aggregations=aggregations)
        return self._result(op, findings, op_record, [run])

    async def _join(self, op: PlannedOperation) -> RefinementResult:
        left = await self.registry.load(_required(op.left_run_id, "left_run_id"))
        right_id = op.right_run_id or (op.source_run_ids[0] if op.source_run_ids else None)
        right = await self.registry.load(_required(right_id, "right_run_id"))
        keys = op.keys or _default_join_keys(left.findings, right.findings)
        right_index: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        for row in right.findings:
            right_index.setdefault(tuple(row.get(key) for key in keys), []).append(row)
        findings: list[dict[str, Any]] = []
        for left_row in left.findings:
            key = tuple(left_row.get(column) for column in keys)
            matches = right_index.get(key, [])
            if matches:
                for right_row in matches:
                    findings.append(_merge_rows(left_row, right_row))
            elif op.how in {"left", "outer"}:
                findings.append(dict(left_row))
        if op.how == "outer":
            left_keys = {tuple(row.get(column) for column in keys) for row in left.findings}
            for right_row in right.findings:
                if tuple(right_row.get(column) for column in keys) not in left_keys:
                    findings.append({f"right_{key}": value for key, value in right_row.items()})
        op_record = JoinOp(left_run_id=left.run_id, right_run_id=right.run_id, description=op.description, keys=keys, how=op.how or "inner")
        return self._result(op, findings, op_record, [left, right])

    async def _union(self, op: PlannedOperation) -> RefinementResult:
        runs = [await self.registry.load(run_id) for run_id in op.source_run_ids]
        if len(runs) < 2:
            raise ValueError("union requires at least two source runs")
        columns = [set(_columns(run.findings)) for run in runs]
        if len({tuple(sorted(item)) for item in columns}) != 1:
            caveats = ["Union could not align mismatched columns; returning the first source run unchanged."]
            findings = runs[0].findings
        else:
            seen: set[str] = set()
            findings = []
            caveats = []
            for run in runs:
                for row in run.findings:
                    digest = json.dumps(json_ready(row), sort_keys=True, ensure_ascii=False)
                    if digest not in seen:
                        seen.add(digest)
                        findings.append(row)
        op_record = UnionOp(source_run_ids=[run.run_id for run in runs], description=op.description)
        return self._result(op, findings, op_record, runs, caveats=caveats)

    async def _intersect(self, op: PlannedOperation) -> RefinementResult:
        runs = [await self.registry.load(run_id) for run_id in op.source_run_ids]
        if len(runs) < 2:
            raise ValueError("intersect requires at least two source runs")
        common = set(_row_key(row) for row in runs[0].findings)
        for run in runs[1:]:
            common &= {_row_key(row) for row in run.findings}
        findings = [row for row in runs[0].findings if _row_key(row) in common]
        op_record = IntersectOp(source_run_ids=[run.run_id for run in runs], description=op.description)
        return self._result(op, findings, op_record, runs)

    async def _compare(self, op: PlannedOperation) -> RefinementResult:
        baseline = await self.registry.load(_required(op.baseline_run_id, "baseline_run_id"))
        comparison = await self.registry.load(_required(op.comparison_run_id, "comparison_run_id"))
        base = {_row_key(row): row for row in baseline.findings}
        comp = {_row_key(row): row for row in comparison.findings}
        findings: list[dict[str, Any]] = []
        for key in sorted(set(base) | set(comp)):
            if key not in base:
                findings.append({"_status": "added", "_stable_key": key, **comp[key]})
            elif key not in comp:
                findings.append({"_status": "removed", "_stable_key": key, **base[key]})
            elif json_ready(base[key]) != json_ready(comp[key]):
                findings.append({"_status": "changed", "_stable_key": key, "baseline": base[key], "comparison": comp[key]})
            else:
                findings.append({"_status": "same", "_stable_key": key, **comp[key]})
        op_record = CompareOp(baseline_run_id=baseline.run_id, comparison_run_id=comparison.run_id, description=op.description)
        return self._result(op, findings, op_record, [baseline, comparison])

    async def _commentary(self, op: PlannedOperation) -> RefinementResult:
        runs = [await self.registry.load(run_id) for run_id in op.source_run_ids]
        findings = runs[0].findings if runs else []
        op_record = CommentaryOp(source_run_ids=[run.run_id for run in runs], description=op.description)
        return self._result(op, findings, op_record, runs)

    def _result(
        self,
        planned: PlannedOperation,
        findings: list[dict[str, Any]],
        op_record: Operation,
        source_runs: list[LoadedRun],
        *,
        caveats: list[str] | None = None,
    ) -> RefinementResult:
        source_ids = [run.run_id for run in source_runs]
        primary = source_runs[0] if source_runs else None
        params = {
            "_derived_operation": op_record.model_dump(mode="json"),
            "_source_run_ids": source_ids,
            "_op_hash": operation_hash(planned, source_ids),
        }
        return RefinementResult(
            findings=findings,
            op_record=op_record,
            recipe_id=f"__derived__:{planned.kind}",
            params=params,
            source_run_ids=source_ids,
            based_on_run_id=primary.run_id if primary else None,
            op_hash=params["_op_hash"],
            caveats=caveats or [],
        )


async def find_cached_derived_run(pool: asyncpg.Pool, conversation_id: UUID, op_hash: str, source_run_ids: list[str]) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        """
SELECT run_id, recipe_id, params, findings, sql_log, summary, verification, latency_ms
FROM investigator.ship_recipe_runs
WHERE conversation_id = $1
  AND is_derived
  AND op_hash = $2
  AND source_run_ids = $3::jsonb
ORDER BY created_at DESC
LIMIT 1
""".strip(),
        conversation_id,
        op_hash,
        json.dumps(source_run_ids),
    )
    return _record_to_json(row) if row else None


def operation_hash(op: PlannedOperation | dict[str, Any], source_run_ids: list[str] | None = None) -> str:
    payload = op if isinstance(op, dict) else op.model_dump(mode="json")
    body = {
        "kind": payload.get("kind"),
        "source_run_ids": source_run_ids or _planned_source_ids(payload),
        "params": {key: value for key, value in payload.items() if key not in {"description"}},
    }
    return hashlib.sha256(json.dumps(json_ready(body), sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def infer_refinement_filter(message: str, findings: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Backward-compatible helper retained for older tests/imports."""
    text = message.lower()
    detail = re.search(r"(?:row|finding)\s*#?\s*(\d+)", text)
    if detail:
        return {"operation": "detail", "finding_index": max(0, int(detail.group(1)) - 1)}
    amount = re.search(r"(?:above|over|greater than|at least|>=?)\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kmb])?", text)
    if amount:
        column = _best_numeric_column(findings)
        if column:
            return {"operation": "filter", "column": column, "operator": ">=", "value": _scale_amount(float(amount.group(1).replace(",", "")), amount.group(2))}
    if "sort" in text or "largest" in text or "highest" in text:
        column = _best_numeric_column(findings)
        if column:
            return {"operation": "sort", "column": column, "direction": "desc"}
    return None


def apply_refinement(findings: list[dict[str, Any]], refinement: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Backward-compatible synchronous refinement helper."""
    if not refinement:
        return findings
    operation = str(refinement.get("operation") or "").lower()
    if operation == "detail":
        index = int(refinement.get("finding_index") or 0)
        return [findings[index]] if 0 <= index < len(findings) else []
    if operation == "sort":
        column = str(refinement.get("column") or _best_numeric_column(findings) or "")
        return sorted(findings, key=lambda row: _sort_value(row.get(column)), reverse=str(refinement.get("direction") or "desc") != "asc")
    if operation == "filter":
        column = str(refinement.get("column") or "")
        operator = str(refinement.get("operator") or "=")
        value = refinement.get("value")
        return [row for row in findings if _compare(row.get(column), operator, value)] if column else findings
    return findings


def refinement_description(refinement: dict[str, Any] | None) -> str:
    if not refinement:
        return "refined from cached findings"
    operation = refinement.get("operation")
    if operation == "filter":
        return f"filtered cached findings where {refinement.get('column')} {refinement.get('operator')} {refinement.get('value')}"
    if operation == "sort":
        return f"sorted cached findings by {refinement.get('column')} {refinement.get('direction', 'desc')}"
    if operation == "detail":
        return "selected detail from cached findings"
    return "refined from cached findings"


def _planned_source_ids(payload: dict[str, Any]) -> list[str]:
    ids = []
    for key in ("source_run_id", "left_run_id", "right_run_id", "baseline_run_id", "comparison_run_id"):
        if payload.get(key):
            ids.append(str(payload[key]))
    ids.extend(str(item) for item in payload.get("source_run_ids") or [])
    return ids


def _columns(rows: list[dict[str, Any]]) -> list[str]:
    seen: list[str] = []
    for row in rows[:50]:
        for key in row:
            if str(key) not in seen:
                seen.append(str(key))
    return seen or ["value"]


def _best_numeric_column(findings: list[dict[str, Any]]) -> str | None:
    for column in NUMERIC_COLUMNS:
        if any(_to_number(row.get(column)) is not None for row in findings):
            return column
    for row in findings:
        for key, value in row.items():
            if _to_number(value) is not None:
                return str(key)
    return None


def _default_join_keys(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> list[str]:
    left_columns = set(_columns(left))
    right_columns = set(_columns(right))
    for key in ("canonical_name", "entity_id", "recipient", "supplier_name", "recipient_legal_name"):
        if key in left_columns and key in right_columns:
            return [key]
    common = sorted(left_columns & right_columns)
    return common[:1] or ["_stable_key"]


def _merge_rows(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    out = dict(left)
    for key, value in right.items():
        out[key if key not in out else f"right_{key}"] = value
    return out


def _aggregate_values(values: list[float], fn: str) -> float | int | None:
    if fn == "count":
        return len(values)
    if not values:
        return None
    ordered = sorted(values)
    if fn == "sum":
        return sum(values)
    if fn == "avg":
        return sum(values) / len(values)
    if fn == "min":
        return min(values)
    if fn == "max":
        return max(values)
    if fn == "median":
        mid = len(ordered) // 2
        return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    if fn == "p95":
        return ordered[min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))]
    return None


def _compare(raw: Any, operator: str, expected: Any) -> bool:
    actual_number = _to_number(raw)
    expected_number = _to_number(expected)
    if actual_number is not None and expected_number is not None:
        if operator in {">=", "=>"}:
            return actual_number >= expected_number
        if operator == ">":
            return actual_number > expected_number
        if operator in {"<=", "=<"}:
            return actual_number <= expected_number
        if operator == "<":
            return actual_number < expected_number
        if operator in {"!=", "<>"}:
            return actual_number != expected_number
        return actual_number == expected_number
    actual = str(raw or "").lower()
    expected_text = str(expected or "").lower()
    if operator in {"contains", "~"}:
        return expected_text in actual
    if operator in {"!=", "<>"}:
        return actual != expected_text
    return actual == expected_text


def _sort_value(raw: Any) -> tuple[int, Any]:
    number = _to_number(raw)
    if number is not None:
        return (1, number)
    return (0, str(raw or ""))


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "").rstrip("%"))
        except ValueError:
            return None
    return None


def _scale_amount(value: float, suffix: str | None) -> float:
    suffix = (suffix or "").lower()
    if suffix == "k":
        return value * 1_000
    if suffix == "m":
        return value * 1_000_000
    if suffix == "b":
        return value * 1_000_000_000
    return value


def _required(value: str | None, field_name: str) -> str:
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _record_to_json(row: asyncpg.Record | None) -> dict[str, Any]:
    if row is None:
        return {}
    payload = json_ready(dict(row))
    for key, value in list(payload.items()):
        if isinstance(value, UUID):
            payload[key] = str(value)
        elif isinstance(value, str) and value[:1] in {"{", "["}:
            payload[key] = json.loads(value)
    return payload
