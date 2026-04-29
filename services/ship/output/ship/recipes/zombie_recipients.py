"""Recipe: high government funding followed by stale CRA filings."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import funding_then_silent
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    min_govt_share: float = 0.7
    min_total_funding: float = 500_000
    last_filed_before: int = 2024


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    result = await funding_then_silent.run(
        pool,
        min_govt_share=params.min_govt_share,
        min_total_funding=params.min_amount or params.min_total_funding,
        last_filed_before=params.fiscal_year_max or params.last_filed_before,
        top_n=params.top_n,
        emit=emit,
    )
    return recipe_result(
        recipe_id="zombie_recipients",
        question=question,
        params=params,
        source_runs=[result],
        findings=result.rows,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
