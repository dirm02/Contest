"""Shared recipe result shapes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from ..primitives.base import PrimitiveResult, SQLLogEntry, StrictModel


class RecipeParams(StrictModel):
    scope: Literal["alberta", "federal", "cra", "all"] | None = None
    fiscal_year_min: int | None = None
    fiscal_year_max: int | None = None
    ministry_filter: str | None = None
    category_keyword: str | None = None
    min_amount: float | None = None
    top_n: int = 20


class RecipeResult(StrictModel):
    recipe_id: str
    question: str
    params: dict[str, Any] = Field(default_factory=dict)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    sql_log: list[SQLLogEntry] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    source_runs: list[PrimitiveResult] = Field(default_factory=list)
    latency_ms: int = 0


def recipe_result(
    *,
    recipe_id: str,
    question: str,
    params: RecipeParams,
    source_runs: list[PrimitiveResult],
    findings: list[dict[str, Any]],
    latency_ms: int,
    caveats: list[str] | None = None,
) -> RecipeResult:
    sql_log: list[SQLLogEntry] = []
    all_caveats: list[str] = []
    for run in source_runs:
        sql_log.extend(run.sql_log)
        all_caveats.extend(run.caveats)
    all_caveats.extend(caveats or [])
    return RecipeResult(
        recipe_id=recipe_id,
        question=question,
        params=params.model_dump(mode="json"),
        findings=findings,
        sql_log=sql_log,
        caveats=list(dict.fromkeys(item for item in all_caveats if item)),
        source_runs=source_runs,
        latency_ms=latency_ms,
    )

