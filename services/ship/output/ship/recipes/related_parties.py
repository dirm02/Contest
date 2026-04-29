"""Recipe: governance overlap and multi-organization funding leads."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import governance_overlap
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    min_orgs_per_director: int = 3
    fiscal_year_min: int | None = 2024


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    overlap = await governance_overlap.run(
        pool,
        min_orgs_per_director=params.min_orgs_per_director,
        fiscal_year_min=params.fiscal_year_min or 2023,
        top_n=params.top_n,
        emit=emit,
    )
    return recipe_result(
        recipe_id="related_parties",
        question=question,
        params=params,
        source_runs=[overlap],
        findings=overlap.rows,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
