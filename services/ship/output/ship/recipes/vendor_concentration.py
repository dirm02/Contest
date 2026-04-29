"""Recipe: vendor or recipient concentration across public spending sources."""

from __future__ import annotations

import time
from typing import Literal

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import concentration, multi_year_incumbency
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    source: Literal["ab_contracts", "ab_sole_source", "ab_grants", "fed_grants", "all"] = "all"
    min_segment_amount: float = 100_000


def humanize(params: dict) -> str:
    source = params.get("source") or "all"
    year_min = params.get("fiscal_year_min")
    year_max = params.get("fiscal_year_max")
    years = f", FY{year_min}-{year_max}" if year_min and year_max else ""
    return f"Vendor concentration for {source}{years}"


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    concentration_result = await concentration.run(
        pool,
        source=params.source,
        ministry_filter=params.ministry_filter,
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        min_segment_amount=params.min_amount or params.min_segment_amount,
        segment_limit=params.top_n,
        emit=emit,
    )
    incumbency_result = await multi_year_incumbency.run(
        pool,
        source="ab_sole_source" if params.source in {"all", "ab_sole_source"} else "ab_contracts",
        ministry_filter=params.ministry_filter,
        top_n=params.top_n,
        emit=emit,
    )
    findings = concentration_result.rows[: params.top_n] + [
        {**row, "finding_type": "multi_year_incumbency"} for row in incumbency_result.rows[: max(5, params.top_n // 2)]
    ]
    return recipe_result(
        recipe_id="vendor_concentration",
        question=question,
        params=params,
        source_runs=[concentration_result, incumbency_result],
        findings=findings,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
