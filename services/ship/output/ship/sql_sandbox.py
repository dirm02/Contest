"""SQL validation and read-only execution for analytical queries."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import sqlglot
from sqlglot import exp

from .primitives.base import SQLLogEntry, rows_to_dicts
from .schema_catalog import SchemaCatalog
from .sql_compiler import normalize_sql


FORBIDDEN_WORDS = re.compile(
    r"\b(insert|update|delete|merge|create|drop|alter|grant|revoke|truncate|copy|vacuum|explain|set|begin|commit|rollback|execute)\b",
    re.IGNORECASE,
)
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ALLOWED_FUNCTIONS = {
    "LOWER",
    "UPPER",
    "LENGTH",
    "COALESCE",
    "NULLIF",
    "ABS",
    "CEIL",
    "FLOOR",
    "ROUND",
    "EXTRACT",
    "DATE_TRUNC",
    "TO_DATE",
    "TO_CHAR",
    "CAST",
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "STDDEV",
    "STDDEV_POP",
    "VARIANCE",
    "PERCENTILE_CONT",
    "AND",
    "OR",
    "NOT",
    "LIKE",
    "ILIKE",
    "ROW_NUMBER",
    "RANK",
    "DENSE_RANK",
    "LAG",
    "LEAD",
}


@dataclass
class SandboxResult:
    ok: bool
    sql: str
    rows: list[dict[str, Any]] = field(default_factory=list)
    sql_log: SQLLogEntry | None = None
    reason: str | None = None
    timing_ms: int = 0
    columns: list[str] = field(default_factory=list)


class SqlSandbox:
    def __init__(self, pool: asyncpg.Pool, catalog: SchemaCatalog) -> None:
        self.pool = pool
        self.catalog = catalog

    def validate(self, sql: str) -> tuple[bool, str | None, str]:
        normalized = normalize_sql(sql)
        if ";" in normalized.rstrip(";"):
            return False, "multiple statements are not allowed", normalized
        if FORBIDDEN_WORDS.search(normalized):
            return False, "SQL contains a forbidden statement or command", normalized
        try:
            statements = sqlglot.parse(normalized, read="postgres")
        except Exception as exc:
            return False, f"SQL parse failed: {exc.__class__.__name__}", normalized
        if len(statements) != 1:
            return False, "exactly one statement is allowed", normalized
        statement = statements[0]
        if not isinstance(statement, (exp.Select, exp.With)):
            return False, "top-level statement must be SELECT", normalized
        for table in statement.find_all(exp.Table):
            parts = [part.name for part in table.parts]
            if len(parts) == 2:
                fq_name = f"{parts[0]}.{parts[1]}"
            else:
                fq_name = parts[-1]
            spec = self.catalog.table(fq_name)
            if spec is None or not spec.safe_for_analytical:
                return False, f"table {fq_name!r} is not in the analytical allow-list", normalized
        for identifier in statement.find_all(exp.Identifier):
            if identifier.quoted or not IDENT_RE.match(identifier.name):
                return False, f"identifier {identifier.name!r} is not allowed", normalized
        for func in statement.find_all(exp.Func):
            name = func.sql_name().upper()
            if name and name not in ALLOWED_FUNCTIONS:
                return False, f"function {name} is not allowed", normalized
        if " LIMIT " not in f" {normalized.upper()} ":
            normalized = f"{normalized} LIMIT 10000"
        normalized = _cap_limit(normalized)
        return True, None, normalized

    async def execute(self, sql: str, *, query_name: str = "analytical_query", timeout_ms: int = 25_000) -> SandboxResult:
        ok, reason, safe_sql = self.validate(sql)
        if not ok:
            return SandboxResult(ok=False, sql=safe_sql, reason=reason)
        started = time.perf_counter()
        timeout = max(1_000, min(timeout_ms, 30_000))
        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction(readonly=True):
                    await conn.execute(f"SET LOCAL statement_timeout = {timeout}")
                    await conn.execute("SET LOCAL lock_timeout = 5000")
                    await conn.execute("SET LOCAL idle_in_transaction_session_timeout = 5000")
                    records = await conn.fetch(safe_sql)
        except TimeoutError:
            return SandboxResult(ok=False, sql=safe_sql, reason="timeout", timing_ms=int((time.perf_counter() - started) * 1000))
        except asyncpg.PostgresError as exc:
            return SandboxResult(ok=False, sql=safe_sql, reason=f"{exc.__class__.__name__}: {exc}", timing_ms=int((time.perf_counter() - started) * 1000))
        timing_ms = int((time.perf_counter() - started) * 1000)
        rows = rows_to_dicts(records)
        columns = list(rows[0]) if rows else []
        log = SQLLogEntry(query_name=query_name, sql=safe_sql, params=[], row_count=len(rows), rows=rows[:25], timing_ms=timing_ms)
        return SandboxResult(ok=True, sql=safe_sql, rows=rows, sql_log=log, timing_ms=timing_ms, columns=columns)


def _cap_limit(sql: str) -> str:
    match = re.search(r"\bLIMIT\s+(\d+)\b", sql, flags=re.IGNORECASE)
    if not match:
        return sql
    limit = int(match.group(1))
    if limit <= 10000:
        return sql
    return sql[: match.start(1)] + "10000" + sql[match.end(1) :]
