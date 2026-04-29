"""Curated concept lexicon for analytical queries."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import Field

from .primitives.base import StrictModel
from .schema_catalog import SchemaCatalog


LEXICON_DIR = Path(__file__).resolve().parent / "seed" / "lexicon"


class ApplicableColumn(StrictModel):
    table: str
    column: str
    match: str = "name_pattern"


class PredicateTemplate(StrictModel):
    sql_template: str


class Exclusion(StrictModel):
    concept: str
    rule: str


class LexiconEntry(StrictModel):
    concept: str
    synonyms: list[str] = Field(default_factory=list)
    description: str
    applicable_columns: list[ApplicableColumn] = Field(default_factory=list)
    predicate: dict[str, PredicateTemplate] = Field(default_factory=dict)
    exclusions: list[Exclusion] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    confidence: float = 0.75
    last_reviewed: str = "2026-04-29"
    reviewed_by: list[str] = Field(default_factory=lambda: ["service-team"])
    version: int = 1


class ResolvedConcept(StrictModel):
    concept: str
    sql_predicate: str
    bind_params: list[Any] = Field(default_factory=list)
    estimated_recall: float
    caveats: list[str] = Field(default_factory=list)
    excluded_concepts: list[str] = Field(default_factory=list)


class Lexicon(StrictModel):
    version: str
    entries: list[LexiconEntry]

    @property
    def lexicon_hash(self) -> str:
        payload = self.model_dump(mode="json")
        return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]

    def public_payload(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "lexicon_hash": self.lexicon_hash,
            "concepts": [
                {
                    "concept": entry.concept,
                    "synonyms": entry.synonyms,
                    "description": entry.description,
                    "caveats": entry.caveats,
                    "confidence": entry.confidence,
                    "version": entry.version,
                }
                for entry in self.entries
            ],
        }

    def find(self, phrase: str) -> LexiconEntry | None:
        normalized = _normalize(phrase)
        for entry in self.entries:
            terms = [entry.concept, *entry.synonyms]
            if normalized in {_normalize(term) for term in terms}:
                return entry
        singular = normalized.rstrip("s")
        for entry in self.entries:
            terms = [entry.concept, *entry.synonyms]
            if singular in {_normalize(term).rstrip("s") for term in terms}:
                return entry
        return None


@lru_cache(maxsize=1)
def get_lexicon() -> Lexicon:
    entries: list[LexiconEntry] = []
    if LEXICON_DIR.exists():
        for path in sorted(LEXICON_DIR.glob("*.yaml")):
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            entries.append(LexiconEntry.model_validate(raw))
    return Lexicon(version="2026.04.29", entries=entries)


def resolve_concept(
    concept_name: str,
    target_table: str,
    target_column: str,
    catalog: SchemaCatalog,
    lexicon: Lexicon,
) -> ResolvedConcept | None:
    entry = lexicon.find(concept_name)
    if entry is None:
        return None
    table = catalog.table(target_table)
    if table is None:
        return None
    column = table.column(target_column)
    if column is None or column.pii:
        return None
    for applicable in entry.applicable_columns:
        applies_table = applicable.table in {target_table, table.name, table.fq_name}
        if applies_table and applicable.column.lower() == target_column.lower():
            template = entry.predicate.get(applicable.match)
            if template is None:
                return None
            return ResolvedConcept(
                concept=entry.concept,
                sql_predicate=template.sql_template.format(col=_qualified_identifier(target_column)),
                bind_params=[],
                estimated_recall=entry.confidence,
                caveats=entry.caveats,
                excluded_concepts=[item.concept for item in entry.exclusions],
            )
    return None


def extract_lexicon_concepts(question: str, lexicon: Lexicon) -> list[str]:
    lowered = _normalize(question)
    matches: list[str] = []
    for entry in lexicon.entries:
        for term in [entry.concept, *entry.synonyms]:
            normalized = _normalize(term)
            if re_match_phrase(normalized, lowered):
                matches.append(entry.concept)
                break
    return list(dict.fromkeys(matches))


def re_match_phrase(phrase: str, text: str) -> bool:
    return phrase in text or phrase.rstrip("s") in text


def _qualified_identifier(column: str) -> str:
    if not column.replace("_", "").isalnum() or column[0].isdigit():
        raise ValueError(f"unsafe column identifier {column!r}")
    return column


def _normalize(value: str) -> str:
    return " ".join(value.lower().replace("_", " ").split())
