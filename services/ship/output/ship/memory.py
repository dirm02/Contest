"""Conversation memory for iterative analyst turns."""

from __future__ import annotations

import importlib
import json
from typing import Any
from uuid import UUID

import asyncpg

from .primitives.base import json_ready
from .recipes.catalog import RECIPES
from .responses import MemoryEntry


MAX_PINNED_RUNS = 8
MAX_MEMORY_CONTEXT_RUNS = 12
DEFAULT_RECENT_RUNS = 8
DEFAULT_UNPINNED_CAP = 20
AMOUNT_COLUMNS = (
    "total_all_funding",
    "total_funding_known",
    "agreement_value",
    "amount",
    "supplier_amount",
    "segment_total_amount",
    "total_amount",
    "metric_value",
    "count",
)


async def list_memory_entries(pool: asyncpg.Pool, conversation_id: UUID, *, include_forgotten: bool = False) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        """
SELECT
    m.run_id,
    coalesce(nullif(r.recipe_id, ''), NULL) AS recipe_id,
    m.derived_from_run_id,
    m.description,
    m.params_summary,
    jsonb_array_length(coalesce(r.findings, '[]'::jsonb))::int AS row_count,
    m.created_at,
    m.pinned,
    m.forgotten
FROM investigator.ship_conversation_memory m
JOIN investigator.ship_recipe_runs r ON r.run_id = m.run_id
WHERE m.conversation_id = $1
  AND ($2::bool OR NOT m.forgotten)
ORDER BY m.pinned DESC, m.created_at DESC, m.run_id DESC
""".strip(),
        conversation_id,
        include_forgotten,
    )
    return [_record_to_json(row) for row in rows]


async def build_memory_summary(
    pool: asyncpg.Pool,
    conversation_id: UUID,
    *,
    recent_limit: int = DEFAULT_RECENT_RUNS,
    ad_hoc_run_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        """
WITH pinned AS (
    SELECT m.run_id, m.pinned, m.created_at
    FROM investigator.ship_conversation_memory m
    WHERE m.conversation_id = $1 AND m.pinned AND NOT m.forgotten
    ORDER BY m.created_at DESC
    LIMIT $2
),
recent AS (
    SELECT m.run_id, m.pinned, m.created_at
    FROM investigator.ship_conversation_memory m
    WHERE m.conversation_id = $1
      AND NOT m.pinned
      AND NOT m.forgotten
    ORDER BY m.created_at DESC
    LIMIT $3
),
selected AS (
    SELECT * FROM pinned
    UNION
    SELECT * FROM recent
)
SELECT
    r.run_id,
    r.recipe_id,
    r.based_on_run_id,
    r.params,
    r.findings,
    m.description,
    m.params_summary,
    m.pinned,
    m.created_at
FROM selected s
JOIN investigator.ship_conversation_memory m ON m.run_id = s.run_id AND m.conversation_id = $1
JOIN investigator.ship_recipe_runs r ON r.run_id = s.run_id
ORDER BY m.pinned DESC, m.created_at DESC, r.run_id DESC
LIMIT $4
""".strip(),
        conversation_id,
        MAX_PINNED_RUNS,
        recent_limit,
        MAX_MEMORY_CONTEXT_RUNS,
    )
    entries = [_memory_summary_entry(row) for row in rows]
    included = {entry["run_id"] for entry in entries}
    for raw_id in ad_hoc_run_ids or []:
        if raw_id in included:
            continue
        row = await pool.fetchrow(
            """
SELECT
    r.run_id, r.recipe_id, r.based_on_run_id, r.params, r.findings,
    coalesce(m.description, r.recipe_id) AS description,
    coalesce(m.params_summary, '') AS params_summary,
    coalesce(m.pinned, false) AS pinned,
    r.created_at
FROM investigator.ship_recipe_runs r
LEFT JOIN investigator.ship_conversation_memory m
  ON m.run_id = r.run_id AND m.conversation_id = r.conversation_id
WHERE r.conversation_id = $1 AND r.run_id = $2
""".strip(),
            conversation_id,
            UUID(raw_id),
        )
        if row:
            entries.append(_memory_summary_entry(row))
            included.add(raw_id)
    return entries[:MAX_MEMORY_CONTEXT_RUNS]


async def remember_run(
    pool: asyncpg.Pool,
    *,
    conversation_id: UUID,
    run_id: UUID,
    recipe_id: str | None,
    params: dict[str, Any],
    row_count: int,
    derived_from_run_id: UUID | None = None,
    description: str | None = None,
    cap: int = DEFAULT_UNPINNED_CAP,
) -> None:
    label = description or humanize_run(recipe_id, params, row_count)
    await pool.execute(
        """
INSERT INTO investigator.ship_conversation_memory
    (conversation_id, run_id, derived_from_run_id, description, params_summary)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (conversation_id, run_id) DO UPDATE SET
    description = EXCLUDED.description,
    params_summary = EXCLUDED.params_summary,
    forgotten = false
""".strip(),
        conversation_id,
        run_id,
        derived_from_run_id,
        label,
        params_summary(params),
    )
    await evict_old_memory(pool, conversation_id, cap=cap)


async def pin_run(pool: asyncpg.Pool, conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    exists = await _conversation_run_exists(pool, conversation_id, run_id)
    if not exists:
        raise ValueError(f"run {run_id} does not belong to conversation {conversation_id}")
    pinned_count = await pool.fetchval(
        """
SELECT count(*)::int
FROM investigator.ship_conversation_memory
WHERE conversation_id = $1 AND pinned AND NOT forgotten AND run_id <> $2
""".strip(),
        conversation_id,
        run_id,
    )
    if int(pinned_count or 0) >= MAX_PINNED_RUNS:
        raise ValueError(f"pin cap reached: at most {MAX_PINNED_RUNS} runs may be pinned per conversation")
    await _ensure_memory_row(pool, conversation_id, run_id)
    row = await pool.fetchrow(
        """
UPDATE investigator.ship_conversation_memory
SET pinned = true, forgotten = false
WHERE conversation_id = $1 AND run_id = $2
RETURNING run_id, pinned, forgotten
""".strip(),
        conversation_id,
        run_id,
    )
    return _record_to_json(row)


async def unpin_run(pool: asyncpg.Pool, conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    await _ensure_memory_row(pool, conversation_id, run_id)
    row = await pool.fetchrow(
        """
UPDATE investigator.ship_conversation_memory
SET pinned = false
WHERE conversation_id = $1 AND run_id = $2
RETURNING run_id, pinned, forgotten
""".strip(),
        conversation_id,
        run_id,
    )
    return _record_to_json(row)


async def forget_run(pool: asyncpg.Pool, conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    await _ensure_memory_row(pool, conversation_id, run_id)
    row = await pool.fetchrow(
        """
UPDATE investigator.ship_conversation_memory
SET forgotten = true, pinned = false
WHERE conversation_id = $1 AND run_id = $2
RETURNING run_id, pinned, forgotten
""".strip(),
        conversation_id,
        run_id,
    )
    return _record_to_json(row)


async def evict_old_memory(pool: asyncpg.Pool, conversation_id: UUID, *, cap: int = DEFAULT_UNPINNED_CAP) -> None:
    await pool.execute(
        """
WITH ranked AS (
    SELECT
        conversation_id,
        run_id,
        row_number() OVER (ORDER BY created_at DESC, run_id DESC) AS rn
    FROM investigator.ship_conversation_memory
    WHERE conversation_id = $1
      AND NOT pinned
      AND NOT forgotten
)
UPDATE investigator.ship_conversation_memory m
SET forgotten = true
FROM ranked r
WHERE m.conversation_id = r.conversation_id
  AND m.run_id = r.run_id
  AND r.rn > $2
""".strip(),
        conversation_id,
        cap,
    )


def humanize_run(recipe_id: str | None, params: dict[str, Any], row_count: int) -> str:
    if recipe_id and recipe_id.startswith("__analytical__:"):
        template = recipe_id.split(":", 1)[1]
        return f"Analytical {template.replace('_', ' ')} query · {row_count} rows"
    if recipe_id in RECIPES:
        try:
            module = importlib.import_module(f".recipes.{recipe_id}", package=__package__)
            humanize = getattr(module, "humanize", None)
            if callable(humanize):
                label = str(humanize(params)).strip()
                if label:
                    return f"{label} · {row_count} rows"
        except Exception:
            pass
        base = RECIPES[recipe_id].description.split(".")[0]
    else:
        base = "Derived analysis" if recipe_id is None else str(recipe_id)
    distinctive = params_summary(params)
    suffix = f" ({distinctive})" if distinctive else ""
    return f"{base}{suffix} · {row_count} rows"


def params_summary(params: dict[str, Any]) -> str:
    items = [
        (key, value)
        for key, value in sorted((params or {}).items())
        if value not in (None, "", [], {}) and not str(key).startswith("_")
    ]
    return ", ".join(f"{key}={value}" for key, value in items[:4])


def _memory_summary_entry(row: asyncpg.Record) -> dict[str, Any]:
    payload = _record_to_json(row)
    findings = list(payload.get("findings") or [])
    columns = _columns(findings)[:30]
    return {
        "run_id": str(payload["run_id"]),
        "recipe_id": payload.get("recipe_id"),
        "derived_from_run_id": payload.get("based_on_run_id"),
        "description": str(payload.get("description") or payload.get("recipe_id") or "analysis")[:80],
        "params_summary": str(payload.get("params_summary") or params_summary(payload.get("params") or {}))[:240],
        "row_count": len(findings),
        "columns": columns,
        "sample_rows": _compact_findings(findings, columns=columns),
        "pinned": bool(payload.get("pinned")),
    }


def _compact_findings(rows: list[dict[str, Any]], *, columns: list[str], k: int = 3) -> list[dict[str, Any]]:
    if not rows:
        return []
    chosen: list[dict[str, Any]] = []
    amount_column = _best_amount_column(rows)
    if amount_column:
        chosen.append(max(rows, key=lambda row: _number(row.get(amount_column)) or float("-inf")))
    for row in rows:
        if len(chosen) >= k:
            break
        if row not in chosen:
            chosen.append(row)
    return [{column: _truncate(row.get(column)) for column in columns[:12] if column in row} for row in chosen[:k]]


def _columns(rows: list[dict[str, Any]]) -> list[str]:
    seen: list[str] = []
    for row in rows[:20]:
        for key in row:
            name = str(key)
            if name not in seen:
                seen.append(name)
    return seen


def _best_amount_column(rows: list[dict[str, Any]]) -> str | None:
    for column in AMOUNT_COLUMNS:
        if any(_number(row.get(column)) is not None for row in rows):
            return column
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").rstrip("%"))
        except ValueError:
            return None
    return None


def _truncate(value: Any) -> Any:
    ready = json_ready(value)
    if isinstance(ready, str):
        return ready if len(ready) <= 60 else ready[:57].rstrip() + "..."
    if isinstance(ready, (dict, list)):
        text = json.dumps(ready, ensure_ascii=False)
        return text if len(text) <= 60 else text[:57].rstrip() + "..."
    return ready


async def _conversation_run_exists(pool: asyncpg.Pool, conversation_id: UUID, run_id: UUID) -> bool:
    value = await pool.fetchval(
        "SELECT true FROM investigator.ship_recipe_runs WHERE conversation_id = $1 AND run_id = $2",
        conversation_id,
        run_id,
    )
    return bool(value)


async def _ensure_memory_row(pool: asyncpg.Pool, conversation_id: UUID, run_id: UUID) -> None:
    row = await pool.fetchrow(
        """
SELECT recipe_id, params, findings, based_on_run_id
FROM investigator.ship_recipe_runs
WHERE conversation_id = $1 AND run_id = $2
""".strip(),
        conversation_id,
        run_id,
    )
    if row is None:
        raise ValueError(f"run {run_id} does not belong to conversation {conversation_id}")
    payload = _record_to_json(row)
    await remember_run(
        pool,
        conversation_id=conversation_id,
        run_id=run_id,
        recipe_id=payload.get("recipe_id"),
        params=payload.get("params") or {},
        row_count=len(payload.get("findings") or []),
        derived_from_run_id=UUID(payload["based_on_run_id"]) if payload.get("based_on_run_id") else None,
    )


def _record_to_json(row: asyncpg.Record | None) -> dict[str, Any]:
    if row is None:
        return {}
    payload = dict(row)
    converted = json_ready(payload)
    for key, value in list(converted.items()):
        if hasattr(value, "isoformat"):
            converted[key] = value.isoformat()
        elif isinstance(value, UUID):
            converted[key] = str(value)
        elif isinstance(value, str) and value[:1] in {"{", "["}:
            converted[key] = json.loads(value)
    return converted
