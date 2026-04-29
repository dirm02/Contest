"""Stateful orchestration for the ship-mode analyst service."""

from __future__ import annotations

import json
import re
import asyncio
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from uuid import UUID, uuid4

import asyncpg
from pydantic import Field

from .primitives.base import EmitCallback, StrictModel, json_ready
from .recipes.base import RecipeResult
from .recipes.catalog import RECIPES, REQUIRES_SPECIFICITY, coerce_params
from .analytical import ANALYTICAL_RECIPE_PREFIX, AnalyticalAgent, analytical_to_recipe_result, update_analytical_audit_verifier
from .classifier import PlannedOperation, TurnClassification, classify_turn
from .diff import compute_diff
from .memory import build_memory_summary, humanize_run, list_memory_entries, remember_run
from .refine import (
    COMPOSITION_KINDS,
    REFINEMENT_KINDS,
    Refiner,
    RunRegistry,
    apply_refinement,
    find_cached_derived_run,
    infer_refinement_filter,
    operation_hash,
    refinement_description,
)
from .router import ClarificationPayload, NewConversationHint, RouterDecision, route
from .summarizer import Citation, Paragraph, Summary, emit_cached_summary_tokens, summarize_streaming
from .verify import VerificationResult, verify
from .responses import (
    AggregateOp,
    AnswerDiff,
    CommentaryOp,
    CompareOp,
    FilterOp,
    IntersectOp,
    JoinOp,
    Operation,
    ProjectOp,
    RecipeRunOp,
    SliceOp,
    SortOp,
    UnionOp,
)


class AnswerResponse(StrictModel):
    type: Literal["answer"] = "answer"
    message_id: str
    mode: Literal["fresh", "refined", "composed", "conversational"] = "fresh"
    recipe_run_id: str | None = None
    based_on_run_id: str | None = None
    source_run_ids: list[str] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    diff: AnswerDiff | None = None
    summary: Summary
    findings_preview: list[dict[str, Any]] = Field(default_factory=list)
    verification: VerificationResult
    latency_ms: int


class ClarificationResponse(StrictModel):
    type: Literal["clarification_needed"] = "clarification_needed"
    message_id: str
    headline: str
    reason: str
    suggested_narrowings: list[str] = Field(default_factory=list)
    example_refinements: list[str] = Field(default_factory=list)
    proceed_phrase: str = "run the broad scan anyway"


class NeedsNewConversationResponse(StrictModel):
    type: Literal["needs_new_conversation"] = "needs_new_conversation"
    message_id: str
    reason: str
    suggested_starter: str
    current_conversation_topic: str | None = None


class NotAnswerableResponse(StrictModel):
    type: Literal["not_answerable"] = "not_answerable"
    message_id: str
    message: str


AssistantResponse = AnswerResponse | ClarificationResponse | NeedsNewConversationResponse | NotAnswerableResponse


@dataclass(frozen=True)
class Event:
    name: str
    data: dict[str, Any]
    ts: str = field(default_factory=lambda: datetime.utcnow().isoformat(timespec="milliseconds") + "Z")

    def envelope(self) -> dict[str, Any]:
        return {"event": self.name, "ts": self.ts, "data": json_ready(self.data)}


async def create_conversation(pool: asyncpg.Pool, *, title: str | None = None) -> dict[str, Any]:
    row = await pool.fetchrow(
        """
INSERT INTO investigator.ship_conversations (title)
VALUES ($1)
RETURNING conversation_id, title, status, created_at, updated_at
""".strip(),
        title,
    )
    return _record_to_json(row)


async def list_conversations(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        """
SELECT
    c.conversation_id,
    c.title,
    c.status,
    c.created_at,
    c.updated_at,
    count(m.message_id)::int AS message_count
FROM investigator.ship_conversations c
LEFT JOIN investigator.ship_messages m ON m.conversation_id = c.conversation_id
WHERE c.status <> 'archived'
GROUP BY c.conversation_id, c.title, c.status, c.created_at, c.updated_at
ORDER BY c.updated_at DESC
LIMIT 200
""".strip()
    )
    return [_record_to_json(row) for row in rows]


async def get_conversation(pool: asyncpg.Pool, conversation_id: UUID) -> dict[str, Any] | None:
    conversation = await pool.fetchrow(
        """
SELECT conversation_id, title, status, created_at, updated_at
FROM investigator.ship_conversations
WHERE conversation_id = $1
""".strip(),
        conversation_id,
    )
    if conversation is None:
        return None
    messages = await pool.fetch(
        """
SELECT message_id, role, content, created_at
FROM investigator.ship_messages
WHERE conversation_id = $1
ORDER BY created_at, message_id
""".strip(),
        conversation_id,
    )
    runs = await pool.fetch(
        """
SELECT run_id, based_on_run_id, recipe_id, params, latency_ms, is_derived, derived_op, op_hash, source_run_ids, created_at
FROM investigator.ship_recipe_runs
WHERE conversation_id = $1
ORDER BY created_at, run_id
""".strip(),
        conversation_id,
    )
    payload = _record_to_json(conversation)
    payload["messages"] = [_record_to_json(row) for row in messages]
    payload["recipe_runs"] = [_record_to_json(row) for row in runs]
    payload["memory"] = await list_memory_entries(pool, conversation_id)
    return payload


async def get_recipe_run(pool: asyncpg.Pool, run_id: UUID) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        """
SELECT run_id, conversation_id, message_id, based_on_run_id, recipe_id, params, findings, sql_log, summary, verification, latency_ms, is_derived, derived_op, op_hash, source_run_ids, created_at
FROM investigator.ship_recipe_runs
WHERE run_id = $1
""".strip(),
        run_id,
    )
    return _record_to_json(row) if row else None


async def archive_conversation(pool: asyncpg.Pool, conversation_id: UUID) -> bool:
    status = await pool.execute(
        """
UPDATE investigator.ship_conversations
SET status = 'archived', updated_at = now()
WHERE conversation_id = $1 AND status <> 'archived'
""".strip(),
        conversation_id,
    )
    return status.endswith("1")


async def handle_user_message(
    *,
    conversation_id: UUID,
    content: str,
    pool: asyncpg.Pool,
) -> AssistantResponse:
    final_payload: dict[str, Any] | None = None
    async for event in stream_user_message(conversation_id=conversation_id, content=content, pool=pool):
        if event.name == "final_response":
            final_payload = event.data
        elif event.name == "error":
            raise RuntimeError(str(event.data.get("message") or "ship service stream failed"))
    if final_payload is None:
        raise RuntimeError("ship service stream ended without a final_response")
    return _assistant_response_from_payload(final_payload)


async def stream_user_message(
    *,
    conversation_id: UUID,
    content: str,
    pool: asyncpg.Pool,
) -> AsyncGenerator[Event, None]:
    started = time.perf_counter()
    conversation = await _load_active_conversation(pool, conversation_id)
    if conversation is None:
        raise ValueError(f"conversation {conversation_id} does not exist or is archived")

    user_message_id = await _store_message(
        pool,
        conversation_id=conversation_id,
        role="user",
        content={"text": content},
    )
    await _ensure_conversation_title(pool, conversation_id, conversation, content)

    memory_summary = await build_memory_summary(pool, conversation_id)
    yield Event("turn_classifier_started", {})
    plan = await classify_turn(content, memory_summary, conversation_topic=conversation.get("title"))
    yield Event(
        "turn_classifier_decision",
        {
            "mode": plan.mode,
            "reasoning_one_line": plan.reasoning_one_line,
            "referenced_run_ids": plan.referenced_run_ids,
        },
    )
    yield Event("phase_started", {"phase": "route"})

    if plan.mode == "not_answerable":
        response = NotAnswerableResponse(
            message_id=str(uuid4()),
            message=plan.not_answerable_reason or "No deterministic recipe or analytical query can answer this question yet.",
        )
        await _store_assistant_response(pool, conversation_id, response)
        yield Event("final_response", response.model_dump(mode="json"))
        return

    if plan.mode == "clarify":
        payload = plan.clarification or _clarification_payload(None, content)
        response = ClarificationResponse(message_id=str(uuid4()), **payload.model_dump())
        await _store_assistant_response(pool, conversation_id, response)
        yield Event("final_response", response.model_dump(mode="json"))
        return

    if plan.mode == "new_conversation":
        latest_run = await _latest_recipe_run(pool, conversation_id)
        hint = plan.new_conversation or _new_conversation_hint(content, latest_run)
        response = NeedsNewConversationResponse(message_id=str(uuid4()), **hint.model_dump())
        await _store_assistant_response(pool, conversation_id, response)
        yield Event("final_response", response.model_dump(mode="json"))
        return

    if plan.referenced_run_ids:
        yield Event("memory_recall", {"run_ids": plan.referenced_run_ids, "reason": plan.reasoning_one_line})

    queue: asyncio.Queue[Event] = asyncio.Queue()

    async def emit(name: str, data: dict[str, Any]) -> None:
        await queue.put(Event(name, data))
        if name == "verifier_check":
            await asyncio.sleep(0.05)
            return
        await asyncio.sleep(0)

    task = asyncio.create_task(
        _handle_turn_plan(
            pool=pool,
            conversation_id=conversation_id,
            user_message_id=user_message_id,
            content=content,
            plan=plan,
            started=started,
            emit=emit,
        )
    )
    async for event in _drain_task_events(task, queue, started):
        yield event
    response = await task
    yield Event("final_response", response.model_dump(mode="json"))


async def _drain_task_events(
    task: asyncio.Task[Any],
    queue: asyncio.Queue[Event],
    started: float,
) -> AsyncGenerator[Event, None]:
    heartbeat_interval = 5.0
    last_meaningful_event = time.perf_counter()
    last_heartbeat = last_meaningful_event

    def mark_event(event: Event) -> Event:
        nonlocal last_meaningful_event, last_heartbeat
        if event.name != "heartbeat":
            now = time.perf_counter()
            last_meaningful_event = now
            last_heartbeat = now
        return event

    while not task.done() or not queue.empty():
        if not queue.empty():
            yield mark_event(queue.get_nowait())
            continue
        if task.done():
            break

        timeout = max(0.1, heartbeat_interval - (time.perf_counter() - last_heartbeat))
        queue_task = asyncio.create_task(queue.get())
        done, _pending = await asyncio.wait(
            {queue_task, task},
            timeout=timeout,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if queue_task in done:
            yield mark_event(queue_task.result())
            continue
        queue_task.cancel()
        if task in done:
            break
        if not done:
            now = time.perf_counter()
            if now - last_meaningful_event >= 3.0:
                last_heartbeat = now
                yield Event("heartbeat", {"elapsed_ms": int((now - started) * 1000)})

    while not queue.empty():
        yield mark_event(queue.get_nowait())


def _assistant_response_from_payload(payload: dict[str, Any]) -> AssistantResponse:
    response_type = payload.get("type")
    if response_type == "answer":
        return AnswerResponse.model_validate(payload)
    if response_type == "clarification_needed":
        return ClarificationResponse.model_validate(payload)
    if response_type == "needs_new_conversation":
        return NeedsNewConversationResponse.model_validate(payload)
    if response_type == "not_answerable":
        return NotAnswerableResponse.model_validate(payload)
    raise RuntimeError(f"unknown assistant response type {response_type!r}")


async def _handle_turn_plan(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    plan: TurnClassification,
    started: float,
    emit: EmitCallback | None = None,
) -> AnswerResponse:
    registry = RunRegistry(pool)
    refiner = Refiner(registry)
    operations: list[Operation] = []
    source_run_ids: list[str] = list(plan.referenced_run_ids)
    primary_run_id: str | None = None
    based_on_run_id: str | None = source_run_ids[0] if source_run_ids else None
    current_findings: list[dict[str, Any]] = []
    baseline_findings: list[dict[str, Any]] = []
    final_summary: Summary | None = None
    final_verification: VerificationResult | None = None
    last_result: RecipeResult | None = None
    remembered_new_run_ids: list[str] = []

    planned_ops = plan.operations or [PlannedOperation(kind="recipe_run", recipe_id=None, recipe_params={}, description="Run a fresh investigation.")]
    for planned_op in planned_ops:
        if planned_op.kind == "recipe_run":
            if emit:
                await emit("router_started", {})
            if planned_op.recipe_id is None:
                decision = await route(content, conversation_context=None)
                if emit:
                    await emit(
                        "router_decision",
                        {"decision": decision.decision, "recipe_id": decision.recipe_id, "reasoning_one_line": decision.reasoning_one_line},
                    )
                if decision.decision == "clarify":
                    payload = decision.clarification or _clarification_payload(decision.recipe_id, content)
                    response = ClarificationResponse(message_id=str(uuid4()), **payload.model_dump())
                    await _store_assistant_response(pool, conversation_id, response)
                    return response  # type: ignore[return-value]
                if decision.decision == "not_answerable" or decision.recipe_id is None:
                    response = NotAnswerableResponse(
                        message_id=str(uuid4()),
                        message=decision.not_answerable_reason or "No deterministic recipe can answer this question yet.",
                    )
                    await _store_assistant_response(pool, conversation_id, response)
                    return response  # type: ignore[return-value]
                planned_op.recipe_id = decision.recipe_id
                planned_op.recipe_params = decision.params
            elif emit:
                await emit(
                    "router_decision",
                    {"decision": "execute", "recipe_id": planned_op.recipe_id, "reasoning_one_line": plan.reasoning_one_line},
                )
            if emit:
                await emit("phase_started", {"phase": "retrieve"})
            if planned_op.recipe_id == "__analytical__" or plan.mode == "analytical_query":
                recipe_result, run_id, op_record, summary, verification = await _execute_analytical_operation(
                    pool=pool,
                    conversation_id=conversation_id,
                    user_message_id=user_message_id,
                    content=content,
                    planned_op=planned_op,
                    started=started,
                    emit=emit,
                )
            else:
                recipe_result, run_id, op_record, summary, verification = await _execute_recipe_operation(
                    pool=pool,
                    conversation_id=conversation_id,
                    user_message_id=user_message_id,
                    content=content,
                    planned_op=planned_op,
                    started=started,
                    emit=emit,
                )
            operations.append(op_record)
            primary_run_id = str(run_id)
            remembered_new_run_ids.append(str(run_id))
            current_findings = recipe_result.findings
            last_result = recipe_result
            final_summary = summary
            final_verification = verification
            continue

        if planned_op.kind == "commentary":
            source_ids = planned_op.source_run_ids or source_run_ids
            if not source_ids:
                raise RuntimeError("commentary operation requires a recalled run; empty commentary plans must clarify or run SQL")
            source_runs = [await registry.load(run_id) for run_id in source_ids]
            primary_run_id = source_runs[0].run_id if source_runs else primary_run_id
            based_on_run_id = primary_run_id
            current_findings = source_runs[0].findings if source_runs else []
            baseline_findings = current_findings
            op_record = CommentaryOp(source_run_ids=[run.run_id for run in source_runs], description=planned_op.description)
            operations.append(op_record)
            last_result = _recipe_result_from_loaded(content, source_runs[0], caveats=["Conversational answer used prior run memory; no new SQL was executed."]) if source_runs else _empty_recipe_result(content)
            final_summary = _summary_for_commentary(content, source_runs, op_record)
            if emit:
                await emit("phase_started", {"phase": "synthesize"})
                await emit_cached_summary_tokens(final_summary, emit=emit)
            total_latency_ms = int((time.perf_counter() - started) * 1000)
            if emit:
                await emit("phase_started", {"phase": "verify"})
            final_verification = await verify(
                final_summary,
                last_result,
                pool,
                total_latency_ms=total_latency_ms,
                emit=emit,
                source_results=[last_result],
                source_run_ids=[run.run_id for run in source_runs],
                mode="conversational",
            )
            continue

        if planned_op.kind in REFINEMENT_KINDS:
            source_run_id = planned_op.source_run_id or based_on_run_id
            if source_run_id is None:
                raise ValueError(f"{planned_op.kind} requires a source run")
            planned_op.source_run_id = source_run_id
            if not baseline_findings:
                baseline_findings = (await registry.load(source_run_id)).findings
            if emit:
                await emit("phase_started", {"phase": "retrieve"})
                await emit("refinement_started", {"kind": planned_op.kind, "source_run_id": source_run_id, "description": planned_op.description})
            result = await _execute_refiner_operation(
                pool=pool,
                conversation_id=conversation_id,
                user_message_id=user_message_id,
                content=content,
                refiner=refiner,
                planned_op=planned_op,
                started=started,
                emit=emit,
            )
            operations.append(result["operation"])
            primary_run_id = result["run_id"]
            based_on_run_id = source_run_id
            current_findings = result["recipe_result"].findings
            last_result = result["recipe_result"]
            final_summary = result["summary"]
            final_verification = result["verification"]
            if emit:
                await emit(
                    "refinement_completed",
                    {
                        "kind": planned_op.kind,
                        "source_run_id": source_run_id,
                        "before_count": len(baseline_findings),
                        "after_count": len(current_findings),
                        "timing_ms": result["timing_ms"],
                    },
                )
                if _legacy_refinement_events_enabled():
                    await emit(
                        "refinement_filter_applied",
                        {"filter": planned_op.model_dump(mode="json"), "before_count": len(baseline_findings), "after_count": len(current_findings)},
                    )
            continue

        if planned_op.kind in COMPOSITION_KINDS:
            if planned_op.kind == "join" and planned_op.right_run_id is None and remembered_new_run_ids:
                planned_op.right_run_id = remembered_new_run_ids[-1]
            composition_sources = _planned_source_ids(planned_op)
            if emit:
                await emit("phase_started", {"phase": "retrieve"})
                await emit("composition_started", {"kind": planned_op.kind, "source_run_ids": composition_sources, "description": planned_op.description})
            result = await _execute_refiner_operation(
                pool=pool,
                conversation_id=conversation_id,
                user_message_id=user_message_id,
                content=content,
                refiner=refiner,
                planned_op=planned_op,
                started=started,
                emit=emit,
            )
            operations.append(result["operation"])
            primary_run_id = result["run_id"]
            based_on_run_id = composition_sources[0] if composition_sources else based_on_run_id
            if based_on_run_id and not baseline_findings:
                baseline_findings = (await registry.load(based_on_run_id)).findings
            current_findings = result["recipe_result"].findings
            last_result = result["recipe_result"]
            final_summary = result["summary"]
            final_verification = result["verification"]
            if emit:
                await emit(
                    "composition_completed",
                    {"kind": planned_op.kind, "source_run_ids": composition_sources, "output_count": len(current_findings), "timing_ms": result["timing_ms"]},
                )

    if final_summary is None or final_verification is None or last_result is None:
        raise RuntimeError("turn plan completed without a publishable result")

    diff: AnswerDiff | None = None
    if based_on_run_id and plan.mode in {"refined", "composed", "conversational"}:
        if not baseline_findings:
            baseline_findings = (await registry.load(based_on_run_id)).findings
        diff = compute_diff(current_findings, baseline_findings, baseline_run_id=based_on_run_id)
        if emit:
            await emit("diff_computed", diff.model_dump(mode="json"))

    total_latency_ms = int((time.perf_counter() - started) * 1000)
    response_mode: Literal["fresh", "refined", "composed", "conversational"] = "fresh" if plan.mode in {"fresh", "analytical_query"} else plan.mode
    response = AnswerResponse(
        message_id=str(uuid4()),
        mode=response_mode,
        recipe_run_id=primary_run_id or based_on_run_id,
        based_on_run_id=based_on_run_id,
        source_run_ids=list(dict.fromkeys(source_run_ids + [run_id for op in operations for run_id in _operation_source_ids(op)])),
        operations=operations,
        diff=diff,
        summary=final_summary,
        findings_preview=current_findings[:25],
        verification=final_verification,
        latency_ms=total_latency_ms,
    )
    await _store_assistant_response(pool, conversation_id, response)
    return response


async def _execute_recipe_operation(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    planned_op: PlannedOperation,
    started: float,
    emit: EmitCallback | None,
) -> tuple[RecipeResult, UUID, RecipeRunOp, Summary, VerificationResult]:
    if planned_op.recipe_id not in RECIPES:
        raise ValueError(f"No registered deterministic recipe {planned_op.recipe_id!r}")
    params = coerce_params(planned_op.recipe_id, planned_op.recipe_params or {})
    spec = RECIPES[planned_op.recipe_id]
    result = await spec.run(content, params, pool, emit=emit)
    if emit:
        await emit("phase_started", {"phase": "synthesize"})
    summary = await summarize_streaming(result, emit=emit)
    total_latency_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit("phase_started", {"phase": "verify"})
    verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms, emit=emit)
    run_id = await _store_recipe_run(
        pool,
        conversation_id=conversation_id,
        message_id=user_message_id,
        result=result,
        summary=summary,
        verification=verification,
        latency_ms=total_latency_ms,
        based_on_run_id=None,
        is_derived=False,
        derived_op=None,
        op_hash=None,
        source_run_ids=[],
    )
    await remember_run(
        pool,
        conversation_id=conversation_id,
        run_id=run_id,
        recipe_id=result.recipe_id,
        params=result.params,
        row_count=len(result.findings),
    )
    op_record = RecipeRunOp(
        recipe_id=result.recipe_id,
        run_id=str(run_id),
        description=planned_op.description or humanize_run(result.recipe_id, result.params, len(result.findings)),
        row_count=len(result.findings),
        timing_ms=result.latency_ms,
    )
    return result, run_id, op_record, summary, verification


async def _execute_analytical_operation(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    planned_op: PlannedOperation,
    started: float,
    emit: EmitCallback | None,
) -> tuple[RecipeResult, UUID, RecipeRunOp, Summary, VerificationResult]:
    analytical = await AnalyticalAgent(pool=pool).run(
        question=content,
        conversation_id=conversation_id,
        turn_id=user_message_id,
        pool=pool,
        memory_summary=[],
        emit=emit,
    )
    result = analytical_to_recipe_result(content, analytical)
    if emit:
        await emit("phase_started", {"phase": "synthesize"})
    summary = await summarize_streaming(result, emit=emit)
    for caveat in result.caveats:
        if caveat not in summary.caveats:
            summary.caveats.append(caveat)
    total_latency_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit("phase_started", {"phase": "verify"})
    verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms, emit=emit, mode="fresh")
    run_id = await _store_recipe_run(
        pool,
        conversation_id=conversation_id,
        message_id=user_message_id,
        result=result,
        summary=summary,
        verification=verification,
        latency_ms=total_latency_ms,
        based_on_run_id=None,
        is_derived=False,
        derived_op=result.params.get("plan"),
        op_hash=result.params.get("schema_hash"),
        source_run_ids=[],
        run_id=UUID(analytical.run_id),
    )
    await update_analytical_audit_verifier(pool, UUID(analytical.run_id), verification.status)
    await remember_run(
        pool,
        conversation_id=conversation_id,
        run_id=run_id,
        recipe_id=result.recipe_id,
        params=result.params,
        row_count=len(result.findings),
    )
    op_record = RecipeRunOp(
        recipe_id=result.recipe_id,
        run_id=str(run_id),
        description=planned_op.description or f"Run analytical query {analytical.template_id}.",
        row_count=len(result.findings),
        timing_ms=analytical.timing_ms,
    )
    return result, run_id, op_record, summary, verification


async def _execute_refiner_operation(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    refiner: Refiner,
    planned_op: PlannedOperation,
    started: float,
    emit: EmitCallback | None,
) -> dict[str, Any]:
    source_ids = _planned_source_ids(planned_op)
    op_hash = operation_hash(planned_op, source_ids)
    cached = await find_cached_derived_run(pool, conversation_id, op_hash, source_ids)
    if cached:
        result = RecipeResult(
            recipe_id=str(cached["recipe_id"]),
            question=content,
            params=dict(cached.get("params") or {}),
            findings=list(cached.get("findings") or []),
            sql_log=[],
            caveats=["Reused cached deterministic refinement result; no SQL or web search was executed."],
            source_runs=[],
            latency_ms=0,
        )
        summary = Summary.model_validate(cached["summary"]) if cached.get("summary") else _summary_from_rows(result, "Cached refinement reused.")
        verification = VerificationResult.model_validate(cached["verification"]) if cached.get("verification") else VerificationResult(status="pass", failures=[], latency_ms=0, checks={})
        op_payload = dict((cached.get("params") or {}).get("_derived_operation") or planned_op.model_dump(mode="json"))
        op_record = _operation_from_payload(op_payload, fallback_run_id=source_ids[0] if source_ids else "")
        return {"recipe_result": result, "run_id": str(cached["run_id"]), "operation": op_record, "summary": summary, "verification": verification, "timing_ms": 0}

    refinement = await refiner.execute(planned_op)
    result = RecipeResult(
        recipe_id=refinement.recipe_id,
        question=content,
        params=refinement.params,
        findings=refinement.findings,
        sql_log=[],
        caveats=[
            *refinement.caveats,
            "This run was derived from cached findings; no fresh SQL, web search, or CanLII lookup was executed.",
        ],
        source_runs=[],
        latency_ms=refinement.timing_ms,
    )
    summary = _summary_from_rows(result, refinement.op_record.description)
    if emit:
        await emit("phase_started", {"phase": "synthesize"})
        await emit_cached_summary_tokens(summary, emit=emit)
    total_latency_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit("phase_started", {"phase": "verify"})
    verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms, emit=emit)
    run_id = await _store_recipe_run(
        pool,
        conversation_id=conversation_id,
        message_id=user_message_id,
        result=result,
        summary=summary,
        verification=verification,
        latency_ms=total_latency_ms,
        based_on_run_id=UUID(refinement.based_on_run_id) if refinement.based_on_run_id else None,
        is_derived=True,
        derived_op=refinement.op_record.model_dump(mode="json"),
        op_hash=refinement.op_hash,
        source_run_ids=refinement.source_run_ids,
    )
    await remember_run(
        pool,
        conversation_id=conversation_id,
        run_id=run_id,
        recipe_id=result.recipe_id,
        params=result.params,
        row_count=len(result.findings),
        derived_from_run_id=UUID(refinement.based_on_run_id) if refinement.based_on_run_id else None,
    )
    return {"recipe_result": result, "run_id": str(run_id), "operation": refinement.op_record, "summary": summary, "verification": verification, "timing_ms": refinement.timing_ms}


def _summary_from_rows(result: RecipeResult, description: str) -> Summary:
    if not result.findings:
        return Summary(
            headline="The cached operation returned no matching rows.",
            paragraphs=[Paragraph(text=f"{description} The operation produced 0 rows.", citations=[])],
            caveats=result.caveats,
        )
    citations = [Citation(finding_index=index) for index, _ in enumerate(result.findings[:5])]
    labels = [_row_label(row) for row in result.findings[:5]]
    return Summary(
        headline="Cached operation completed over prior findings.",
        paragraphs=[
            Paragraph(
                text=f"{description} The resulting row set contains {len(result.findings)} rows. Leading rows include {', '.join(labels)}.",
                citations=citations,
            )
        ],
        caveats=result.caveats,
    )


def _summary_for_commentary(content: str, source_runs: list[Any], op: CommentaryOp) -> Summary:
    if not source_runs:
        return Summary(
            headline="No prior run is available for commentary.",
            paragraphs=[Paragraph(text="There is no recalled run to explain yet.", citations=[])],
            caveats=["Run an investigation first, then ask a follow-up question."],
        )
    run = source_runs[0]
    findings = run.findings
    citations = [Citation(finding_index=index, source_run_id=run.run_id) for index, _ in enumerate(findings[:5])]
    labels = [_row_label(row) for row in findings[:5]]
    return Summary(
        headline="Commentary on the recalled investigation.",
        paragraphs=[
            Paragraph(
                text=f"This is commentary on the prior {run.recipe_id} result, not a new query. The recalled run has {len(findings)} rows; relevant leading rows include {', '.join(labels) if labels else 'no previewable rows'}.",
                citations=citations,
            )
        ],
        caveats=["Conversational mode uses prior cited findings only; no new SQL or web search was executed."],
    )


def _recipe_result_from_loaded(content: str, loaded: Any, *, caveats: list[str] | None = None) -> RecipeResult:
    return RecipeResult(
        recipe_id=loaded.recipe_id,
        question=content,
        params=loaded.params,
        findings=loaded.findings,
        sql_log=[],
        caveats=caveats or [],
        source_runs=[],
        latency_ms=0,
    )


def _empty_recipe_result(content: str) -> RecipeResult:
    return RecipeResult(recipe_id="__memory__", question=content, params={}, findings=[], sql_log=[], caveats=[], source_runs=[], latency_ms=0)


def _planned_source_ids(planned_op: PlannedOperation) -> list[str]:
    ids = [
        planned_op.source_run_id,
        planned_op.left_run_id,
        planned_op.right_run_id,
        planned_op.baseline_run_id,
        planned_op.comparison_run_id,
        *(planned_op.source_run_ids or []),
    ]
    return [str(run_id) for run_id in ids if run_id]


def _operation_source_ids(operation: Operation) -> list[str]:
    payload = operation.model_dump(mode="json")
    ids = [
        payload.get("source_run_id"),
        payload.get("left_run_id"),
        payload.get("right_run_id"),
        payload.get("baseline_run_id"),
        payload.get("comparison_run_id"),
        *(payload.get("source_run_ids") or []),
    ]
    return [str(run_id) for run_id in ids if run_id]


def _operation_from_payload(payload: dict[str, Any], *, fallback_run_id: str) -> Operation:
    kind = payload.get("kind")
    if kind == "filter":
        return FilterOp.model_validate(payload)
    if kind == "project":
        return ProjectOp.model_validate(payload)
    if kind == "sort":
        return SortOp.model_validate(payload)
    if kind == "slice":
        return SliceOp.model_validate(payload)
    if kind == "aggregate":
        return AggregateOp.model_validate(payload)
    if kind == "join":
        return JoinOp.model_validate(payload)
    if kind == "union":
        return UnionOp.model_validate(payload)
    if kind == "intersect":
        return IntersectOp.model_validate(payload)
    if kind == "compare":
        return CompareOp.model_validate(payload)
    if kind == "commentary":
        return CommentaryOp.model_validate(payload)
    return CommentaryOp(source_run_ids=[fallback_run_id] if fallback_run_id else [], description="Cached operation")


def _legacy_refinement_events_enabled() -> bool:
    import os

    return os.environ.get("ANALYST_LEGACY_REFINEMENT_EVENT", "true").lower() not in {"0", "false", "no"}


async def _handle_execute(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    decision: RouterDecision,
    started: float,
    emit: EmitCallback | None = None,
) -> AnswerResponse:
    if decision.recipe_id not in RECIPES:
        response = NotAnswerableResponse(
            message_id=str(uuid4()),
            message="No registered deterministic recipe can answer this question yet.",
        )
        await _store_assistant_response(pool, conversation_id, response)
        return response  # type: ignore[return-value]
    params = coerce_params(decision.recipe_id, decision.params)
    spec = RECIPES[decision.recipe_id]
    result = await spec.run(content, params, pool, emit=emit)
    if emit:
        await emit("phase_started", {"phase": "synthesize"})
    summary = await summarize_streaming(result, emit=emit)
    total_latency_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit("phase_started", {"phase": "verify"})
    verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms, emit=emit)
    run_id = await _store_recipe_run(
        pool,
        conversation_id=conversation_id,
        message_id=user_message_id,
        result=result,
        summary=summary,
        verification=verification,
        latency_ms=total_latency_ms,
        based_on_run_id=None,
    )
    response = AnswerResponse(
        message_id=str(uuid4()),
        summary=summary,
        findings_preview=result.findings[:5],
        recipe_run_id=str(run_id),
        based_on_run_id=None,
        verification=verification,
        latency_ms=total_latency_ms,
    )
    await _store_assistant_response(pool, conversation_id, response)
    return response


async def _handle_refine(
    *,
    pool: asyncpg.Pool,
    conversation_id: UUID,
    user_message_id: UUID,
    content: str,
    latest_run: dict[str, Any],
    decision: RouterDecision,
    started: float,
    emit: EmitCallback | None = None,
) -> AnswerResponse | NeedsNewConversationResponse:
    findings = list(latest_run.get("findings") or [])
    refinement = decision.refinement_filter or infer_refinement_filter(content, findings)
    if not refinement:
        response = NeedsNewConversationResponse(message_id=str(uuid4()), **_new_conversation_hint(content, latest_run).model_dump())
        await _store_assistant_response(pool, conversation_id, response)
        return response
    refined_findings = apply_refinement(findings, refinement)
    if emit:
        await emit(
            "refinement_filter_applied",
            {"filter": refinement, "before_count": len(findings), "after_count": len(refined_findings)},
        )
    prior_run_id = str(latest_run["run_id"])
    result = RecipeResult(
        recipe_id=str(latest_run["recipe_id"]),
        question=content,
        params={
            **(latest_run.get("params") or {}),
            "_refinement": refinement,
            "_based_on_run_id": prior_run_id,
        },
        findings=refined_findings,
        sql_log=[],
        caveats=[
            *(latest_run.get("caveats") or []),
            f"Refinement used cached findings from recipe_run {prior_run_id}; no new SQL or web search was executed.",
            refinement_description(refinement),
        ],
        source_runs=[],
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    summary = _summary_for_refinement(result, refinement, latest_run)
    if emit:
        await emit("phase_started", {"phase": "synthesize"})
        await emit_cached_summary_tokens(summary, emit=emit)
    total_latency_ms = int((time.perf_counter() - started) * 1000)
    if emit:
        await emit("phase_started", {"phase": "verify"})
    verification = await verify(summary, result, pool, total_latency_ms=total_latency_ms, emit=emit)
    run_id = await _store_recipe_run(
        pool,
        conversation_id=conversation_id,
        message_id=user_message_id,
        result=result,
        summary=summary,
        verification=verification,
        latency_ms=total_latency_ms,
        based_on_run_id=UUID(prior_run_id),
    )
    response = AnswerResponse(
        message_id=str(uuid4()),
        summary=summary,
        findings_preview=result.findings[:5],
        recipe_run_id=str(run_id),
        based_on_run_id=prior_run_id,
        verification=verification,
        latency_ms=total_latency_ms,
    )
    await _store_assistant_response(pool, conversation_id, response)
    return response


async def _store_recipe_run(
    pool: asyncpg.Pool,
    *,
    conversation_id: UUID,
    message_id: UUID,
    result: RecipeResult,
    summary: Summary,
    verification: VerificationResult,
    latency_ms: int,
    based_on_run_id: UUID | None,
    is_derived: bool = False,
    derived_op: dict[str, Any] | None = None,
    op_hash: str | None = None,
    source_run_ids: list[str] | None = None,
    run_id: UUID | None = None,
) -> UUID:
    run_id = run_id or uuid4()
    await pool.execute(
        """
INSERT INTO investigator.ship_recipe_runs
    (run_id, conversation_id, message_id, based_on_run_id, recipe_id, params, findings, sql_log, summary, verification, latency_ms, is_derived, derived_op, op_hash, source_run_ids)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14, $15::jsonb)
""".strip(),
        run_id,
        conversation_id,
        message_id,
        based_on_run_id,
        result.recipe_id,
        _json_param(result.params),
        _json_param(result.findings),
        _json_param([entry.model_dump(mode="json") for entry in result.sql_log]),
        _json_param(summary.model_dump(mode="json")),
        _json_param(verification.model_dump(mode="json")),
        latency_ms,
        is_derived,
        _json_param(derived_op) if derived_op is not None else None,
        op_hash,
        _json_param(source_run_ids or []),
    )
    await _touch_conversation(pool, conversation_id)
    return run_id


async def _store_assistant_response(pool: asyncpg.Pool, conversation_id: UUID, response: AssistantResponse) -> None:
    await _store_message(
        pool,
        conversation_id=conversation_id,
        role="assistant",
        content=response.model_dump(mode="json"),
        message_id=UUID(response.message_id),
    )


async def _store_message(
    pool: asyncpg.Pool,
    *,
    conversation_id: UUID,
    role: Literal["user", "assistant"],
    content: dict[str, Any],
    message_id: UUID | None = None,
) -> UUID:
    message_id = message_id or uuid4()
    await pool.execute(
        """
INSERT INTO investigator.ship_messages (message_id, conversation_id, role, content)
VALUES ($1, $2, $3, $4::jsonb)
""".strip(),
        message_id,
        conversation_id,
        role,
        _json_param(content),
    )
    await _touch_conversation(pool, conversation_id)
    return message_id


async def _load_active_conversation(pool: asyncpg.Pool, conversation_id: UUID) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        """
SELECT conversation_id, title, status, created_at, updated_at
FROM investigator.ship_conversations
WHERE conversation_id = $1 AND status <> 'archived'
""".strip(),
        conversation_id,
    )
    return _record_to_json(row) if row else None


async def _latest_recipe_run(pool: asyncpg.Pool, conversation_id: UUID) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        """
SELECT run_id, conversation_id, message_id, based_on_run_id, recipe_id, params, findings, sql_log, summary, verification, latency_ms, created_at
FROM investigator.ship_recipe_runs
WHERE conversation_id = $1
ORDER BY created_at DESC, run_id DESC
LIMIT 1
""".strip(),
        conversation_id,
    )
    if row is None:
        return None
    payload = _record_to_json(row)
    payload["caveats"] = []
    return payload


async def _ensure_conversation_title(
    pool: asyncpg.Pool,
    conversation_id: UUID,
    conversation: dict[str, Any],
    content: str,
) -> None:
    if conversation.get("title"):
        return
    title = " ".join(content.strip().split())[:90] or "Untitled conversation"
    await pool.execute(
        "UPDATE investigator.ship_conversations SET title = $2, updated_at = now() WHERE conversation_id = $1",
        conversation_id,
        title,
    )


async def _touch_conversation(pool: asyncpg.Pool, conversation_id: UUID) -> None:
    await pool.execute(
        "UPDATE investigator.ship_conversations SET updated_at = now() WHERE conversation_id = $1",
        conversation_id,
    )


def _controller_adjusted_decision(
    content: str,
    decision: RouterDecision,
    latest_run: dict[str, Any] | None,
) -> RouterDecision:
    if latest_run is not None:
        if decision.decision == "refine":
            return decision
        inferred = infer_refinement_filter(content, list(latest_run.get("findings") or []))
        if inferred:
            decision.decision = "refine"
            decision.recipe_id = str(latest_run["recipe_id"])
            decision.refinement_filter = inferred
            return decision
        decision.decision = "needs_new_conversation"
        decision.recipe_id = None
        decision.new_conversation_hint = decision.new_conversation_hint or _new_conversation_hint(content, latest_run)
        return decision

    if decision.decision == "execute" and decision.recipe_id in REQUIRES_SPECIFICITY and not _has_specificity(content) and not _wants_broad_scan(content):
        decision.decision = "clarify"
        decision.clarification = decision.clarification or _clarification_payload(decision.recipe_id, content)
    return decision


def _router_context(latest_run: dict[str, Any] | None) -> dict[str, Any] | None:
    if latest_run is None:
        return None
    findings = list(latest_run.get("findings") or [])
    columns = sorted({str(key) for row in findings[:10] if isinstance(row, dict) for key in row})
    summary = latest_run.get("summary") or {}
    return {
        "recipe_id": latest_run.get("recipe_id"),
        "params": latest_run.get("params") or {},
        "finding_row_count": len(findings),
        "finding_columns": columns,
        "sample_rows": [_compact(row) for row in findings[:3]],
        "summary_headline": summary.get("headline") if isinstance(summary, dict) else None,
    }


def _summary_for_refinement(
    result: RecipeResult,
    refinement: dict[str, Any],
    latest_run: dict[str, Any],
) -> Summary:
    description = _safe_refinement_description(refinement)
    if not result.findings:
        return Summary(
            headline="Cached refinement found no matching findings.",
            paragraphs=[
                Paragraph(
                    text="The requested cached refinement did not match any findings from the prior investigation.",
                    citations=[],
                )
            ],
            caveats=result.caveats,
        )

    amount_column = _best_summary_amount_column(result.findings)
    snippets: list[str] = []
    citations: list[Citation] = []
    for index, row in enumerate(result.findings[:5]):
        label = _row_label(row)
        amount = row.get(amount_column) if amount_column else None
        if amount_column and amount is not None:
            snippets.append(f"{label} has {amount_column} {amount}")
        else:
            snippets.append(label)
        citations.append(Citation(finding_index=index))

    prior_headline = ""
    prior_summary = latest_run.get("summary") or {}
    if isinstance(prior_summary, dict):
        prior_headline = str(prior_summary.get("headline") or "")
    context = f" from the prior {latest_run.get('recipe_id')} result"
    if prior_headline:
        context = f" from the prior result, {prior_headline}"

    return Summary(
        headline="Cached refinement returned matching public-accountability findings.",
        paragraphs=[
            Paragraph(
                text=f"This answer is an in-memory refinement{context}: {description}. Leading matching rows are {', '.join(snippets)}.",
                citations=citations,
            )
        ],
        caveats=result.caveats,
    )


def _row_label(row: dict[str, Any]) -> str:
    for key in ("canonical_name", "supplier_name", "source_legal_name", "entity_name", "recipient_name"):
        value = row.get(key)
        if value:
            return str(value)
    return "a returned finding row"


def _safe_refinement_description(refinement: dict[str, Any]) -> str:
    operation = str(refinement.get("operation") or "refinement")
    column = refinement.get("column")
    if operation == "filter" and column:
        return f"filtered cached findings by {column}"
    if operation == "sort" and column:
        return f"sorted cached findings by {column}"
    if operation == "detail":
        return "selected a cached finding detail"
    return "refined cached findings"


def _best_summary_amount_column(findings: list[dict[str, Any]]) -> str | None:
    for column in ("total_funding_known", "total_government_funding", "total_all_funding", "total_flow", "total_amount", "amount", "combined_funding"):
        if any(row.get(column) is not None for row in findings):
            return column
    return None


def _clarification_payload(recipe_id: str | None, content: str) -> ClarificationPayload:
    label = recipe_id or "this recipe"
    return ClarificationPayload(
        headline="This is broad enough to scan many funded entities. Narrow it for a precise answer.",
        reason=f"{label} without a named entity, top-N bound, time window, dimension restriction, or amount threshold",
        suggested_narrowings=[
            "Name the organization, for example 'Hockey Canada'.",
            "Bound by magnitude, for example 'top 10 federal recipients over $50M'.",
            "Bound by time, for example 'with court records since 2022'.",
        ],
        example_refinements=[
            "Tell me about Hockey Canada's adverse coverage",
            "Top 10 federal recipients over $50M with regulatory enforcement in 2023-2024",
        ],
        proceed_phrase="run the broad scan anyway",
    )


def _new_conversation_hint(content: str, latest_run: dict[str, Any] | None) -> NewConversationHint:
    topic = None
    if latest_run:
        summary = latest_run.get("summary") or {}
        topic = summary.get("headline") if isinstance(summary, dict) else None
        if not topic:
            topic = str(latest_run.get("recipe_id") or "previous investigation")
    return NewConversationHint(
        reason=f"Your follow-up asks about '{content.strip()}', which goes beyond the cached findings in this conversation.",
        suggested_starter=content.strip()[:160] or "Start a new public-accountability question",
        current_conversation_topic=topic,
    )


def _has_specificity(content: str) -> bool:
    text = content.strip()
    lowered = text.lower()
    if re.search(r"\b(?:top\s+\d+|\d+\s+(?:orgs|organizations|recipients|cases|records))\b", lowered):
        return True
    if re.search(r"\b(?:19|20)\d{2}\b", lowered):
        return True
    if re.search(r"(?:\$|over|above|at least)\s*\$?\s*\d", lowered):
        return True
    if any(term in lowered for term in ("alberta", "federal", "ontario", "quebec", "ministry", "health", "climate", "cra", "contract", "grant")):
        return True
    if re.search(r"\b[A-Z]{2,}\b", text):
        return True
    if re.search(r"\b[A-Z][a-z]+(?:\s+[A-Z][A-Za-z&.'-]+)+\b", text):
        return True
    return False


def _wants_broad_scan(content: str) -> bool:
    lowered = content.lower()
    return any(phrase in lowered for phrase in ("run the broad scan anyway", "do the broad scan", "yes go ahead", "go ahead", "run it"))


def _record_to_json(row: asyncpg.Record | None) -> dict[str, Any]:
    if row is None:
        return {}
    return {key: _json_load(json_ready(value)) for key, value in dict(row).items()}


def _json_param(value: Any) -> str:
    return json.dumps(json_ready(value), ensure_ascii=False)


def _json_load(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in {"{", "["}:
        return json.loads(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def _compact(value: Any, *, depth: int = 0) -> Any:
    if depth >= 2:
        return "<nested>"
    if isinstance(value, dict):
        return {str(key): _compact(item, depth=depth + 1) for key, item in list(value.items())[:10]}
    if isinstance(value, list):
        return [_compact(item, depth=depth + 1) for item in value[:5]]
    if isinstance(value, str):
        return value if len(value) <= 300 else value[:297].rstrip() + "..."
    return value
