"""Strict, tiny predicate parser for cached finding refinements."""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from typing import Any, Callable


class PredicateParseError(ValueError):
    """Raised when a refinement predicate is not safe or not expressible."""


@dataclass(frozen=True)
class ParsedPredicate:
    normalized: str
    evaluate: Callable[[dict[str, Any]], bool]


_UNSAFE_RE = re.compile(r"(?:;|--|/\*|\*/|\bselect\b|\bfrom\b|\bwhere\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b)", re.IGNORECASE)
_BETWEEN_RE = re.compile(r"^\s*(?P<col>[A-Za-z_][A-Za-z0-9_ ]*)\s+between\s+(?P<lo>.+?)\s+and\s+(?P<hi>.+?)\s*$", re.IGNORECASE)
_IN_RE = re.compile(r"^\s*(?P<col>[A-Za-z_][A-Za-z0-9_ ]*)\s+(?P<neg>not\s+)?in\s*\((?P<values>.*)\)\s*$", re.IGNORECASE)
_NULL_RE = re.compile(r"^\s*(?P<col>[A-Za-z_][A-Za-z0-9_ ]*)\s+is\s+(?P<neg>not\s+)?null\s*$", re.IGNORECASE)
_COMPARE_RE = re.compile(r"^\s*(?P<col>[A-Za-z_][A-Za-z0-9_ ]*)\s*(?P<op>=|!=|<>|<=|>=|<|>|like)\s*(?P<value>.+?)\s*$", re.IGNORECASE)


def parse_predicate(predicate: str, columns: list[str] | set[str]) -> ParsedPredicate:
    text = " ".join(str(predicate or "").strip().split())
    if not text:
        raise PredicateParseError("empty predicate")
    if _UNSAFE_RE.search(text):
        raise PredicateParseError("predicate contains disallowed SQL syntax")
    column_map = {column.lower(): column for column in columns}
    evaluator, normalized = _parse_expression(text, column_map)
    return ParsedPredicate(normalized=normalized, evaluate=evaluator)


def _parse_expression(text: str, column_map: dict[str, str]) -> tuple[Callable[[dict[str, Any]], bool], str]:
    text = _strip_outer_parentheses(text.strip())
    for operator in (" OR ", " AND "):
        parts = _split_top_level(text, operator)
        if len(parts) > 1:
            parsed = [_parse_expression(part, column_map) for part in parts]
            if operator.strip() == "OR":
                return (
                    lambda row, parsed=parsed: any(fn(row) for fn, _ in parsed),
                    " OR ".join(label for _, label in parsed),
                )
            return (
                lambda row, parsed=parsed: all(fn(row) for fn, _ in parsed),
                " AND ".join(label for _, label in parsed),
            )
    if text.upper().startswith("NOT "):
        inner, label = _parse_expression(text[4:].strip(), column_map)
        return (lambda row, inner=inner: not inner(row), f"NOT ({label})")
    return _parse_atom(text, column_map)


def _parse_atom(text: str, column_map: dict[str, str]) -> tuple[Callable[[dict[str, Any]], bool], str]:
    match = _NULL_RE.match(text)
    if match:
        column = _resolve_column(match.group("col"), column_map)
        is_negated = bool(match.group("neg"))
        return (
            lambda row, column=column, is_negated=is_negated: (row.get(column) is not None) if is_negated else (row.get(column) is None),
            f"{column} IS {'NOT ' if is_negated else ''}NULL",
        )

    match = _BETWEEN_RE.match(text)
    if match:
        column = _resolve_column(match.group("col"), column_map)
        lo = _parse_literal(match.group("lo"))
        hi = _parse_literal(match.group("hi"))
        return (
            lambda row, column=column, lo=lo, hi=hi: _compare(row.get(column), ">=", lo) and _compare(row.get(column), "<=", hi),
            f"{column} BETWEEN {_literal_label(lo)} AND {_literal_label(hi)}",
        )

    match = _IN_RE.match(text)
    if match:
        column = _resolve_column(match.group("col"), column_map)
        values = [_parse_literal(part) for part in _split_csv(match.group("values"))]
        is_negated = bool(match.group("neg"))
        if not values:
            raise PredicateParseError("IN predicate requires at least one value")
        return (
            lambda row, column=column, values=values, is_negated=is_negated: (_contains(row.get(column), values) is False)
            if is_negated
            else _contains(row.get(column), values),
            f"{column} {'NOT ' if is_negated else ''}IN ({', '.join(_literal_label(value) for value in values)})",
        )

    match = _COMPARE_RE.match(text)
    if match:
        column = _resolve_column(match.group("col"), column_map)
        op = match.group("op").upper()
        value = _parse_literal(match.group("value"))
        return (
            lambda row, column=column, op=op, value=value: _compare(row.get(column), op, value),
            f"{column} {op} {_literal_label(value)}",
        )
    raise PredicateParseError(f"could not parse predicate {text!r}")


def _resolve_column(raw: str, column_map: dict[str, str]) -> str:
    normalized = raw.strip().strip('"').strip("'").lower().replace(" ", "_")
    if normalized in column_map:
        return column_map[normalized]
    for key, value in column_map.items():
        if key.replace("_", " ") == raw.strip().lower():
            return value
    raise PredicateParseError(f"predicate references unknown column {raw.strip()!r}")


def _parse_literal(raw: str) -> Any:
    text = raw.strip()
    if (text.startswith("'") and text.endswith("'")) or (text.startswith('"') and text.endswith('"')):
        return text[1:-1]
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered == "null":
        return None
    compact = text.replace(",", "")
    multiplier = 1.0
    if compact[-1:].lower() in {"k", "m", "b"} and len(compact) > 1:
        suffix = compact[-1].lower()
        compact = compact[:-1]
        multiplier = {"k": 1_000.0, "m": 1_000_000.0, "b": 1_000_000_000.0}[suffix]
    try:
        value = float(compact) * multiplier
        return int(value) if value.is_integer() else value
    except ValueError:
        return text


def _compare(raw: Any, op: str, expected: Any) -> bool:
    actual_num = _to_number(raw)
    expected_num = _to_number(expected)
    if actual_num is not None and expected_num is not None:
        if op == "=":
            return actual_num == expected_num
        if op in {"!=", "<>"}:
            return actual_num != expected_num
        if op == "<":
            return actual_num < expected_num
        if op == "<=":
            return actual_num <= expected_num
        if op == ">":
            return actual_num > expected_num
        if op == ">=":
            return actual_num >= expected_num
    actual = "" if raw is None else str(raw)
    expected_text = "" if expected is None else str(expected)
    if op == "=":
        return actual.lower() == expected_text.lower()
    if op in {"!=", "<>"}:
        return actual.lower() != expected_text.lower()
    if op == "LIKE":
        return fnmatch.fnmatchcase(actual.lower(), expected_text.replace("%", "*").lower())
    return False


def _contains(raw: Any, values: list[Any]) -> bool:
    return any(_compare(raw, "=", value) for value in values)


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "").rstrip("%"))
        except ValueError:
            return None
    return None


def _split_top_level(text: str, separator: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    upper = text.upper()
    sep = separator.upper()
    index = 0
    while index < len(text):
        char = text[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and upper.startswith(sep, index):
            parts.append(text[start:index].strip())
            index += len(separator)
            start = index
            continue
        index += 1
    if parts:
        parts.append(text[start:].strip())
        return [part for part in parts if part]
    return [text]


def _split_csv(text: str) -> list[str]:
    parts: list[str] = []
    current = ""
    quote: str | None = None
    for char in text:
        if char in {"'", '"'}:
            quote = None if quote == char else char if quote is None else quote
        if char == "," and quote is None:
            parts.append(current.strip())
            current = ""
            continue
        current += char
    if current.strip():
        parts.append(current.strip())
    return parts


def _strip_outer_parentheses(text: str) -> str:
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        balanced_outer = True
        for index, char in enumerate(text):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(text) - 1:
                    balanced_outer = False
                    break
        if not balanced_outer:
            return text
        text = text[1:-1].strip()
    return text


def _literal_label(value: Any) -> str:
    if isinstance(value, str):
        return repr(value)
    return "NULL" if value is None else str(value)
