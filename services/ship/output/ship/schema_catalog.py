"""Curated analytical schema catalog."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import Field

from .primitives.base import StrictModel


CATALOG_DIR = Path(__file__).resolve().parent / "seed" / "catalog"


class ColumnSpec(StrictModel):
    name: str
    type: Literal["string", "integer", "decimal", "date", "boolean", "json", "array"]
    nullable: bool = True
    description: str
    examples: list[str] = Field(default_factory=list)
    enum_values: list[str] | None = None
    units: str | None = None
    distinct_estimate: int | None = None
    pii: bool = False


class JoinKey(StrictModel):
    target_table: str
    on: list[tuple[str, str]]
    cardinality: Literal["1:1", "1:N", "N:1", "N:N"]


class TableSpec(StrictModel):
    name: str
    schema_name: str = Field(alias="schema")
    description: str
    grain: str
    primary_key: list[str] = Field(default_factory=list)
    columns: list[ColumnSpec]
    join_keys: dict[str, list[JoinKey]] = Field(default_factory=dict)
    row_count_estimate: int = 0
    refresh_cadence: str = "unknown"
    coverage_period: tuple[str, str] = ("1900-01-01", "2100-01-01")
    safe_for_analytical: bool = True
    notes: str = ""

    @property
    def fq_name(self) -> str:
        return f"{self.schema_name}.{self.name}"

    def column(self, name: str) -> ColumnSpec | None:
        lowered = name.lower()
        for column in self.columns:
            if column.name.lower() == lowered:
                return column
        return None


class SchemaCatalog(StrictModel):
    version: str
    tables: list[TableSpec]
    fts_columns: dict[str, list[str]] = Field(default_factory=dict)

    @property
    def schema_hash(self) -> str:
        payload = self.model_dump(mode="json")
        return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]

    def table(self, table_name: str) -> TableSpec | None:
        normalized = table_name.lower()
        for table in self.tables:
            if table.name.lower() == normalized or table.fq_name.lower() == normalized:
                return table
        return None

    def public_payload(self) -> dict[str, Any]:
        tables = []
        for table in self.tables:
            if not table.safe_for_analytical:
                continue
            payload = table.model_dump(mode="json", by_alias=True)
            payload["columns"] = [column for column in payload["columns"] if not column.get("pii")]
            tables.append(payload)
        return {"version": self.version, "schema_hash": self.schema_hash, "tables": tables, "fts_columns": self.fts_columns}


@lru_cache(maxsize=1)
def get_catalog() -> SchemaCatalog:
    tables: list[TableSpec] = []
    if CATALOG_DIR.exists():
        for path in sorted(CATALOG_DIR.glob("*.yaml")):
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            tables.append(TableSpec.model_validate(raw))
    catalog = SchemaCatalog(version="2026.04.29", tables=tables, fts_columns=_fts_columns(tables))
    _validate_catalog(catalog)
    return catalog


def _fts_columns(tables: list[TableSpec]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for table in tables:
        names = [
            column.name
            for column in table.columns
            if column.type == "string" and any(term in column.name.lower() for term in ("name", "description", "title", "program", "recipient", "vendor"))
        ]
        if names:
            out[table.fq_name] = names
    return out


def _validate_catalog(catalog: SchemaCatalog) -> None:
    table_names = {table.fq_name for table in catalog.tables}
    table_names.update(table.name for table in catalog.tables)
    for table in catalog.tables:
        column_names = {column.name for column in table.columns}
        for source_column, joins in table.join_keys.items():
            if source_column not in column_names:
                raise ValueError(f"{table.fq_name} join key {source_column!r} is not a column")
            for join in joins:
                if join.target_table not in table_names:
                    raise ValueError(f"{table.fq_name} join target {join.target_table!r} is missing")
