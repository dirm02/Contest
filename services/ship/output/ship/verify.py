"""Deterministic verification for shipped answers."""

from __future__ import annotations

import re
import time
import json
import subprocess
import tempfile
from typing import Any

import asyncpg
import httpx

from .recipes.base import RecipeResult
from .summarizer import Summary
from .primitives.base import EmitCallback, StrictModel
from .runtime_config import settings


class VerificationResult(StrictModel):
    status: str
    failures: list[str]
    latency_ms: int
    checks: dict[str, Any]


_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?(?![A-Za-z0-9])")


def _numeric_values(result: RecipeResult) -> list[float]:
    values: list[float] = []
    for row in result.findings:
        values.extend(_collect_numeric_values(row))
    for entry in result.sql_log:
        values.append(float(entry.row_count))
        values.extend(_collect_numeric_values(entry.params))
        for row in entry.rows:
            values.extend(_collect_numeric_values(row))
    return values


def _parse_number(token: str) -> float | None:
    multiplier = 0.01 if token.endswith("%") else 1.0
    raw = token.rstrip("%").replace(",", "")
    digits_only = raw.lstrip("+-").replace(".", "")
    # Skip likely CRA business-number roots. Tradeoff: standalone 9-digit money
    # claims need surrounding comma/decimal formatting to be verified.
    if len(digits_only) == 9 and "." not in raw:
        return None
    if len(raw) == 4 and raw.startswith(("19", "20")):
        return None
    return float(raw) * multiplier


def _matches_number(value: float, candidates: list[float]) -> bool:
    for candidate in candidates:
        tolerance = max(abs(candidate) * 0.005, 0.01)
        if abs(value - candidate) <= tolerance:
            return True
    return False


async def _verify_url(url: str, summary_text: str, result: RecipeResult) -> str | None:
    if "canlii." in url.lower():
        return await _verify_canlii_url(url, summary_text, result)
    headers = {"User-Agent": "Mozilla/5.0 accountability-verifier"}
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0, headers=headers) as client:
        try:
            response = await client.get(url)
        except httpx.TimeoutException:
            return f"{url} timed out during verifier URL check"
        except httpx.TransportError as exc:
            return f"{url} failed during verifier URL check: {exc.__class__.__name__}"
    if response.status_code < 200 or response.status_code >= 400:
        return f"{url} returned HTTP {response.status_code}"
    content_type = response.headers.get("content-type", "").lower()
    if "application/pdf" in content_type or url.lower().endswith(".pdf"):
        source_text = _pdf_text(response.content)
    else:
        source_text = response.text
    tokens = [token for token in re.findall(r"[A-Za-z][A-Za-z0-9'-]{4,}", summary_text) if token.lower() not in {"which", "their", "there", "these", "those", "about", "source"}]
    if tokens and not any(token.lower() in source_text.lower() for token in tokens[:12]):
        return f"{url} did not contain identifying summary tokens"
    return None


async def _verify_canlii_url(url: str, summary_text: str, result: RecipeResult) -> str | None:
    rows = [
        row for row in result.findings
        if row.get("source_url") == url and row.get("api_source") == "canlii" and row.get("api_source_url")
    ]
    if not rows:
        return f"{url} is a CanLII URL but no CanLII API finding row matched it"
    key = settings.canlii_key_value()
    if not key:
        return "CANLII_API_KEY not configured; CanLII URL could not be verified through the API"
    headers = {"User-Agent": "Mozilla/5.0 accountability-verifier"}
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0, headers=headers) as client:
        try:
            response = await client.get(str(rows[0]["api_source_url"]), params={"api_key": key})
        except httpx.TimeoutException:
            return f"{url} timed out during CanLII API metadata verification"
        except httpx.TransportError as exc:
            return f"{url} failed during CanLII API metadata verification: {exc.__class__.__name__}"
    if response.status_code < 200 or response.status_code >= 400:
        return f"{url} CanLII API metadata returned HTTP {response.status_code}"
    source_text = json.dumps(rows[0], ensure_ascii=False) + " " + response.text
    tokens = [token for token in re.findall(r"[A-Za-z][A-Za-z0-9'-]{4,}", summary_text) if token.lower() not in {"which", "their", "there", "these", "those", "about", "source"}]
    if tokens and not any(token.lower() in source_text.lower() for token in tokens[:12]):
        return f"{url} CanLII API metadata did not contain identifying summary tokens"
    return None


def _pdf_text(content: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as source:
        source.write(content)
        source.flush()
        with tempfile.NamedTemporaryFile(suffix=".txt") as target:
            completed = subprocess.run(
                ["pdftotext", source.name, target.name],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if completed.returncode != 0:
                return ""
            target.seek(0)
            return target.read().decode("utf-8", errors="ignore")


async def verify(
    summary: Summary,
    result: RecipeResult,
    pool: asyncpg.Pool,
    *,
    total_latency_ms: int,
    emit: EmitCallback | None = None,
) -> VerificationResult:
    started = time.perf_counter()
    if emit:
        await emit("verifier_started", {})
    failures: list[str] = []
    paragraph_count = len(summary.paragraphs)
    cited_findings = 0
    cited_sql = 0
    cited_finding_indices: set[int] = set()
    cited_sql_names: set[str] = set()
    web_checked = 0
    has_web_citations = any(citation.url for paragraph in summary.paragraphs for citation in paragraph.citations)
    latency_budget_ms = 120_000 if has_web_citations or result.recipe_id == "adverse_media" else 45_000
    all_text = " ".join([summary.headline, *(paragraph.text for paragraph in summary.paragraphs)])

    query_names = {entry.query_name for entry in result.sql_log}
    for paragraph_index, paragraph in enumerate(summary.paragraphs):
        if not paragraph.citations:
            failures.append(f"paragraph {paragraph_index} has no citation")
        for citation in paragraph.citations:
            if citation.finding_index is not None:
                if citation.finding_index < 0 or citation.finding_index >= len(result.findings):
                    failures.append(f"paragraph {paragraph_index} cites missing finding_index {citation.finding_index}")
                else:
                    cited_findings += 1
                    cited_finding_indices.add(citation.finding_index)
            if citation.sql_query_name is not None:
                if citation.sql_query_name not in query_names:
                    failures.append(f"paragraph {paragraph_index} cites missing sql_query_name {citation.sql_query_name}")
                else:
                    cited_sql += 1
                    cited_sql_names.add(citation.sql_query_name)
            if citation.url:
                web_checked += 1
                url_failure = await _verify_url(citation.url, paragraph.text, result)
                if url_failure:
                    failures.append(url_failure)
    citation_failure_count = len(failures)
    if emit:
        await emit(
            "verifier_check",
            {
                "check": "S3_grounding",
                "status": "pass" if citation_failure_count == 0 else "fail",
                "details": f"{cited_findings} finding citations, {cited_sql} SQL citations across {paragraph_count} paragraphs.",
            },
        )
        if web_checked:
            await emit(
                "verifier_check",
                {
                    "check": "S3_url",
                    "status": "pass" if citation_failure_count == 0 else "fail",
                    "details": f"{web_checked} URL citations checked.",
                },
            )

    numeric_failures_before = len(failures)
    numbers = []
    candidates = _numeric_values_for_citations(result, cited_finding_indices, cited_sql_names)
    for match in _NUMBER_RE.finditer(all_text):
        parsed = _parse_number(match.group(0))
        if parsed is None:
            continue
        numbers.append(parsed)
        if not _matches_number(parsed, candidates):
            failures.append(f"numeric claim {match.group(0)!r} was not found in finding rows or sql log")
    if emit:
        await emit(
            "verifier_check",
            {
                "check": "S4_numeric",
                "status": "pass" if len(failures) == numeric_failures_before else "fail",
                "details": f"{len(numbers)} numeric claims checked against cited finding rows and cited SQL rows.",
            },
        )

    canonical_failures_before = len(failures)
    canonical_names = sorted(_collect_canonical_names(result.findings))
    verified_entities = 0
    for name in canonical_names:
        if name in all_text:
            count = await pool.fetchval("SELECT count(*) FROM general.entity_golden_records WHERE canonical_name = $1", name)
            if count < 1:
                failures.append(f"canonical entity {name!r} did not resolve to general.entity_golden_records")
            else:
                verified_entities += 1
    if emit:
        await emit(
            "verifier_check",
            {
                "check": "S5_canonical",
                "status": "pass" if len(failures) == canonical_failures_before else "fail",
                "details": f"{verified_entities} canonical entities verified in text from {len(canonical_names)} candidate canonical names.",
            },
        )

    adverse_external_checked = 0
    adverse_external_verified = 0
    if result.recipe_id == "adverse_media":
        adverse_external_checked, adverse_external_verified = await _verify_adverse_external_funding(result, pool, failures)

    if total_latency_ms > latency_budget_ms:
        failures.append(f"latency {total_latency_ms}ms exceeded {latency_budget_ms}ms")

    verification = VerificationResult(
        status="pass" if not failures else "failed",
        failures=failures,
        latency_ms=int((time.perf_counter() - started) * 1000),
        checks={
            "paragraphs": paragraph_count,
            "cited_findings": cited_findings,
            "cited_sql": cited_sql,
            "numbers": len(numbers),
            "canonical_entities_seen": len(canonical_names),
            "canonical_entities_verified_in_text": verified_entities,
            "adverse_external_funding_checked": adverse_external_checked,
            "adverse_external_funding_verified": adverse_external_verified,
            "web_urls_checked": web_checked,
            "total_latency_ms": total_latency_ms,
            "latency_budget_ms": latency_budget_ms,
        },
    )
    if emit:
        await emit(
            "verifier_completed",
            {
                "status": verification.status,
                "failures": verification.failures,
                "latency_ms": verification.latency_ms,
            },
        )
    return verification


async def _verify_adverse_external_funding(
    result: RecipeResult,
    pool: asyncpg.Pool,
    failures: list[str],
) -> tuple[int, int]:
    checked = 0
    verified = 0
    for index, row in enumerate(result.findings):
        if row.get("finding_kind") != "external_recipient":
            continue
        checked += 1
        entity_id = row.get("entity_id")
        canonical_name = row.get("canonical_name")
        if entity_id is None or not canonical_name:
            failures.append(f"adverse_media finding {index} is missing entity_id or canonical_name")
            continue
        funding_count = await pool.fetchval(
            """
SELECT count(*)
FROM general.vw_entity_funding
WHERE entity_id = $1
  AND canonical_name = $2
  AND total_all_funding > 0
""".strip(),
            int(entity_id),
            str(canonical_name),
        )
        if int(funding_count or 0) < 1:
            failures.append(f"adverse_media finding {index} {canonical_name!r} has no verified public-funding overlap")
            continue
        verified += 1
    return checked, verified


def _numeric_values_for_citations(result: RecipeResult, finding_indices: set[int], sql_names: set[str]) -> list[float]:
    values: list[float] = []
    for index in sorted(finding_indices):
        if 0 <= index < len(result.findings):
            values.extend(_collect_numeric_values(result.findings[index]))
    for entry in result.sql_log:
        if entry.query_name in sql_names:
            values.append(float(entry.row_count))
            values.extend(_collect_numeric_values(entry.params))
            for row in entry.rows:
                values.extend(_collect_numeric_values(row))
    return values


def _collect_canonical_names(value: Any) -> set[str]:
    names: set[str] = set()
    if isinstance(value, dict):
        maybe_name = value.get("canonical_name")
        if isinstance(maybe_name, str) and maybe_name.strip():
            names.add(maybe_name.strip())
        for item in value.values():
            names.update(_collect_canonical_names(item))
    elif isinstance(value, list):
        for item in value:
            names.update(_collect_canonical_names(item))
    elif isinstance(value, str) and '"canonical_name"' in value:
        parsed = json.loads(value)
        names.update(_collect_canonical_names(parsed))
    return names


def _collect_numeric_values(value: Any) -> list[float]:
    values: list[float] = []
    if isinstance(value, bool):
        return values
    if isinstance(value, (int, float)):
        values.append(float(value))
    elif isinstance(value, dict):
        for item in value.values():
            values.extend(_collect_numeric_values(item))
    elif isinstance(value, list):
        for item in value:
            values.extend(_collect_numeric_values(item))
    elif isinstance(value, str):
        text = value.strip()
        if '"canonical_name"' in text or text.startswith("[") or text.startswith("{"):
            parsed = json.loads(text)
            values.extend(_collect_numeric_values(parsed))
        else:
            for match in _NUMBER_RE.finditer(text):
                parsed = _parse_number(match.group(0))
                if parsed is not None:
                    values.append(parsed)
    return values
