"""LLM router: natural-language question to recipe decision plus parameters."""

from __future__ import annotations

import json
from typing import Any, Literal

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, set_default_openai_key
from openai.types.shared import Reasoning
from pydantic import Field

from .primitives.base import StrictModel
from .recipes.catalog import RECIPES, catalog_for_prompt
from .runtime_config import settings


class RouterDecision(StrictModel):
    decision: Literal["execute", "refine", "clarify", "needs_new_conversation", "not_answerable"] = "execute"
    recipe_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    confidence: Literal["high", "medium", "low"] = "low"
    refinement_filter: dict[str, Any] | None = None
    clarification: "ClarificationPayload | None" = None
    new_conversation_hint: "NewConversationHint | None" = None
    reasoning_one_line: str
    not_answerable_reason: str | None = None


class ClarificationPayload(StrictModel):
    headline: str
    reason: str
    suggested_narrowings: list[str] = Field(default_factory=list)
    example_refinements: list[str] = Field(default_factory=list)
    proceed_phrase: str = "run the broad scan anyway"


class NewConversationHint(StrictModel):
    reason: str
    suggested_starter: str
    current_conversation_topic: str | None = None


def _agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Ship Router",
        model="gpt-5.5",
        output_type=AgentOutputSchema(RouterDecision, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="medium"),
            verbosity="low",
            max_tokens=2048,
            include_usage=True,
            prompt_cache_retention="24h",
        ),
        instructions=(
            "You route Canadian public-accountability questions for a stateful deterministic analyst service. "
            "Return one decision: execute, refine, clarify, needs_new_conversation, or not_answerable. "
            "For a first investigation, choose exactly one recipe_id from the catalog or not_answerable if none applies. "
            "Extract only parameters explicitly stated or safely implied by the question. "
            "Never invent organizations, URLs, dollar amounts, or source rows. "
            "Loose wording may map to documented proxies: category/service -> category_keyword, Alberta/federal/all -> scope, years -> fiscal_year_min/fiscal_year_max. "
            "All scope values must be lowercase ('alberta', 'federal', 'cra', 'all'). Never capitalize them. "
            "If a recent_recipe_run is present and the new message asks only to filter, sort, or inspect those cached finding rows, return decision='refine' with a refinement_filter. "
            "If a recent_recipe_run is present and the new message asks for fresh SQL, fresh web search, a new entity, or a different recipe, return decision='needs_new_conversation' with a friendly new_conversation_hint. "
            "For first-turn expensive recipes where requires_specificity=true, return decision='clarify' unless the question includes a named organization, top-N bound, time window, province/source/dimension restriction, or amount threshold. "
            "If the user says the proceed phrase or clearly asks to run the broad scan anyway, execute with bounded default params. "
            "For refine filters, use columns that appear in finding_columns or sample rows. Common amount columns include total_funding_known, total_all_funding, total_flow, total_amount, amount, and combined_funding. "
            "Return only structured RouterDecision."
        ),
    )


async def route(question: str, *, conversation_context: dict[str, Any] | None = None) -> RouterDecision:
    payload = {
        "question": question,
        "recipes": catalog_for_prompt(),
        "recent_recipe_run": conversation_context,
    }
    result = await Runner.run(_agent(), json.dumps(payload, ensure_ascii=False), max_turns=1)
    decision = result.final_output
    if decision.recipe_id is not None and decision.recipe_id not in RECIPES:
        return RouterDecision(
            decision="not_answerable",
            recipe_id=None,
            params={},
            confidence="low",
            reasoning_one_line=f"Router returned unknown recipe {decision.recipe_id!r}.",
            not_answerable_reason="No registered deterministic recipe can answer this question yet.",
        )
    return decision
