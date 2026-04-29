"""Shared iterative analyst response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, TypeAlias

from pydantic import Field

from .primitives.base import StrictModel


Mode: TypeAlias = Literal["fresh", "refined", "composed", "conversational"]


class SortKey(StrictModel):
    column: str
    dir: Literal["asc", "desc"] = "asc"


class Aggregation(StrictModel):
    column: str
    fn: Literal["sum", "avg", "count", "min", "max", "median", "p95"]
    alias: str


class RecipeRunOp(StrictModel):
    kind: Literal["recipe_run"] = "recipe_run"
    recipe_id: str
    run_id: str
    description: str
    row_count: int
    timing_ms: int


class FilterOp(StrictModel):
    kind: Literal["filter"] = "filter"
    source_run_id: str
    description: str
    before_count: int
    after_count: int
    predicate: str


class ProjectOp(StrictModel):
    kind: Literal["project"] = "project"
    source_run_id: str
    description: str
    columns: list[str] = Field(default_factory=list)


class SortOp(StrictModel):
    kind: Literal["sort"] = "sort"
    source_run_id: str
    description: str
    sort_by: list[SortKey] = Field(default_factory=list)


class SliceOp(StrictModel):
    kind: Literal["slice"] = "slice"
    source_run_id: str
    description: str
    offset: int = 0
    limit: int


class AggregateOp(StrictModel):
    kind: Literal["aggregate"] = "aggregate"
    source_run_id: str
    description: str
    group_by: list[str] = Field(default_factory=list)
    aggregations: list[Aggregation] = Field(default_factory=list)


class JoinOp(StrictModel):
    kind: Literal["join"] = "join"
    left_run_id: str
    right_run_id: str
    description: str
    keys: list[str] = Field(default_factory=list)
    how: Literal["inner", "left", "outer"] = "inner"


class UnionOp(StrictModel):
    kind: Literal["union"] = "union"
    source_run_ids: list[str] = Field(default_factory=list)
    description: str


class IntersectOp(StrictModel):
    kind: Literal["intersect"] = "intersect"
    source_run_ids: list[str] = Field(default_factory=list)
    description: str


class CompareOp(StrictModel):
    kind: Literal["compare"] = "compare"
    baseline_run_id: str
    comparison_run_id: str
    description: str


class CommentaryOp(StrictModel):
    kind: Literal["commentary"] = "commentary"
    source_run_ids: list[str] = Field(default_factory=list)
    description: str


Operation: TypeAlias = (
    RecipeRunOp
    | FilterOp
    | ProjectOp
    | SortOp
    | SliceOp
    | AggregateOp
    | JoinOp
    | UnionOp
    | IntersectOp
    | CompareOp
    | CommentaryOp
)


class AnswerDiff(StrictModel):
    baseline_run_id: str
    rows_added: int = 0
    rows_removed: int = 0
    rows_changed: int = 0
    columns_added: list[str] = Field(default_factory=list)
    columns_removed: list[str] = Field(default_factory=list)


class MemoryEntry(StrictModel):
    run_id: str
    recipe_id: str | None = None
    derived_from_run_id: str | None = None
    description: str
    params_summary: str = ""
    row_count: int
    created_at: datetime
    pinned: bool = False
    forgotten: bool = False


def operation_source_run_ids(operation: Operation | dict[str, Any]) -> list[str]:
    payload = operation if isinstance(operation, dict) else operation.model_dump(mode="json")
    kind = payload.get("kind")
    if kind in {"filter", "project", "sort", "slice", "aggregate"}:
        return [str(payload["source_run_id"])] if payload.get("source_run_id") else []
    if kind in {"union", "intersect", "commentary"}:
        return [str(item) for item in payload.get("source_run_ids") or []]
    if kind == "join":
        return [str(payload["left_run_id"]), str(payload["right_run_id"])]
    if kind == "compare":
        return [str(payload["baseline_run_id"]), str(payload["comparison_run_id"])]
    return []
