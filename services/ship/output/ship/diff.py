"""Deterministic row-set diffing for iterative analyst turns."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .primitives.base import json_ready
from .responses import AnswerDiff


KEY_COLUMNS = (
    "entity_norm",
    "business_number",
    "recipient_id",
    "entity_id",
    "canonical_name",
    "supplier_name",
    "source_legal_name",
    "recipient_name",
)


def compute_diff(
    current: list[dict[str, Any]],
    baseline: list[dict[str, Any]],
    *,
    baseline_run_id: str,
) -> AnswerDiff:
    current_by_key = {_row_key(row): row for row in current}
    baseline_by_key = {_row_key(row): row for row in baseline}
    current_keys = set(current_by_key)
    baseline_keys = set(baseline_by_key)
    shared = current_keys & baseline_keys
    rows_changed = sum(
        1
        for key in shared
        if _comparable_row(current_by_key[key]) != _comparable_row(baseline_by_key[key])
    )
    current_columns = {str(key) for row in current for key in row}
    baseline_columns = {str(key) for row in baseline for key in row}
    return AnswerDiff(
        baseline_run_id=baseline_run_id,
        rows_added=len(current_keys - baseline_keys),
        rows_removed=len(baseline_keys - current_keys),
        rows_changed=rows_changed,
        columns_added=sorted(current_columns - baseline_columns),
        columns_removed=sorted(baseline_columns - current_columns),
    )


def _row_key(row: dict[str, Any]) -> str:
    for column in KEY_COLUMNS:
        value = row.get(column)
        if value not in (None, ""):
            return f"{column}:{value}"
    digest = hashlib.sha256(
        json.dumps(_comparable_row(row), sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:24]
    return f"rowhash:{digest}"


def _comparable_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        str(key): json_ready(value)
        for key, value in row.items()
        if not str(key).startswith("_")
    }
