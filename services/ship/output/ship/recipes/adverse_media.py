"""Recipe: discover adverse public signals, then match them to funded entities."""

from __future__ import annotations

import math
import asyncio
import time
from typing import Any, Literal

import asyncpg

from .base import RecipeParams, RecipeResult, recipe_result
from ..primitives import adverse_signal_discovery, classify_adverse_seriousness
from ..primitives.base import EmitCallback, PrimitiveResult, SQLLogEntry, emit_primitive_completed, emit_primitive_started, run_query


SERIOUSNESS_RANK = {
    "noise": 0,
    "settlement": 1,
    "fraud_allegation": 2,
    "safety_incident": 3,
    "audit_finding": 4,
    "regulatory_enforcement": 5,
    "pending_charge": 6,
    "conviction": 7,
}

PUBLIC_AUTHORITY_NAME_PATTERNS = (
    "health services",
    "regional health",
    "hospital authority",
    "school board",
    "school division",
    "public school",
    "municipality",
    "city of ",
    "town of ",
    "county of ",
    "municipal district",
    "government of ",
    "province of ",
    "ministry of ",
    "department of ",
)


class Params(RecipeParams):
    max_signals: int = 15
    max_searches: int = 6
    jurisdiction: Literal["ca", "ab", "on", "qc", "all"] | None = None
    lookback_years: int = 5
    min_seriousness: Literal[
        "audit_finding",
        "regulatory_enforcement",
        "pending_charge",
        "conviction",
    ] = "audit_finding"
    include_public_authorities: bool = True
    min_funding: float | None = None


def humanize(params: dict) -> str:
    jurisdiction = params.get("jurisdiction") or "Canada"
    max_signals = params.get("max_signals") or 15
    return f"Adverse-media signals in {jurisdiction} ({max_signals} candidates)"


async def run(question: str, params: Params, pool: asyncpg.Pool, *, emit: EmitCallback | None = None) -> RecipeResult:
    started = time.perf_counter()
    signals = await adverse_signal_discovery.run(
        max_signals=params.max_signals,
        max_searches=params.max_searches,
        jurisdiction=params.jurisdiction,
        lookback_years=params.lookback_years,
        emit=emit,
    )
    matched, match_run = await match_signals_to_funding(pool, signals.rows, params, emit=emit)
    classified_rows: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    min_rank = SERIOUSNESS_RANK[params.min_seriousness]

    classification_candidates = matched[: max(1, min(int(params.top_n), 20))]
    classifications = await _classify_candidates(classification_candidates, emit=emit)

    for candidate, classification in zip(classification_candidates, classifications, strict=False):
        row = {
            **candidate,
            "seriousness_level": classification.level,
            "supports_funder_concern": classification.supports_funder_concern,
            "rationale": classification.rationale,
        }
        classified_rows.append(row)
        rank = SERIOUSNESS_RANK.get(classification.level, 0)
        if row["finding_kind"] == "public_system_oversight":
            if params.include_public_authorities and classification.level != "noise":
                findings.append(row)
        elif classification.supports_funder_concern and rank >= min_rank:
            findings.append(row)

    classification_run = PrimitiveResult(
        primitive_name="classify_adverse_seriousness",
        rows=classified_rows,
        sql_log=[],
        caveats=["Adverse seriousness is classified from the cited source snippet and is not a legal determination."],
        timing_ms=0,
    )
    findings.sort(
        key=lambda row: (
            0 if row.get("finding_kind") == "external_recipient" else 1,
            -SERIOUSNESS_RANK.get(str(row.get("seriousness_level")), 0),
            -float(row.get("total_funding_known") or 0),
            str(row.get("canonical_name") or ""),
        )
    )
    return recipe_result(
        recipe_id="adverse_media",
        question=question,
        params=params,
        source_runs=[signals, match_run, classification_run],
        findings=findings,
        latency_ms=int((time.perf_counter() - started) * 1000),
        caveats=[
            "Adverse-media candidates are discovered from bounded serious-signal web search first, then matched to public-funding records.",
            "Public delivery authorities are shown separately from external recipients so routine system oversight does not dominate funder-risk leads.",
        ],
    )


async def match_signals_to_funding(
    pool: asyncpg.Pool,
    signals: list[dict[str, Any]],
    params: Params,
    *,
    emit: EmitCallback | None = None,
) -> tuple[list[dict[str, Any]], PrimitiveResult]:
    started = time.perf_counter()
    await emit_primitive_started(
        emit,
        "adverse_signal_funding_match",
        {"signal_count": len(signals), "min_funding": params.min_funding},
    )
    sql_logs: list[SQLLogEntry] = []
    matched: list[dict[str, Any]] = []
    seen_entities: set[int] = set()
    signal_inputs: list[tuple[int, dict[str, Any], str, str]] = []

    for index, signal in enumerate(signals):
        entity_name = str(signal.get("entity_name") or "").strip()
        source_url = str(signal.get("source_url") or "").strip()
        if not entity_name or not source_url:
            continue
        signal_inputs.append((index, signal, entity_name, source_url))

    candidate_results = await asyncio.gather(
        *[
            _candidate_entity_matches(pool, entity_name, index, emit=emit)
            for index, _signal, entity_name, _source_url in signal_inputs
        ]
    )
    candidates_by_signal: dict[int, list[dict[str, Any]]] = {}
    candidate_ids: set[int] = set()
    for (index, _signal, _entity_name, _source_url), (candidate_rows, log) in zip(signal_inputs, candidate_results, strict=False):
        sql_logs.append(log)
        candidates_by_signal[index] = candidate_rows
        for candidate in candidate_rows:
            candidate_ids.add(int(candidate["entity_id"]))

    funding_by_id: dict[int, dict[str, Any]] = {}
    if candidate_ids:
        funding_rows, funding_log = await _funding_rows_for_candidates(pool, sorted(candidate_ids), params.min_funding, emit=emit)
        sql_logs.append(funding_log)
        funding_by_id = {int(row["entity_id"]): row for row in funding_rows}

    for index, signal, entity_name, source_url in signal_inputs:
        rows = []
        for candidate in candidates_by_signal.get(index, []):
            funding = funding_by_id.get(int(candidate["entity_id"]))
            if funding is not None:
                rows.append({**funding, "name_match_score": candidate.get("name_match_score", 0)})
        selected = _select_best_candidate(rows)
        if selected is None:
            continue
        entity_id = int(selected["entity_id"])
        if entity_id in seen_entities:
            continue
        seen_entities.add(entity_id)
        canonical_name = str(selected["canonical_name"])
        finding_kind = "public_system_oversight" if _is_public_authority(selected) else "external_recipient"
        matched.append(
            {
                "finding_kind": finding_kind,
                "canonical_name": canonical_name,
                "entity_id": entity_id,
                "signal_entity_name": entity_name,
                "matched_dataset_sources": selected.get("dataset_sources") or [],
                "entity_type": selected.get("entity_type"),
                "total_funding_known": float(selected.get("total_all_funding") or 0),
                "funding_overlap": True,
                "name_match_score": float(selected.get("name_match_score") or 0),
                "signal_kind": signal.get("signal_kind"),
                "source_url": source_url,
                "source_kind": signal.get("source_kind"),
                "source_jurisdiction": signal.get("source_jurisdiction"),
                "snippet": signal.get("snippet") or "",
                "snippet_120": str(signal.get("snippet") or "")[:120],
            }
        )

    result = PrimitiveResult(
        primitive_name="adverse_signal_funding_match",
        rows=matched,
        sql_log=sql_logs,
        caveats=["Funding overlap is confirmed through general.vw_entity_funding canonical entity records."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return matched, result


async def _candidate_entity_matches(
    pool: asyncpg.Pool,
    entity_name: str,
    index: int,
    *,
    emit: EmitCallback | None = None,
) -> tuple[list[dict[str, Any]], SQLLogEntry]:
    sql = """
SELECT
    gr.id AS entity_id,
    gr.canonical_name,
    similarity(gr.canonical_name, $1::text) AS name_match_score
FROM general.entity_golden_records gr
WHERE gr.canonical_name % $1::text
   OR lower(gr.canonical_name) = lower($1::text)
ORDER BY similarity(gr.canonical_name, $1::text) DESC, gr.canonical_name
LIMIT 20
""".strip()
    return await run_query(
        pool,
        query_name=f"adverse_signal_entity_candidates_{index}",
        sql=sql,
        params=[entity_name],
        statement_timeout_ms=30_000,
        emit=emit,
        primitive_name="adverse_signal_funding_match",
    )


async def _funding_rows_for_candidates(
    pool: asyncpg.Pool,
    entity_ids: list[int],
    min_funding: float | None,
    *,
    emit: EmitCallback | None = None,
) -> tuple[list[dict[str, Any]], SQLLogEntry]:
    sql = """
SELECT
    f.entity_id,
    f.canonical_name,
    f.entity_type,
    f.dataset_sources,
    f.source_count,
    f.fed_total_grants,
    f.ab_total_grants,
    f.ab_total_contracts,
    f.ab_total_sole_source,
    f.total_all_funding
FROM general.vw_entity_funding f
WHERE f.entity_id = ANY($1::int[])
  AND f.total_all_funding > COALESCE($2::numeric, 0::numeric)
""".strip()
    return await run_query(
        pool,
        query_name="adverse_signal_candidate_funding_rows",
        sql=sql,
        params=[entity_ids, min_funding],
        statement_timeout_ms=30_000,
        emit=emit,
        primitive_name="adverse_signal_funding_match",
    )


def _select_best_candidate(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    return max(rows, key=_candidate_score)


def _candidate_score(row: dict[str, Any]) -> float:
    match_score = float(row.get("name_match_score") or 0)
    funding = float(row.get("total_all_funding") or 0)
    source_count = float(row.get("source_count") or 0)
    return match_score * 100.0 + math.log10(max(funding, 1.0)) + min(source_count, 10.0) / 20.0


def _is_public_authority(row: dict[str, Any]) -> bool:
    name = str(row.get("canonical_name") or "").lower()
    entity_type = str(row.get("entity_type") or "").lower()
    if "public_authority" in entity_type:
        return True
    return any(pattern in name for pattern in PUBLIC_AUTHORITY_NAME_PATTERNS)


async def _classify_candidates(
    candidates: list[dict[str, Any]],
    *,
    emit: EmitCallback | None = None,
) -> list[classify_adverse_seriousness.SeriousnessClass]:
    semaphore = asyncio.Semaphore(4)

    async def classify_one(candidate: dict[str, Any]) -> classify_adverse_seriousness.SeriousnessClass:
        async with semaphore:
            return await classify_adverse_seriousness.classify(
                entity_name=str(candidate["canonical_name"]),
                source_url=str(candidate["source_url"]),
                snippet=str(candidate.get("snippet_120") or candidate.get("snippet") or ""),
                emit=emit,
            )

    return await asyncio.gather(*(classify_one(candidate) for candidate in candidates))
