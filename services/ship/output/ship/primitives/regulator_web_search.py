"""Bounded regulator/court web corroboration for adverse-media style questions."""

from __future__ import annotations

import json
import time
from typing import Any

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, WebSearchTool, set_default_openai_key
from openai.types.shared import Reasoning
from pydantic import Field

from .base import EmitCallback, PrimitiveResult, StrictModel, emit_primitive_completed, emit_primitive_started
from ..runtime_config import settings


class WebFinding(StrictModel):
    entity_name: str
    source_url: str
    source_kind: str
    title: str
    snippet: str


class WebFindings(StrictModel):
    findings: list[WebFinding] = Field(default_factory=list)


def _agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Regulator Web Search",
        model="gpt-5.5",
        tools=[WebSearchTool(search_context_size="high", external_web_access=True)],
        output_type=AgentOutputSchema(WebFindings, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="medium"),
            verbosity="low",
            max_tokens=4096,
            include_usage=True,
            prompt_cache_retention="24h",
            parallel_tool_calls=False,
        ),
        instructions=(
            "Find grounded regulator, court, sanction, audit, or enforcement web sources for the named Canadian public-accountability entity. "
            "Use only https URLs. Prefer official regulator, court, government, audit, or sanction domains. "
            "Return at most 3 findings. Do not include self-published promotion, commentary without a factual proceeding, or unrelated name collisions. "
            "Do not cite search pages, login pages, generic history tabs, or CanLII URLs; cite direct official document or decision pages that should resolve for an external reader. "
            "Each snippet must contain the entity name or an unambiguous alias plus the enforcement/regulatory fact."
        ),
    )


def _usable_url(url: str) -> bool:
    lowered = url.lower()
    blocked_fragments = (
        "canlii.org",
        "judgmenttabs/history",
        "/search/",
        "login",
    )
    return lowered.startswith("https://") and not any(fragment in lowered for fragment in blocked_fragments)


async def run(
    *,
    entity_name: str,
    source_kinds: list[str] | None = None,
    max_searches: int = 2,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    bounded_searches = max(1, min(int(max_searches), 2))
    await emit_primitive_started(
        emit,
        "regulator_web_search",
        {"entity_name": entity_name, "source_kinds": source_kinds or ["regulator", "court", "sanction"], "max_searches": bounded_searches},
    )
    payload = {
        "entity_name": entity_name,
        "source_kinds": source_kinds or ["regulator", "court", "sanction"],
        "max_searches": bounded_searches,
        "query_guidance": [
            f"site:canlii.org {entity_name}",
            f"site:canada.ca {entity_name} enforcement OR audit OR sanction",
        ],
    }
    query_label = "; ".join(payload["query_guidance"])
    if emit:
        await emit("web_search_started", {"primitive_name": "regulator_web_search", "query": query_label})
    result = await Runner.run(_agent(), json.dumps(payload), max_turns=bounded_searches)
    findings = [
        item.model_dump(mode="json")
        for item in result.final_output.findings
        if _usable_url(item.source_url)
    ][:3]
    timing_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit(
            "web_search_completed",
            {"primitive_name": "regulator_web_search", "query": query_label, "result_count": len(findings), "timing_ms": timing_ms},
        )
    primitive_result = PrimitiveResult(
        primitive_name="regulator_web_search",
        rows=findings,
        sql_log=[],
        caveats=["Web corroboration is bounded to at most two search turns and three official/regulatory-style source findings per entity."],
        timing_ms=timing_ms,
    )
    await emit_primitive_completed(emit, primitive_result)
    return primitive_result
