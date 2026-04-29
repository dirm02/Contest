"""Recipe: find large circular charity funding flows."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import funding_cycles
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    min_total_amount: float = 100_000
    exclude_denominational: bool = True


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    cycles = await funding_cycles.run(
        pool,
        min_total_amount=params.min_amount or params.min_total_amount,
        exclude_denominational=params.exclude_denominational,
        top_n=params.top_n,
        emit=emit,
    )
    return recipe_result(
        recipe_id="funding_loops",
        question=question,
        params=params,
        source_runs=[cycles],
        findings=cycles.rows,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
