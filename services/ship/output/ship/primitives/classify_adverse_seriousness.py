"""Classify one adverse signal for funder-relevance without adding facts."""

from __future__ import annotations

import json
from typing import Any, Literal

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, set_default_openai_key
from openai.types.shared import Reasoning

from .base import EmitCallback, StrictModel
from ..runtime_config import settings


SeriousnessLevel = Literal[
    "conviction",
    "pending_charge",
    "audit_finding",
    "regulatory_enforcement",
    "safety_incident",
    "fraud_allegation",
    "settlement",
    "noise",
]


class SeriousnessClass(StrictModel):
    level: SeriousnessLevel
    supports_funder_concern: bool
    rationale: str


def _agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Adverse Seriousness Classifier",
        model="gpt-5.5",
        output_type=AgentOutputSchema(SeriousnessClass, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="medium"),
            verbosity="low",
            max_tokens=1024,
            include_usage=True,
            prompt_cache_retention="24h",
        ),
        instructions=(
            "Classify the seriousness of an adverse signal about a named Canadian organization based on a single source. "
            "Use the strictest applicable level. supports_funder_concern is true only when the signal would reasonably concern a public-funder reviewing the recipient's record. "
            "Never mark a level above the source's language. Never add facts not in the snippet. "
            "Classify commentary, political disputes, ambiguous mentions, and weak reputational criticism as noise."
        ),
    )


async def classify(
    *,
    entity_name: str,
    source_url: str,
    snippet: str,
    emit: EmitCallback | None = None,
) -> SeriousnessClass:
    payload = {
        "entity_name": entity_name,
        "source_url": source_url,
        "snippet": snippet[:900],
    }
    if emit:
        await emit("primitive_started", {"primitive_name": "classify_adverse_seriousness", "args_summary": {"entity_name": entity_name, "source_url": source_url}})
    result = await Runner.run(_agent(), json.dumps(payload, ensure_ascii=False), max_turns=3)
    output = result.final_output
    if emit:
        await emit(
            "primitive_completed",
            {
                "primitive_name": "classify_adverse_seriousness",
                "row_count": 1,
                "caveats": ["Adverse seriousness is classified from a bounded source snippet."],
                "timing_ms": 0,
            },
        )
    return output
