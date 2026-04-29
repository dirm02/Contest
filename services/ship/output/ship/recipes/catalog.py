"""Recipe registry and parameter coercion."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, get_args, get_origin

from .base import RecipeParams, RecipeResult
from . import (
    adverse_media,
    contract_intelligence,
    duplicative_funding,
    funding_loops,
    ghost_capacity,
    policy_misalignment,
    related_parties,
    sole_source_amendment,
    vendor_concentration,
    zombie_recipients,
)


RecipeRunner = Callable[..., Awaitable[RecipeResult]]
REQUIRES_SPECIFICITY = frozenset({"adverse_media", "related_parties", "policy_misalignment"})


@dataclass(frozen=True)
class RecipeSpec:
    recipe_id: str
    description: str
    params_model: type[RecipeParams]
    run: RecipeRunner
    examples: tuple[str, ...]


RECIPES: dict[str, RecipeSpec] = {
    "funding_loops": RecipeSpec(
        "funding_loops",
        "Find large circular qualified-donee charity gift-flow cycles using pre-computed CRA loop tables.",
        funding_loops.Params,
        funding_loops.run,
        ("What loops exist between Alberta charities?", "Show the largest charity funding cycles."),
    ),
    "zombie_recipients": RecipeSpec(
        "zombie_recipients",
        "Find charities with high government funding share that have not filed recent CRA returns.",
        zombie_recipients.Params,
        zombie_recipients.run,
        ("Which charities had government funding above 70% and stopped filing?",),
    ),
    "ghost_capacity": RecipeSpec(
        "ghost_capacity",
        "Find charities with high overhead or administration signals and zero reported compensated staff.",
        ghost_capacity.Params,
        ghost_capacity.run,
        ("Which charities have high overhead but no staff?",),
    ),
    "duplicative_funding": RecipeSpec(
        "duplicative_funding",
        "Find canonical entities with funding recorded across multiple public source families.",
        duplicative_funding.Params,
        duplicative_funding.run,
        ("Which organizations receive both federal and Alberta funding?",),
    ),
    "vendor_concentration": RecipeSpec(
        "vendor_concentration",
        "Compute HHI, CR1, CR3, and supplier shares for Alberta/Federal spending concentration plus incumbency.",
        vendor_concentration.Params,
        vendor_concentration.run,
        ("How concentrated is health spending in Alberta?", "Which vendors dominate sole-source contracts?"),
    ),
    "sole_source_amendment": RecipeSpec(
        "sole_source_amendment",
        "Analyze sole-source spending concentration and year-over-year amount trends.",
        sole_source_amendment.Params,
        sole_source_amendment.run,
        ("Show me the largest sole-source contract concentration in 2024.",),
    ),
    "contract_intelligence": RecipeSpec(
        "contract_intelligence",
        "Analyze contract spending trends and concentration using available Alberta contract dimensions.",
        contract_intelligence.Params,
        contract_intelligence.run,
        ("What contract categories are growing fastest?",),
    ),
    "related_parties": RecipeSpec(
        "related_parties",
        "Find normalized CRA director names connected to multiple funded organizations.",
        related_parties.Params,
        related_parties.run,
        ("Are there directors who sit on multiple funded charity boards?",),
    ),
    "policy_misalignment": RecipeSpec(
        "policy_misalignment",
        "Audit available policy/spending fields and trend spending by a policy keyword or proxy concept.",
        policy_misalignment.Params,
        policy_misalignment.run,
        ("How much climate-related grant spending is visible over time?",),
    ),
    "adverse_media": RecipeSpec(
        "adverse_media",
        "Discover serious adverse public signals first, then match named organizations to public-funding records and separate public-system oversight from external recipients.",
        adverse_media.Params,
        adverse_media.run,
        ("Which organizations receiving public funding are the subject of serious adverse media coverage?",),
    ),
}


def catalog_for_prompt() -> list[dict[str, Any]]:
    return [
        {
            "recipe_id": spec.recipe_id,
            "description": spec.description,
            "params": sorted(spec.params_model.model_fields),
            "examples": list(spec.examples),
            "requires_specificity": spec.recipe_id in REQUIRES_SPECIFICITY,
        }
        for spec in RECIPES.values()
    ]


def coerce_params(recipe_id: str, raw: dict[str, Any] | None) -> RecipeParams:
    spec = RECIPES[recipe_id]
    allowed = set(spec.params_model.model_fields)
    filtered = {key: value for key, value in (raw or {}).items() if key in allowed and value is not None}
    if "web_candidates" in allowed and "web_candidates" not in filtered and "top_n" in filtered:
        filtered["web_candidates"] = filtered["top_n"]
    for key, value in list(filtered.items()):
        literal_values = _string_literal_values(spec.params_model.model_fields[key].annotation)
        if isinstance(value, str) and literal_values:
            normalized = value.strip().lower()
            if normalized not in literal_values:
                filtered.pop(key)
                continue
            filtered[key] = normalized
    return spec.params_model.model_validate(filtered)


def _string_literal_values(annotation: Any) -> tuple[str, ...]:
    origin = get_origin(annotation)
    if origin is Literal:
        values = get_args(annotation)
        return tuple(value for value in values if isinstance(value, str)) if all(isinstance(value, str) for value in values) else ()
    values: list[str] = []
    for arg in get_args(annotation):
        values.extend(_string_literal_values(arg))
    return tuple(values)
