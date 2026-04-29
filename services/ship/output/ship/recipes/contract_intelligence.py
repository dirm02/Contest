"""Recipe: contract spending trends plus concentration by available dimensions."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import concentration, trend
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    source: str = "ab_contracts"


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    conc = await concentration.run(
        pool,
        source="ab_contracts",
        ministry_filter=params.ministry_filter,
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        min_segment_amount=params.min_amount or 100_000,
        segment_limit=params.top_n,
        emit=emit,
    )
    tr = await trend.run(
        pool,
        source="ab_contracts",
        metric="amount",
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        keyword=params.category_keyword,
        periods=8,
        emit=emit,
    )
    return recipe_result(
        recipe_id="contract_intelligence",
        question=question,
        params=params,
        source_runs=[conc, tr],
        findings=conc.rows[: params.top_n] + [{**row, "finding_type": "contract_trend"} for row in tr.rows],
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
