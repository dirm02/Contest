"""Turn classifier for iterative and analytical analyst conversations."""

from __future__ import annotations

import json
import re
from time import monotonic
from typing import Any, Literal

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, set_default_openai_key
from openai.types.shared import Reasoning
from pydantic import Field, field_validator

from .primitives.base import StrictModel
from .responses import Aggregation, SortKey
from .router import ClarificationPayload, NewConversationHint
from .runtime_config import settings


TURN_CLASSIFIER_SYSTEM_PROMPT = """You are the Turn Classifier for a Canadian public-money accountability analyst.
You read the user's latest message AND a compact summary of the conversation
memory (prior recipe runs and their findings), and you produce a structured plan
for how to answer this turn.

You MUST emit a TurnClassification with:
  - mode: one of {fresh, refined, composed, conversational, analytical_query,
                  clarify, new_conversation, not_answerable}
  - reasoning_one_line: ≤ 140 chars, plain English, why you picked this mode
  - referenced_run_ids: the run_ids your plan reads from (empty for fresh/clarify/etc.)
  - operations: the ordered ops you will run
  - clarification, new_conversation, or not_answerable_reason: when applicable

Mode definitions:
  fresh           — user asked something that requires running a recipe from scratch.
                    The conversation memory does not already contain the data needed.
  refined         — user wants to reshape exactly one prior run (filter/sort/slice/
                    aggregate/project/commentary on a single source). No new SQL.
  composed        — user wants to combine MULTIPLE prior runs (join/union/intersect/
                    compare). May include exactly one new recipe_run if a needed
                    dataset isn't yet in memory.
  conversational  — user wants commentary on prior runs without re-querying. No new SQL,
                    no row reshaping. Ops will be exactly one [commentary] entry.
  analytical_query — choose this when the question is concrete, answerable from
                    the warehouse, and does not match any built-in recipe. The
                    question must reference categories or entities resolvable via
                    the lexicon or directly via catalog columns, use a computable
                    metric, and imply a single SQL query.
  clarify         — the question is too vague or under-specified. Provide a clarification.
  new_conversation — the question is sharply off-topic from the current thread.
                     Recommend opening a new conversation.
  not_answerable  — the question cannot be answered with our datasets and recipes.

Hard rules:
  • Never invent run_ids. Only reference run_ids that appear in the memory summary.
  • If the user uses pronouns ("that", "those", "the top 5"), resolve them to the
    most recent eligible run in memory unless they explicitly reference earlier ones.
  • Prefer `refined` over `fresh` when the data is already in memory and no
    new dataset is needed.
  • Choose `composed` when more than one source run is needed.
  • Choose `conversational` when the user asks "why", "explain", "how", "summarize"
    about existing data, with no new filtering or row selection.
  • If the user types something like "compare X to Y" and only one of X, Y is in
    memory, plan a recipe_run for the missing one followed by a compare op
    (mode = composed).
  • Pick `analytical_query` over `clarify` when the open-ended question is concrete
    and computable; pick a built-in recipe over `analytical_query` whenever a recipe
    is a reasonable match.
  • Predicates in filter ops must be expressible against the source run's columns
    (you'll see the column list in the memory summary). If a predicate uses a column
    not in the source, switch mode to `fresh`.
  • Limit operations to ≤ 5 per turn.
  • Slice ops: limit ≤ 1000.

Output strict JSON matching the TurnClassification schema. Do not output prose.
"""


class PlannedOperation(StrictModel):
    kind: Literal[
        "recipe_run",
        "filter",
        "project",
        "sort",
        "slice",
        "aggregate",
        "join",
        "union",
        "intersect",
        "compare",
        "commentary",
    ]
    recipe_id: str | None = None
    recipe_params: dict[str, Any] | None = None
    source_run_id: str | None = None
    source_run_ids: list[str] = Field(default_factory=list)
    left_run_id: str | None = None
    right_run_id: str | None = None
    baseline_run_id: str | None = None
    comparison_run_id: str | None = None
    predicate: str | None = None
    columns: list[str] | None = None
    sort_by: list[SortKey] | None = None
    offset: int | None = None
    limit: int | None = None
    group_by: list[str] | None = None
    aggregations: list[Aggregation] | None = None
    keys: list[str] | None = None
    how: Literal["inner", "left", "outer"] | None = None
    description: str

    @field_validator("limit")
    @classmethod
    def limit_cap(cls, value: int | None) -> int | None:
        return min(max(value, 1), 1000) if value is not None else value


class TurnClassification(StrictModel):
    mode: Literal[
        "fresh",
        "refined",
        "composed",
        "conversational",
        "analytical_query",
        "clarify",
        "new_conversation",
        "not_answerable",
    ]
    reasoning_one_line: str
    operations: list[PlannedOperation] = Field(default_factory=list)
    referenced_run_ids: list[str] = Field(default_factory=list)
    clarification: ClarificationPayload | None = None
    new_conversation: NewConversationHint | None = None
    not_answerable_reason: str | None = None


_CLASSIFIER_CACHE: dict[str, tuple[float, TurnClassification]] = {}
_CACHE_TTL_SECONDS = 3600


async def classify_turn(
    message: str,
    memory_summary: list[dict[str, Any]],
    *,
    conversation_topic: str | None = None,
) -> TurnClassification:
    digest = json.dumps({"message": message, "memory": _memory_digest(memory_summary)}, sort_keys=True, ensure_ascii=False)
    cached = _CLASSIFIER_CACHE.get(digest)
    if cached and monotonic() - cached[0] <= _CACHE_TTL_SECONDS:
        return cached[1]

    deterministic = classify_turn_deterministic(message, memory_summary, conversation_topic=conversation_topic)
    if deterministic is not None:
        if deterministic.mode not in {"clarify", "new_conversation"}:
            _CLASSIFIER_CACHE[digest] = (monotonic(), deterministic)
        return deterministic

    try:
        result = await Runner.run(_agent(), _classifier_payload(message, memory_summary, conversation_topic), max_turns=1)
        plan = _validate_plan(message, result.final_output, memory_summary)
    except Exception as exc:
        plan = TurnClassification(
            mode="fresh",
            reasoning_one_line=f"Classifier fell back to recipe routing after {exc.__class__.__name__}.",
            operations=[PlannedOperation(kind="recipe_run", recipe_id=None, recipe_params={}, description="Run the best matching deterministic recipe.")],
            referenced_run_ids=[],
        )
    if plan.mode not in {"clarify", "new_conversation"}:
        _CLASSIFIER_CACHE[digest] = (monotonic(), plan)
    return plan


def classify_turn_deterministic(
    message: str,
    memory_summary: list[dict[str, Any]],
    *,
    conversation_topic: str | None = None,
) -> TurnClassification | None:
    text = " ".join(message.strip().split())
    lowered = text.lower()
    latest = memory_summary[0] if memory_summary else None
    latest_run_id = str(latest["run_id"]) if latest else None
    columns = [str(column) for column in (latest or {}).get("columns") or []]

    if re.search(r"\b(weather|sports score|stock price|gdp of canada|personal email|deputy minister.*email)\b", lowered):
        return TurnClassification(
            mode="not_answerable",
            reasoning_one_line="The question is outside the loaded accountability warehouse.",
            operations=[],
            referenced_run_ids=[],
            not_answerable_reason="This service only answers grounded public-accountability questions from the loaded warehouse and approved recipes.",
        )
    if re.search(r"\b(predict|forecast|next year)\b", lowered):
        return TurnClassification(
            mode="not_answerable",
            reasoning_one_line="Forecasting future funding is outside the deterministic dataset.",
            operations=[],
            referenced_run_ids=[],
            not_answerable_reason="Forecasting future funding is not supported by the loaded datasets.",
        )
    if re.fullmatch(r"(tell me about|show me|find)\s+(contracts|funding|schools|hospitals|charities)\.?", lowered):
        return TurnClassification(
            mode="clarify",
            reasoning_one_line="The request names a broad area but no metric or time window.",
            operations=[],
            referenced_run_ids=[],
            clarification=ClarificationPayload(
                headline="What would you like measured?",
                reason="The question names a broad dataset or concept but not a count, total, list, top-N, comparison, or time window.",
                suggested_narrowings=[
                    "Ask for a count, for example 'How many schools received funding in 2024?'",
                    "Ask for a total, for example 'Total funding to Indigenous organizations in 2024'.",
                    "Ask for a list, for example 'List universities over $10M in federal contracts'.",
                ],
                example_refinements=["How many schools received funding in 2024?", "Top 20 cities by federal contracts in 2023"],
            ),
        )

    if latest_run_id:
        if "forget that" in lowered or "start over" in lowered:
            return _fresh_classification_for(text, lowered, reason="The user asked to start over.")
        if _looks_analytical(lowered) and not _references_prior_result(lowered):
            return _analytical_classification()
        if re.search(r"\bwhy\b|\bexplain\b|\bsummarize\b|\bhow\b", lowered) and not _looks_like_filter(lowered) and not _looks_analytical(lowered):
            return TurnClassification(
                mode="conversational",
                reasoning_one_line="The user asked for commentary on the latest cached run.",
                operations=[PlannedOperation(kind="commentary", source_run_ids=[latest_run_id], description="Explain the referenced prior findings.")],
                referenced_run_ids=[latest_run_id],
            )
        if re.search(r"\b(top|first)\s+(\d+)\b|\bonly\b", lowered):
            limit = _extract_limit(lowered) or 5
            return TurnClassification(
                mode="refined",
                reasoning_one_line="The user wants a smaller slice of the latest cached run.",
                operations=[PlannedOperation(kind="slice", source_run_id=latest_run_id, offset=0, limit=limit, description=f"Show the top {limit} rows from the prior run.")],
                referenced_run_ids=[latest_run_id],
            )
        if "sort" in lowered or "largest" in lowered or "highest" in lowered or "descending" in lowered:
            column = _best_column(columns, lowered, prefer_numeric=True)
            return TurnClassification(
                mode="refined",
                reasoning_one_line="The user wants the latest cached run sorted.",
                operations=[PlannedOperation(kind="sort", source_run_id=latest_run_id, sort_by=[SortKey(column=column, dir="desc")], description=f"Sort the prior run by {column} descending.")],
                referenced_run_ids=[latest_run_id],
            )
        if "group by" in lowered:
            group_by = _column_after_phrase(lowered, columns, "group by") or _best_column(columns, lowered)
            amount = _best_amount_column(columns)
            return TurnClassification(
                mode="refined",
                reasoning_one_line="The user wants the latest cached run grouped.",
                operations=[
                    PlannedOperation(
                        kind="aggregate",
                        source_run_id=latest_run_id,
                        group_by=[group_by],
                        aggregations=[Aggregation(column=amount, fn="sum", alias=f"{amount}_sum")],
                        description=f"Group cached findings by {group_by}.",
                    )
                ],
                referenced_run_ids=[latest_run_id],
            )
        if "compare" in lowered and len(memory_summary) >= 2:
            first, second = str(memory_summary[1]["run_id"]), latest_run_id
            return TurnClassification(
                mode="composed",
                reasoning_one_line="The user asked to compare two prior runs.",
                operations=[PlannedOperation(kind="compare", baseline_run_id=first, comparison_run_id=second, description="Compare the two recalled runs.")],
                referenced_run_ids=[first, second],
            )
        if _looks_like_filter(lowered):
            predicate = _predicate_from_text(lowered, columns)
            return TurnClassification(
                mode="refined",
                reasoning_one_line="The user wants to filter the latest cached run.",
                operations=[PlannedOperation(kind="filter", source_run_id=latest_run_id, predicate=predicate, description=f"Filter cached findings where {predicate}.")],
                referenced_run_ids=[latest_run_id],
            )
        if "combine" in lowered and len(memory_summary) >= 2:
            left, right = str(memory_summary[1]["run_id"]), latest_run_id
            key = _shared_key(memory_summary[1], latest) or "canonical_name"
            return TurnClassification(
                mode="composed",
                reasoning_one_line="The user asked to combine two prior result sets.",
                operations=[PlannedOperation(kind="join", left_run_id=left, right_run_id=right, keys=[key], how="inner", description=f"Join recalled runs on {key}.")],
                referenced_run_ids=[left, right],
            )
        if "adverse media" in lowered and "those" in lowered:
            return TurnClassification(
                mode="composed",
                reasoning_one_line="The user wants adverse-media enrichment for the latest run.",
                operations=[
                    PlannedOperation(kind="recipe_run", recipe_id="adverse_media", recipe_params={"top_n": 20}, description="Run adverse-media discovery."),
                    PlannedOperation(kind="join", left_run_id=latest_run_id, right_run_id=None, keys=["canonical_name"], how="left", description="Join adverse-media signals to prior recipients."),
                ],
                referenced_run_ids=[latest_run_id],
            )
    if _looks_like_zombie_recipient(lowered):
        return _fresh_classification_for(
            text,
            lowered,
            recipe_id="zombie_recipients",
            reason="The user asked for high-government-funding charities with stale filings.",
        )
    if _looks_analytical(lowered):
        return _analytical_classification()
    if "charity zombies" in lowered or "zombie" in lowered:
        return _fresh_classification_for(text, lowered, recipe_id="zombie_recipients", reason="The user asked for the zombie-recipient recipe.")
    return None


def _agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Ship Turn Classifier",
        model=settings.fast_model,
        output_type=AgentOutputSchema(TurnClassification, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="low"),
            verbosity="low",
            max_tokens=2048,
            include_usage=True,
            prompt_cache_retention="24h",
        ),
        instructions=TURN_CLASSIFIER_SYSTEM_PROMPT,
    )


def _classifier_payload(message: str, memory_summary: list[dict[str, Any]], conversation_topic: str | None) -> str:
    return json.dumps(
        {"message": message, "conversation_topic": conversation_topic, "memory": memory_summary},
        ensure_ascii=False,
    )


def _validate_plan(message: str, plan: TurnClassification, memory_summary: list[dict[str, Any]]) -> TurnClassification:
    plan = _validate_run_ids(plan, memory_summary)
    empty_commentary_ops = [op for op in plan.operations if op.kind == "commentary" and not op.source_run_ids]
    if not empty_commentary_ops:
        return plan

    text = " ".join(message.strip().split())
    lowered = text.lower()
    if _looks_analytical(lowered) and not _references_prior_result(lowered):
        return _analytical_classification()

    latest = memory_summary[0] if memory_summary else None
    if latest:
        latest_run_id = str(latest["run_id"])
        for op in empty_commentary_ops:
            op.source_run_ids = [latest_run_id]
        plan.mode = "conversational"
        plan.referenced_run_ids = [latest_run_id]
        plan.reasoning_one_line = "Commentary was attached to the latest recalled run."
        return plan

    return TurnClassification(
        mode="clarify",
        reasoning_one_line="Commentary needs a prior investigation, but no prior run was available.",
        operations=[],
        referenced_run_ids=[],
        clarification=ClarificationPayload(
            headline="Run an investigation first",
            reason="That follow-up needs an existing result to explain, but this conversation has no recalled investigation yet.",
            suggested_narrowings=[
                "Ask a concrete funding question, for example 'How much funding did Pizza Pizza receive?'",
                "Choose a catalog example to create an investigation result first.",
            ],
            example_refinements=["How much funding did Pizza Pizza receive?", "Which schools received funding in 2024?"],
        ),
    )


def _validate_run_ids(plan: TurnClassification, memory_summary: list[dict[str, Any]]) -> TurnClassification:
    valid = {str(entry["run_id"]) for entry in memory_summary}
    referenced = [run_id for run_id in plan.referenced_run_ids if run_id in valid]
    if len(referenced) != len(plan.referenced_run_ids):
        plan.referenced_run_ids = referenced
        plan.operations = [
            op for op in plan.operations if not _op_references_missing_run(op, valid)
        ]
        if plan.mode in {"refined", "composed", "conversational"} and not plan.operations:
            plan.mode = "clarify"
            plan.clarification = ClarificationPayload(
                headline="I need a prior result to use for that follow-up.",
                reason="The requested run was not available in this conversation memory.",
                suggested_narrowings=["Run the base investigation again, or pin the prior result before referencing it."],
            )
    return plan


def _op_references_missing_run(op: PlannedOperation, valid: set[str]) -> bool:
    ids = [
        op.source_run_id,
        op.left_run_id,
        op.right_run_id,
        op.baseline_run_id,
        op.comparison_run_id,
        *(op.source_run_ids or []),
    ]
    return any(run_id is not None and run_id not in valid for run_id in ids)


def _memory_digest(memory_summary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "run_id": entry.get("run_id"),
            "recipe_id": entry.get("recipe_id"),
            "row_count": entry.get("row_count"),
            "columns": entry.get("columns"),
            "pinned": entry.get("pinned"),
        }
        for entry in memory_summary
    ]


def _fresh_classification_for(text: str, lowered: str, *, recipe_id: str | None = None, reason: str) -> TurnClassification:
    return TurnClassification(
        mode="fresh",
        reasoning_one_line=reason,
        operations=[PlannedOperation(kind="recipe_run", recipe_id=recipe_id, recipe_params={}, description="Run a fresh investigation.")],
        referenced_run_ids=[],
    )


def _looks_analytical(lowered: str) -> bool:
    metric = r"\b(how many|how much|count|total|sum|average|avg|median|list|top\s+\d+|which|distinct recipients|more than|over\s+\$?\d|received?|receive)\b"
    concept = r"\b(school|schools|hospital|hospitals|indigenous|university|universities|college|municipal|cities|city|contracts?|grants?|funding|charities|crown corporation|department|phac|esdc|manitoba|quebec|alberta)\b"
    return bool(re.search(metric, lowered) and re.search(concept, lowered))


def _analytical_classification() -> TurnClassification:
    return TurnClassification(
        mode="analytical_query",
        reasoning_one_line="The question is a concrete warehouse aggregate/list request outside fixed recipes.",
        operations=[PlannedOperation(kind="recipe_run", recipe_id="__analytical__", recipe_params={}, description="Run a sandboxed analytical warehouse query.")],
        referenced_run_ids=[],
    )


def _references_prior_result(lowered: str) -> bool:
    return bool(re.search(r"\b(that|those|them|these|previous|prior|last result|latest result|result set|findings|run)\b", lowered))


def _looks_like_zombie_recipient(lowered: str) -> bool:
    has_charity = "charit" in lowered or "nonprofit" in lowered or "non-profit" in lowered
    has_government_funding = ("government" in lowered or "govt" in lowered) and "funding" in lowered
    has_stale_filing = bool(re.search(r"\b(stopped filing|stop filing|stale filing|stale filings|silent|not fil(?:e|ed|ing)|no longer fil(?:e|ed|ing))\b", lowered))
    return has_charity and has_government_funding and has_stale_filing


def _looks_like_filter(lowered: str) -> bool:
    return bool(re.search(r"\b(filter|only|where|over|above|more than|greater than|>=|<=|=|in 20\d{2}|fy20\d{2}|alberta|quebec|ontario|manitoba)\b", lowered))


def _predicate_from_text(lowered: str, columns: list[str]) -> str:
    year = re.search(r"\b(?:fy)?(20\d{2})\b", lowered)
    if year:
        column = _first_existing(columns, ["fiscal_year", "period", "year"]) or _best_column(columns, lowered)
        return f"{column} = {year.group(1)}"
    amount = re.search(r"(?:over|above|more than|greater than|>=?)\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kmb])?", lowered)
    if amount:
        value = _scale_amount(float(amount.group(1).replace(",", "")), amount.group(2))
        column = _best_amount_column(columns)
        return f"{column} >= {int(value) if value.is_integer() else value}"
    province = _province_predicate(lowered, columns)
    if province:
        return province
    code = re.search(r"\bcode\s+([A-Za-z0-9_-]+)\b", lowered)
    if code:
        column = _first_existing(columns, ["procurement_code", "category_code", "code"]) or _best_column(columns, lowered)
        return f"{column} = '{code.group(1)}'"
    return f"{_best_column(columns, lowered)} IS NOT NULL"


def _province_predicate(lowered: str, columns: list[str]) -> str | None:
    provinces = {
        "alberta": "AB",
        "quebec": "QC",
        "ontario": "ON",
        "manitoba": "MB",
        "saskatchewan": "SK",
    }
    for name, code in provinces.items():
        if name in lowered:
            column = _first_existing(columns, ["province", "recipient_province", "region_proxy"])
            if column:
                return f"{column} = '{code}'"
    return None


def _extract_limit(lowered: str) -> int | None:
    match = re.search(r"\b(?:top|first)\s+(\d+)\b", lowered)
    if match:
        return min(max(int(match.group(1)), 1), 1000)
    if "top" in lowered or "only" in lowered:
        return 5
    return None


def _column_after_phrase(lowered: str, columns: list[str], phrase: str) -> str | None:
    tail = lowered.split(phrase, 1)[-1].strip(" .")
    for column in columns:
        if column.lower().replace("_", " ") in tail:
            return column
    return None


def _best_column(columns: list[str], lowered: str, *, prefer_numeric: bool = False) -> str:
    if not columns:
        return "amount"
    for column in columns:
        if column.lower().replace("_", " ") in lowered:
            return column
    if prefer_numeric:
        return _best_amount_column(columns)
    return columns[0]


def _best_amount_column(columns: list[str]) -> str:
    for candidate in (
        "amount",
        "agreement_value",
        "total_all_funding",
        "total_funding_known",
        "supplier_amount",
        "segment_total_amount",
        "metric_value",
        "count",
    ):
        if candidate in columns:
            return candidate
    return columns[0] if columns else "amount"


def _first_existing(columns: list[str], candidates: list[str]) -> str | None:
    lowered = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate in lowered:
            return lowered[candidate]
    return None


def _scale_amount(value: float, suffix: str | None) -> float:
    suffix = (suffix or "").lower()
    if suffix == "k":
        return value * 1_000
    if suffix == "m":
        return value * 1_000_000
    if suffix == "b":
        return value * 1_000_000_000
    return value


def _shared_key(left: dict[str, Any], right: dict[str, Any]) -> str | None:
    left_columns = set(left.get("columns") or [])
    right_columns = set(right.get("columns") or [])
    for key in ("canonical_name", "entity_id", "recipient", "supplier_name", "recipient_legal_name"):
        if key in left_columns and key in right_columns:
            return key
    return None
