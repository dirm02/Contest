"""Recipe: coverage audit plus keyword spending trend for policy-alignment questions."""

from __future__ import annotations

import time

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import coverage_audit, trend
from ..primitives.base import EmitCallback


class Params(RecipeParams):
    policy_keyword: str | None = None


def humanize(params: dict) -> str:
    keyword = params.get("policy_keyword") or params.get("category_keyword") or "policy"
    return f"Policy-spending coverage for {keyword}"


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    keyword = params.policy_keyword or params.category_keyword
    coverage = await coverage_audit.run(
        pool,
        source_families=[params.scope] if params.scope else ["ab", "fed", "cra"],
        expected_fields_per_obligation={
            "policy_spending": ["program", "description", "agreement_title_en", "contract_services", "amount", "agreement_value"],
        },
        emit=emit,
    )
    source = "fed_grants" if params.scope == "federal" else "ab_grants"
    tr = await trend.run(
        pool,
        source=source,
        metric="amount",
        fiscal_year_min=params.fiscal_year_min,
        fiscal_year_max=params.fiscal_year_max,
        keyword=keyword,
        periods=8,
        emit=emit,
    )
    return recipe_result(
        recipe_id="policy_misalignment",
        question=question,
        params=params,
        source_runs=[coverage, tr],
        findings=[{**row, "finding_type": "policy_spending_trend"} for row in tr.rows] + [
            {**row, "finding_type": "coverage_audit"} for row in coverage.rows
        ],
        latency_ms=int((time.perf_counter() - started) * 1000),
        caveats=["The loaded database contains spending descriptions and program labels, not authoritative policy target benchmarks."],
    )
