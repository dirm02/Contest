"""Shared deterministic primitive result shapes and SQL helpers."""

from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import asyncpg
from pydantic import BaseModel, ConfigDict, Field


DEFAULT_DATABASE_URL = "postgresql://hackathon:hackathon@localhost:5432/hackathon"
EmitCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SQLLogEntry(StrictModel):
    query_name: str
    sql: str
    params: list[Any] = Field(default_factory=list)
    row_count: int
    rows: list[dict[str, Any]] = Field(default_factory=list)
    timing_ms: int


class PrimitiveResult(StrictModel):
    primitive_name: str
    rows: list[dict[str, Any]] = Field(default_factory=list)
    sql_log: list[SQLLogEntry] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    timing_ms: int = 0


def database_url_from_env() -> str:
    raw = os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    if raw.startswith("postgresql+asyncpg://"):
        return raw.replace("postgresql+asyncpg://", "postgresql://", 1)
    return raw


async def create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(database_url_from_env(), min_size=1, max_size=6)


def json_ready(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_ready(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_ready(item) for item in value]
    return value


def rows_to_dicts(rows: list[asyncpg.Record] | tuple[asyncpg.Record, ...]) -> list[dict[str, Any]]:
    return [json_ready(dict(row)) for row in rows]


async def run_query(
    pool: asyncpg.Pool,
    *,
    query_name: str,
    sql: str,
    params: list[Any] | tuple[Any, ...] = (),
    statement_timeout_ms: int = 25_000,
    emit: EmitCallback | None = None,
    primitive_name: str | None = None,
) -> tuple[list[dict[str, Any]], SQLLogEntry]:
    started = time.perf_counter()
    timeout = max(1_000, min(int(statement_timeout_ms), 30_000))
    if emit:
        await emit(
            "sql_query_started",
            {"primitive_name": primitive_name or "sql", "query_name": query_name},
        )
    async with pool.acquire() as conn:
        async with conn.transaction(readonly=True):
            await conn.execute(f"SET LOCAL statement_timeout = {timeout}")
            records = await conn.fetch(sql, *params)
    timing_ms = int((time.perf_counter() - started) * 1000)
    rows = rows_to_dicts(records)
    if emit:
        await emit(
            "sql_query_completed",
            {
                "primitive_name": primitive_name or "sql",
                "query_name": query_name,
                "row_count": len(rows),
                "timing_ms": timing_ms,
            },
        )
    return rows, SQLLogEntry(
        query_name=query_name,
        sql=sql,
        params=json_ready(list(params)),
        row_count=len(rows),
        rows=rows,
        timing_ms=timing_ms,
    )


def combine_primitive_results(name: str, parts: list[PrimitiveResult], rows: list[dict[str, Any]]) -> PrimitiveResult:
    started_total = sum(part.timing_ms for part in parts)
    sql_log: list[SQLLogEntry] = []
    caveats: list[str] = []
    for part in parts:
        sql_log.extend(part.sql_log)
        caveats.extend(part.caveats)
    return PrimitiveResult(primitive_name=name, rows=rows, sql_log=sql_log, caveats=caveats, timing_ms=started_total)


async def emit_primitive_started(
    emit: EmitCallback | None,
    primitive_name: str,
    args_summary: dict[str, Any] | None = None,
) -> None:
    if emit:
        await emit(
            "primitive_started",
            {
                "primitive_name": primitive_name,
                "args_summary": _compact_event_value(args_summary or {}),
            },
        )


async def emit_primitive_completed(emit: EmitCallback | None, result: PrimitiveResult) -> None:
    if emit:
        await emit(
            "primitive_completed",
            {
                "primitive_name": result.primitive_name,
                "row_count": len(result.rows),
                "caveats": result.caveats[:5],
                "timing_ms": result.timing_ms,
            },
        )


def _compact_event_value(value: Any, *, depth: int = 0) -> Any:
    if depth >= 2:
        return "<nested>"
    if isinstance(value, dict):
        return {str(key): _compact_event_value(item, depth=depth + 1) for key, item in list(value.items())[:10]}
    if isinstance(value, list):
        return [_compact_event_value(item, depth=depth + 1) for item in value[:5]]
    if isinstance(value, str):
        return value if len(value) <= 160 else value[:157].rstrip() + "..."
    return json_ready(value)
