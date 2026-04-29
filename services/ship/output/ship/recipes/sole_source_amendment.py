"""Recipe: sole-source concentration and amendment signals."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import concentration, trend
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    min_segment_amount: float = 50_000


def humanize(params: dict) -> str:
    amount = params.get("min_amount") or params.get("min_segment_amount") or 50_000
    year = params.get("fiscal_year_min") or params.get("fiscal_year_max")
    suffix = f", FY{year}" if year else ""
    return f"Alberta sole-source contracts over ${amount:,.0f}{suffix}"


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    conc = await concentration.run(
        pool,
        source="ab_sole_source",
        ministry_filter=params.ministry_filter,
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        min_segment_amount=params.min_amount or params.min_segment_amount,
        segment_limit=params.top_n,
        emit=emit,
    )
    tr = await trend.run(
        pool,
        source="ab_sole_source",
        metric="amount",
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        keyword=params.category_keyword,
        periods=8,
        emit=emit,
    )
    return recipe_result(
        recipe_id="sole_source_amendment",
        question=question,
        params=params,
        source_runs=[conc, tr],
        findings=conc.rows[: params.top_n] + [{**row, "finding_type": "sole_source_trend"} for row in tr.rows],
        latency_ms=int((time.perf_counter() - started) * 1000),
        caveats=["The Alberta sole-source table contains contract start/end dates and contract numbers, but not a full amendment lifecycle table."],
    )
