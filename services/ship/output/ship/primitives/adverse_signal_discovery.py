"""Discover serious adverse public signals before matching to funding data."""

from __future__ import annotations

import json
import re
import time
import asyncio
from datetime import date, timedelta
from typing import Any, Literal

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, WebSearchTool, set_default_openai_key
from openai.types.shared import Reasoning
from pydantic import Field

from . import canlii_case_search
from .base import EmitCallback, PrimitiveResult, StrictModel, emit_primitive_completed, emit_primitive_started
from ..runtime_config import settings


SignalKind = Literal[
    "regulatory_enforcement",
    "criminal_charge",
    "fraud_allegation",
    "safety_incident",
    "sanction",
    "audit_finding",
]
SourceKind = Literal["regulator", "court", "auditor", "media", "government_report"]
Jurisdiction = Literal["ca", "ab", "on", "qc", "all"]


class RawSignalHit(StrictModel):
    title: str
    source_url: str
    source_kind: str
    snippet: str
    source_jurisdiction: str | None = None


class RawSignalHits(StrictModel):
    hits: list[RawSignalHit] = Field(default_factory=list)


class ExtractedSignal(StrictModel):
    keep: bool
    entity_name: str
    signal_kind: str
    source_kind: str
    snippet: str
    source_jurisdiction: str | None = None
    rationale: str


class AdverseSignalRow(StrictModel):
    entity_name: str
    signal_kind: SignalKind
    source_url: str
    source_kind: SourceKind
    snippet: str
    source_jurisdiction: str | None = None


DISCOVERY_CAVEATS = [
    "Adverse signal discovery is bounded by web-search recall and extraction precision; some serious cases may be missed.",
    "Source classification is an LLM extraction, not a legal verdict.",
]


def _discovery_agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Adverse Signal Discovery",
        model="gpt-5.5",
        tools=[WebSearchTool(search_context_size="high", external_web_access=True)],
        output_type=AgentOutputSchema(RawSignalHits, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="low"),
            verbosity="low",
            max_tokens=4096,
            include_usage=True,
            prompt_cache_retention="24h",
            parallel_tool_calls=False,
        ),
        instructions=(
            "Find recent Canadian organizations named in serious adverse public-accountability sources. "
            "Use the supplied site-qualified search templates; do not add named organizations to the queries. "
            "Return direct https source URLs, not search pages, home pages, login pages, or generic archives. "
            "Strong sources include official auditors, prosecutors, environmental and safety regulators, competition authorities, courts, sanctions/debarment bodies, and government reports. "
            "Serious signals are regulatory enforcement, criminal charges or convictions, fraud allegations in official proceedings, safety incidents with public reports, sanctions/debarments, and audit findings. "
            "Maximize diversity across source families and jurisdictions. Do not return more than two hits from one domain unless the hit is materially different and names a different organization. "
            "Do not return political controversy, op-eds, commentary, funding announcements, self-promotion, or vague reputational criticism. "
            "Each snippet must include the named organization or a clear alias plus the concrete adverse fact."
        ),
    )


def _extractor_agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Adverse Signal Extractor",
        model="gpt-5.5",
        output_type=AgentOutputSchema(ExtractedSignal, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="low"),
            verbosity="low",
            max_tokens=512,
            include_usage=True,
            prompt_cache_retention="24h",
        ),
        instructions=(
            "Extract the named Canadian organization and adverse signal from one source hit. "
            "Keep only regulator, court, auditor, government-report, sanction, safety, fraud, criminal, or formal enforcement facts. "
            "Drop commentary, political disputes, advocacy, routine oversight with no adverse fact, unrelated name collisions, and self-published promotion. "
            "Use the source's language only; do not infer legal conclusions beyond the snippet. "
            "If the organization is only an acronym and the source gives a full legal name, return the full legal name."
        ),
    )


async def run(
    *,
    max_signals: int = 15,
    max_searches: int = 6,
    jurisdiction: Jurisdiction | None = None,
    lookback_years: int = 5,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    started = time.perf_counter()
    search_cap = max(1, min(int(max_searches), 6))
    signal_cap = max(1, min(int(max_signals), 15))
    after_date = (date.today() - timedelta(days=max(1, int(lookback_years)) * 365)).isoformat()
    await emit_primitive_started(
        emit,
        "adverse_signal_discovery",
        {"max_signals": signal_cap, "max_searches": search_cap, "jurisdiction": jurisdiction, "lookback_years": lookback_years},
    )
    raw_hits = await _run_search_templates(
        _query_templates(jurisdiction)[:search_cap],
        jurisdiction=jurisdiction or "all",
        lookback_years=max(1, int(lookback_years)),
        emit=emit,
    )

    rows: list[dict[str, Any]] = []
    seen_entities: set[str] = set()
    selected_hits = raw_hits[:signal_cap]
    extractions = await _extract_hits(selected_hits)
    for hit, extracted in zip(selected_hits, extractions, strict=False):
        if len(rows) >= signal_cap:
            break
        if not _usable_url(hit.source_url):
            continue
        signal_kind = _coerce_signal_kind(extracted.signal_kind) or _coerce_signal_kind(f"{hit.title} {hit.snippet}")
        source_kind = _coerce_source_kind(extracted.source_kind) or _coerce_source_kind(hit.source_kind)
        if not extracted.keep or signal_kind is None or source_kind is None:
            continue
        normalized = _normalize_name(extracted.entity_name)
        if not normalized or normalized in seen_entities:
            continue
        seen_entities.add(normalized)
        rows.append(
            AdverseSignalRow(
                entity_name=extracted.entity_name.strip(),
                signal_kind=signal_kind,
                source_url=hit.source_url.strip(),
                source_kind=source_kind,
                snippet=_compact_snippet(extracted.snippet or hit.snippet),
                source_jurisdiction=extracted.source_jurisdiction or hit.source_jurisdiction,
            ).model_dump(mode="json")
        )

    canlii_rows = await _canlii_enrichment(rows, seen_entities, jurisdiction, after_date, signal_cap, emit)
    rows.extend(canlii_rows)

    result = PrimitiveResult(
        primitive_name="adverse_signal_discovery",
        rows=rows[:signal_cap],
        sql_log=[],
        caveats=DISCOVERY_CAVEATS,
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    await emit_primitive_completed(emit, result)
    return result


async def _extract(hit: RawSignalHit) -> ExtractedSignal:
    payload = {
        "title": hit.title,
        "source_url": hit.source_url,
        "source_kind": hit.source_kind,
        "snippet": hit.snippet[:700],
        "source_jurisdiction": hit.source_jurisdiction,
    }
    result = await Runner.run(_extractor_agent(), json.dumps(payload, ensure_ascii=False), max_turns=1)
    return result.final_output


async def _extract_hits(hits: list[RawSignalHit]) -> list[ExtractedSignal]:
    semaphore = asyncio.Semaphore(5)

    async def extract_one(hit: RawSignalHit) -> ExtractedSignal:
        async with semaphore:
            return await _extract(hit)

    return await asyncio.gather(*(extract_one(hit) for hit in hits))


async def _run_search_templates(
    templates: list[str],
    *,
    jurisdiction: str,
    lookback_years: int,
    emit: EmitCallback | None,
) -> list[RawSignalHit]:
    payloads = [
        {
            "jurisdiction": jurisdiction,
            "lookback_years": lookback_years,
            "max_raw_hits": 4,
            "search_template": template,
        }
        for template in templates
    ]
    async def run_one(payload: dict[str, Any]) -> Any:
        query = str(payload["search_template"])
        started = time.perf_counter()
        if emit:
            await emit("web_search_started", {"primitive_name": "adverse_signal_discovery", "query": query})
        result = await Runner.run(_discovery_agent(), json.dumps(payload, ensure_ascii=False), max_turns=2)
        result_count = len(result.final_output.hits)
        if emit:
            await emit(
                "web_search_completed",
                {
                    "primitive_name": "adverse_signal_discovery",
                    "query": query,
                    "result_count": result_count,
                    "timing_ms": int((time.perf_counter() - started) * 1000),
                },
            )
        return result

    results = await asyncio.gather(*(run_one(payload) for payload in payloads))
    buckets: list[list[RawSignalHit]] = []
    seen_urls: set[str] = set()
    for result in results:
        bucket: list[RawSignalHit] = []
        for hit in result.final_output.hits:
            url_key = hit.source_url.strip().lower()
            if not url_key or url_key in seen_urls:
                continue
            seen_urls.add(url_key)
            bucket.append(hit)
            if len(bucket) >= 4:
                break
        buckets.append(bucket)
    hits: list[RawSignalHit] = []
    max_bucket_len = max((len(bucket) for bucket in buckets), default=0)
    for index in range(max_bucket_len):
        for bucket in buckets:
            if index < len(bucket):
                hits.append(bucket[index])
    return hits


async def _canlii_enrichment(
    rows: list[dict[str, Any]],
    seen_entities: set[str],
    jurisdiction: str | None,
    after_date: str,
    signal_cap: int,
    emit: EmitCallback | None,
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows[:3]:
        if len(rows) + len(enriched) >= signal_cap:
            break
        canlii = await canlii_case_search.run(
            entity_name=str(row["entity_name"]),
            max_results=5,
            jurisdiction=None if jurisdiction in {None, "all"} else str(jurisdiction),
            decision_date_after=after_date,
            emit=emit,
        )
        for item in canlii.rows[:1]:
            normalized = _normalize_name(str(item.get("entity_name") or row["entity_name"]))
            if normalized in seen_entities:
                continue
            seen_entities.add(normalized)
            enriched.append(
                {
                    "entity_name": item.get("entity_name") or row["entity_name"],
                    "signal_kind": "regulatory_enforcement",
                    "source_url": item.get("source_url"),
                    "source_kind": "court",
                    "snippet": _compact_snippet(str(item.get("snippet") or item.get("title") or "")),
                    "source_jurisdiction": jurisdiction if jurisdiction != "all" else None,
                    "api_source": item.get("api_source"),
                    "api_source_url": item.get("api_source_url"),
                }
            )
    return enriched


def _query_templates(jurisdiction: str | None) -> list[str]:
    jurisdiction_text = "" if jurisdiction in {None, "all"} else f" {jurisdiction}"
    return [
        f"site:canada.ca/en/auditor-general conflict of interest contribution agreements foundation audit finding recipient{jurisdiction_text}",
        f"site:canada.ca/en/environment-climate-change/news pleaded guilty Fisheries Act fined company environmental offences Canada{jurisdiction_text}",
        f"site:canada.ca/en/environment-climate-change/news charges Fisheries Act company mine deleterious substance Canada{jurisdiction_text}",
        f"site:ppsc-sppc.gc.ca fraud guilty plea company corruption Canada OR site:worldbank.org debarred Canadian company affiliates corruption{jurisdiction_text}",
        f"site:canada.ca/en/canadian-heritage funding frozen audit conditions sport organization sexual assault Canada{jurisdiction_text}",
        f"site:aer.ca Kearl environmental protection order administrative penalty company Alberta{jurisdiction_text}",
        f"site:competition-bureau.canada.ca gasoline price fixing company guilty consent agreement Canada{jurisdiction_text}",
        f"site:aer.ca administrative penalty environmental company oil sands Alberta{jurisdiction_text}",
        f"site:news.ontario.ca court fined company environmental safety conviction Canada{jurisdiction_text}",
    ]


def _usable_url(url: str) -> bool:
    lowered = url.lower().strip()
    blocked = ("login", "/search", "google.", "bing.", "duckduckgo.", "wikipedia.org")
    return lowered.startswith("https://") and not any(fragment in lowered for fragment in blocked)


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _compact_snippet(value: str) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    return text[:700]


def _coerce_signal_kind(value: str) -> SignalKind | None:
    lowered = value.strip().lower().replace(" ", "_").replace("-", "_")
    mapping = {
        "conviction": "regulatory_enforcement",
        "criminal": "criminal_charge",
        "charge": "criminal_charge",
        "charges": "criminal_charge",
        "criminal_charges": "criminal_charge",
        "enforcement": "regulatory_enforcement",
        "regulatory_action": "regulatory_enforcement",
        "regulatory_enforcement": "regulatory_enforcement",
        "fraud": "fraud_allegation",
        "fraud_allegation": "fraud_allegation",
        "safety": "safety_incident",
        "safety_incident": "safety_incident",
        "sanction": "sanction",
        "debarment": "sanction",
        "debarred": "sanction",
        "audit": "audit_finding",
        "audit_finding": "audit_finding",
    }
    coerced = mapping.get(lowered)
    if coerced is None:
        if "audit" in lowered:
            coerced = "audit_finding"
        elif "charge" in lowered or "criminal" in lowered:
            coerced = "criminal_charge"
        elif "fraud" in lowered:
            coerced = "fraud_allegation"
        elif "safety" in lowered:
            coerced = "safety_incident"
        elif "sanction" in lowered or "debar" in lowered:
            coerced = "sanction"
        elif "regulat" in lowered or "enforce" in lowered or "penalt" in lowered or "fine" in lowered:
            coerced = "regulatory_enforcement"
    return coerced if coerced in {"regulatory_enforcement", "criminal_charge", "fraud_allegation", "safety_incident", "sanction", "audit_finding"} else None


def _coerce_source_kind(value: str) -> SourceKind | None:
    lowered = value.strip().lower().replace(" ", "_").replace("-", "_")
    mapping = {
        "regulator": "regulator",
        "regulatory": "regulator",
        "court": "court",
        "auditor": "auditor",
        "audit": "auditor",
        "media": "media",
        "government_report": "government_report",
        "government": "government_report",
        "prosecutor": "government_report",
        "prosecution": "government_report",
        "sanction": "government_report",
        "debarment": "government_report",
    }
    coerced = mapping.get(lowered)
    if coerced is None:
        if "auditor" in lowered or "audit" in lowered:
            coerced = "auditor"
        elif "court" in lowered:
            coerced = "court"
        elif "prosecut" in lowered or "government" in lowered or "report" in lowered:
            coerced = "government_report"
        elif "regulator" in lowered or "authority" in lowered or "enforcement" in lowered:
            coerced = "regulator"
        elif "media" in lowered or "news" in lowered:
            coerced = "media"
    return coerced if coerced in {"regulator", "court", "auditor", "media", "government_report"} else None
