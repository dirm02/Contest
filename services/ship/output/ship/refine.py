"""In-memory refinement over persisted ship-mode findings."""

from __future__ import annotations

import re
from typing import Any


_AMOUNT_RE = re.compile(r"(?:above|over|greater than|at least|>=?)\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kmb])?", re.IGNORECASE)
_DETAIL_RE = re.compile(r"(?:row|finding)\s*#?\s*(\d+)", re.IGNORECASE)

NUMERIC_COLUMNS = (
    "total_funding_known",
    "total_government_funding",
    "total_all_funding",
    "total_flow",
    "total_amount",
    "amount",
    "combined_funding",
    "segment_total_amount",
    "metric_value",
)


def infer_refinement_filter(message: str, findings: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = message.strip()
    lowered = text.lower()
    detail = _DETAIL_RE.search(text)
    if detail:
        index = max(0, int(detail.group(1)) - 1)
        return {"operation": "detail", "finding_index": index}

    amount_match = _AMOUNT_RE.search(text)
    if amount_match:
        value = _scale_amount(float(amount_match.group(1).replace(",", "")), amount_match.group(2))
        column = _best_numeric_column(findings)
        if column:
            return {"operation": "filter", "column": column, "operator": ">=", "value": value}

    if "sort" in lowered or "largest" in lowered or "highest" in lowered:
        column = _best_numeric_column(findings)
        if column:
            return {"operation": "sort", "column": column, "direction": "desc"}

    if "external" in lowered and any(row.get("finding_kind") == "external_recipient" for row in findings):
        return {"operation": "filter", "column": "finding_kind", "operator": "=", "value": "external_recipient"}

    if "public" in lowered and any(row.get("finding_kind") == "public_system_oversight" for row in findings):
        return {"operation": "filter", "column": "finding_kind", "operator": "=", "value": "public_system_oversight"}

    return None


def apply_refinement(findings: list[dict[str, Any]], refinement: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not refinement:
        return findings
    operation = str(refinement.get("operation") or "").lower()
    if operation == "detail":
        if "finding_index" in refinement:
            index = int(refinement["finding_index"])
            return [findings[index]] if 0 <= index < len(findings) else []
        row_match = refinement.get("row_match")
        if isinstance(row_match, dict):
            return [row for row in findings if _matches_row(row, row_match)]
        return findings[:1]
    if operation == "sort":
        column = str(refinement.get("column") or _best_numeric_column(findings) or "")
        reverse = str(refinement.get("direction") or "desc").lower() != "asc"
        return sorted(findings, key=lambda row: _sort_value(row.get(column)), reverse=reverse)
    if operation == "filter":
        column = str(refinement.get("column") or "")
        operator = str(refinement.get("operator") or "=")
        value = refinement.get("value")
        if not column:
            return findings
        return [row for row in findings if _compare(row.get(column), operator, value)]
    return findings


def refinement_description(refinement: dict[str, Any] | None) -> str:
    if not refinement:
        return "refined from cached findings"
    operation = refinement.get("operation")
    if operation == "filter":
        return f"filtered cached findings where {refinement.get('column')} {refinement.get('operator')} {refinement.get('value')}"
    if operation == "sort":
        return f"sorted cached findings by {refinement.get('column')} {refinement.get('direction', 'desc')}"
    if operation == "detail":
        return "selected detail from cached findings"
    return "refined from cached findings"


def _best_numeric_column(findings: list[dict[str, Any]]) -> str | None:
    for column in NUMERIC_COLUMNS:
        if any(_to_number(row.get(column)) is not None for row in findings):
            return column
    for row in findings:
        for key, value in row.items():
            if _to_number(value) is not None:
                return str(key)
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


def _matches_row(row: dict[str, Any], row_match: dict[str, Any]) -> bool:
    for key, value in row_match.items():
        if str(row.get(key)) != str(value):
            return False
    return True


def _compare(raw: Any, operator: str, expected: Any) -> bool:
    actual_number = _to_number(raw)
    expected_number = _to_number(expected)
    if actual_number is not None and expected_number is not None:
        if operator in {">=", "=>"}:
            return actual_number >= expected_number
        if operator == ">":
            return actual_number > expected_number
        if operator in {"<=", "=<"}:
            return actual_number <= expected_number
        if operator == "<":
            return actual_number < expected_number
        return actual_number == expected_number
    actual = str(raw or "").lower()
    expected_text = str(expected or "").lower()
    if operator in {"contains", "~"}:
        return expected_text in actual
    if operator in {"!=", "<>"}:
        return actual != expected_text
    return actual == expected_text


def _sort_value(raw: Any) -> tuple[int, Any]:
    number = _to_number(raw)
    if number is not None:
        return (1, number)
    return (0, str(raw or ""))


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "").rstrip("%")
        try:
            return float(text)
        except ValueError:
            return None
    return None
