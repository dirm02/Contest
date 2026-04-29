"""Bounded CanLII API metadata lookup for adverse-media court records."""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import EmitCallback, PrimitiveResult, emit_primitive_completed, emit_primitive_started
from ..runtime_config import settings


SEARCH_URL = "https://api.canlii.org/v1/search/en/"
METADATA_URL = "https://api.canlii.org/v1/caseBrowse/en/{database_id}/{case_id}/"


async def run(
    *,
    entity_name: str,
    max_results: int = 5,
    jurisdiction: str | None = None,
    decision_date_after: str | None = None,
    emit: EmitCallback | None = None,
) -> PrimitiveResult:
    """Search CanLII case metadata for an entity name through the REST API."""
    started = time.perf_counter()
    bounded_results = max(1, min(int(max_results), 5))
    query_label = f"fullText={entity_name!r}; jurisdiction={jurisdiction or 'all'}; after={decision_date_after or 'none'}"
    await emit_primitive_started(
        emit,
        "canlii_case_search",
        {"entity_name": entity_name, "max_results": bounded_results, "jurisdiction": jurisdiction, "decision_date_after": decision_date_after},
    )
    key = settings.canlii_key_value()
    if not key:
        result = PrimitiveResult(
            primitive_name="canlii_case_search",
            rows=[],
            sql_log=[],
            caveats=["CANLII_API_KEY not configured; CanLII results unavailable."],
            timing_ms=int((time.perf_counter() - started) * 1000),
        )
        await emit_primitive_completed(emit, result)
        return result

    params: dict[str, Any] = {
        "api_key": key,
        "offset": 0,
        "resultCount": bounded_results,
        "fullText": f'"{entity_name}"',
    }
    if jurisdiction:
        params["jurisdiction"] = jurisdiction.strip().lower()
    if decision_date_after:
        params["decisionDateAfter"] = decision_date_after

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        if emit:
            await emit("canlii_started", {"entity_name": entity_name, "query": query_label})
        search_response = await client.get(SEARCH_URL, params=params)
        if search_response.status_code in {401, 403, 429}:
            result = _unavailable(started, f"CanLII API returned HTTP {search_response.status_code}; CanLII results unavailable.")
            if emit:
                await emit("canlii_completed", {"entity_name": entity_name, "case_count": 0, "timing_ms": result.timing_ms})
            await emit_primitive_completed(emit, result)
            return result
        search_response.raise_for_status()
        cases = _case_results(search_response.json())
        if not cases:
            result = PrimitiveResult(
                primitive_name="canlii_case_search",
                rows=[],
                sql_log=[],
                caveats=[f"No CanLII case metadata returned for {entity_name!r}."],
                timing_ms=int((time.perf_counter() - started) * 1000),
            )
            if emit:
                await emit("canlii_completed", {"entity_name": entity_name, "case_count": 0, "timing_ms": result.timing_ms})
            await emit_primitive_completed(emit, result)
            return result

        first_case = cases[0]
        database_id = str(first_case.get("databaseId") or "").strip()
        case_id = _case_id(first_case.get("caseId"))
        if not database_id or not case_id:
            result = _unavailable(started, "CanLII returned a case result without databaseId or caseId.")
            if emit:
                await emit("canlii_completed", {"entity_name": entity_name, "case_count": 0, "timing_ms": result.timing_ms})
            await emit_primitive_completed(emit, result)
            return result

        metadata_response = await client.get(METADATA_URL.format(database_id=database_id, case_id=case_id), params={"api_key": key})
        if metadata_response.status_code in {401, 403, 429}:
            result = _unavailable(started, f"CanLII case metadata returned HTTP {metadata_response.status_code}; CanLII results unavailable.")
            if emit:
                await emit("canlii_completed", {"entity_name": entity_name, "case_count": 0, "timing_ms": result.timing_ms})
            await emit_primitive_completed(emit, result)
            return result
        metadata_response.raise_for_status()
        metadata = metadata_response.json()

    row = {
        "entity_name": entity_name,
        "source_kind": "court",
        "api_source": "canlii",
        "source_url": _https_url(metadata.get("url")),
        "api_source_url": METADATA_URL.format(database_id=database_id, case_id=case_id),
        "title": metadata.get("title") or first_case.get("title") or "",
        "citation": metadata.get("citation") or first_case.get("citation") or "",
        "decision_date": metadata.get("decisionDate"),
        "court": database_id,
        "database_id": database_id,
        "case_id": case_id,
        "keywords": metadata.get("keywords") or "",
    }
    row["snippet"] = f"CanLII API full-text search for {entity_name} returned case metadata: {row['title']} ({row['citation']})."
    result = PrimitiveResult(
        primitive_name="canlii_case_search",
        rows=[row] if row["source_url"] else [],
        sql_log=[],
        caveats=["CanLII API lookup is bounded to one search call and one metadata call per entity."],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )
    if emit:
        await emit("canlii_completed", {"entity_name": entity_name, "case_count": len(result.rows), "timing_ms": result.timing_ms})
    await emit_primitive_completed(emit, result)
    return result


def _unavailable(started: float, message: str) -> PrimitiveResult:
    return PrimitiveResult(
        primitive_name="canlii_case_search",
        rows=[],
        sql_log=[],
        caveats=[message],
        timing_ms=int((time.perf_counter() - started) * 1000),
    )


def _case_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload.get("results", []):
        if isinstance(item, dict) and isinstance(item.get("case"), dict):
            rows.append(item["case"])
    return rows


def _case_id(value: Any) -> str:
    if isinstance(value, dict):
        selected = value.get("en") or next((item for item in value.values() if item), "")
        return str(selected).strip()
    return str(value or "").strip()


def _https_url(value: Any) -> str:
    url = str(value or "").strip()
    if url.startswith("http://"):
        return "https://" + url.removeprefix("http://")
    return url
