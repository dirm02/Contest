"""CLI entrypoint for the stateful ship-mode analyst service."""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from typing import Any
from uuid import UUID

from pydantic import Field

from .bootstrap_schema import bootstrap_schema
from .orchestrator import AssistantResponse, create_conversation, handle_user_message
from .primitives.base import StrictModel, create_pool, json_ready
from .recipes.base import RecipeResult
from .recipes.catalog import RECIPES, coerce_params
from .router import RouterDecision
from .summarizer import Summary, summarize
from .verify import VerificationResult, verify


class DirectAnswer(StrictModel):
    question: str
    router: RouterDecision
    recipe_result: RecipeResult | None = None
    summary: Summary | None = None
    verification: VerificationResult | None = None
    latency_ms: int
    status: str
    failures: list[str] = Field(default_factory=list)


async def ask(question: str, *, conversation_id: UUID | None = None) -> AssistantResponse:
    """Handle a natural-language message through the persistent conversation path."""
    pool = await create_pool()
    try:
        await bootstrap_schema(pool)
        if conversation_id is None:
            conversation = await create_conversation(pool)
            conversation_id = UUID(str(conversation["conversation_id"]))
        return await handle_user_message(conversation_id=conversation_id, content=question, pool=pool)
    finally:
        await pool.close()


async def ask_direct(question: str, *, recipe_id: str, raw_params: dict[str, Any] | None = None) -> DirectAnswer:
    """Direct recipe smoke path retained for deterministic recipe debugging."""
    started = time.perf_counter()
    pool = await create_pool()
    try:
        decision = RouterDecision(
            decision="execute",
            recipe_id=recipe_id,
            params=raw_params or {},
            confidence="high",
            reasoning_one_line="Recipe supplied by caller.",
            not_answerable_reason=None,
        )
        params = coerce_params(recipe_id, decision.params)
        spec = RECIPES[recipe_id]
        result = await spec.run(question, params, pool)
        summary = await summarize(result)
        total_latency_ms = int((time.perf_counter() - started) * 1000)
        verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms)
        return DirectAnswer(
            question=question,
            router=decision,
            recipe_result=result,
            summary=summary,
            verification=verification,
            latency_ms=total_latency_ms,
            status="completed" if verification.status == "pass" else "verification_failed",
            failures=verification.failures,
        )
    finally:
        await pool.close()


def _render_response(response: AssistantResponse | DirectAnswer) -> str:
    response_type = getattr(response, "type", None)
    if response_type == "clarification_needed":
        return "\n".join(
            [
                response.headline,  # type: ignore[attr-defined]
                "",
                response.reason,  # type: ignore[attr-defined]
                "",
                "Suggested narrowings:",
                *(f"- {item}" for item in response.suggested_narrowings),  # type: ignore[attr-defined]
                "",
                f"To proceed: {response.proceed_phrase}",  # type: ignore[attr-defined]
            ]
        ).rstrip()
    if response_type == "needs_new_conversation":
        return "\n".join(
            [
                "Needs a new conversation",
                "",
                response.reason,  # type: ignore[attr-defined]
                f"Suggested starter: {response.suggested_starter}",  # type: ignore[attr-defined]
            ]
        )
    if response_type == "not_answerable":
        return response.message  # type: ignore[attr-defined]
    if response_type == "answer":
        return _render_summary(response.summary, response.verification.status, response.latency_ms, response.verification.failures)  # type: ignore[attr-defined]
    if isinstance(response, DirectAnswer):
        if response.status == "not_answerable" or response.summary is None:
            return "\n".join([f"Status: {response.status}", *(response.failures or [])])
        return _render_summary(response.summary, response.verification.status if response.verification else response.status, response.latency_ms, response.failures)
    return json.dumps(json_ready(response), indent=2)


def _render_summary(summary: Summary, status: str, latency_ms: int, failures: list[str]) -> str:
    lines = [summary.headline, ""]
    for paragraph in summary.paragraphs:
        citation_bits = []
        for citation in paragraph.citations:
            if citation.finding_index is not None:
                citation_bits.append(f"finding[{citation.finding_index}]")
            if citation.sql_query_name:
                citation_bits.append(f"sql:{citation.sql_query_name}")
            if citation.url:
                citation_bits.append(citation.url)
        suffix = f" [{' | '.join(citation_bits)}]" if citation_bits else ""
        lines.append(f"{paragraph.text}{suffix}")
        lines.append("")
    if summary.caveats:
        lines.append("Caveats:")
        lines.extend(f"- {item}" for item in summary.caveats)
    lines.append("")
    lines.append(f"Verification: {status} ({latency_ms}ms)")
    for failure in failures:
        lines.append(f"- {failure}")
    return "\n".join(lines).rstrip()


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Ask a grounded Canadian public-accountability question.")
    parser.add_argument("question", help="Natural-language question to answer")
    parser.add_argument("--conversation-id", help="Existing conversation UUID. Omit to create one.")
    parser.add_argument("--recipe", choices=sorted(RECIPES), help="Bypass router for recipe smoke tests")
    parser.add_argument("--params-json", default="{}", help="JSON params when --recipe is used")
    parser.add_argument("--json", action="store_true", help="Print full JSON answer")
    args = parser.parse_args()
    raw_params = json.loads(args.params_json)
    if args.recipe:
        answer: AssistantResponse | DirectAnswer = await ask_direct(args.question, recipe_id=args.recipe, raw_params=raw_params)
    else:
        conversation_id = UUID(args.conversation_id) if args.conversation_id else None
        answer = await ask(args.question, conversation_id=conversation_id)
    if args.json:
        print(json.dumps(json_ready(answer.model_dump(mode="json")), indent=2, ensure_ascii=False))
    else:
        print(_render_response(answer))


if __name__ == "__main__":
    asyncio.run(_main())
