"""Schema-aware analytical query agent for open-ended warehouse questions."""

from __future__ import annotations

import json
import re
import time
from typing import Any
from uuid import UUID, uuid4

import asyncpg
from pydantic import Field

from .lexicon import ResolvedConcept, extract_lexicon_concepts, get_lexicon, resolve_concept
from .primitives.base import EmitCallback, SQLLogEntry, StrictModel, json_ready
from .recipes.base import RecipeResult
from .responses import Aggregation, SortKey
from .schema_catalog import SchemaCatalog, get_catalog
from .sql_compiler import CompileError, CompiledQuery, FilterSpec, QueryPlan, compile_query_plan
from .sql_sandbox import SqlSandbox


ANALYTICAL_RECIPE_PREFIX = "__analytical__"


class ConceptRef(StrictModel):
    phrase: str
    canonical_concept: str | None = None
    confidence: float = 0.0


class ConceptExtraction(StrictModel):
    concept_refs: list[ConceptRef] = Field(default_factory=list)
    time_filters: list[dict[str, Any]] = Field(default_factory=list)
    geographic_filters: list[dict[str, Any]] = Field(default_factory=list)
    metric_intents: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class AnalyticalRunResult(StrictModel):
    run_id: str
    sql: str
    sql_query_name: str
    template_id: str
    bound_concepts: list[ResolvedConcept] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    sql_log: list[SQLLogEntry] = Field(default_factory=list)
    column_descriptions: dict[str, str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    timing_ms: int
    schema_hash: str
    lexicon_version: str
    plan: QueryPlan
    sandbox_result: str


class AnalyticalAgent:
    def __init__(
        self,
        *,
        catalog: SchemaCatalog | None = None,
        sandbox: SqlSandbox | None = None,
        pool: asyncpg.Pool | None = None,
    ) -> None:
        self.catalog = catalog or get_catalog()
        self.lexicon = get_lexicon()
        if sandbox is not None:
            self.sandbox = sandbox
        elif pool is not None:
            self.sandbox = SqlSandbox(pool, self.catalog)
        else:
            raise ValueError("AnalyticalAgent requires either a sandbox or pool")

    async def run(
        self,
        *,
        question: str,
        conversation_id: UUID,
        turn_id: UUID,
        pool: asyncpg.Pool,
        memory_summary: list[dict[str, Any]] | None = None,
        emit: EmitCallback | None = None,
    ) -> AnalyticalRunResult:
        started = time.perf_counter()
        if emit:
            await emit("analytical_started", {"question": question})
            await emit("concept_extraction_started", {})
        extraction = self.extract_concepts(question)
        if emit:
            await emit(
                "concept_extraction_completed",
                {"concepts": [ref.model_dump(mode="json") for ref in extraction.concept_refs]},
            )
            await emit("plan_generation_started", {})
        plan, concepts = self.plan(question, extraction)
        if emit:
            await emit(
                "plan_generation_completed",
                {
                    "template_id": plan.template_id,
                    "primary_table": plan.primary_table,
                    "joins_count": len(plan.joins),
                    "filters_count": len(plan.filters),
                    "reasoning_one_line": plan.reasoning[:140],
                },
            )
        compiled: CompiledQuery | None = None
        caveats: list[str] = []
        findings: list[dict[str, Any]] = []
        sql_log: list[SQLLogEntry] = []
        sql_text = ""
        query_name = "analytical_q_rejected"
        sandbox_status = "rejected:not_compiled"
        try:
            compiled = compile_query_plan(plan, self.catalog, concepts)
            sql_text = compiled.sql
            query_name = compiled.query_name
            caveats.extend(compiled.caveats)
            if emit:
                await emit("sql_compiled", {"sql_query_name": query_name, "query_hash": compiled.query_hash, "length_chars": len(sql_text)})
                await emit("sandbox_validation_started", {})
            ok, reason, safe_sql = self.sandbox.validate(sql_text)
            if emit:
                await emit("sandbox_validation_completed", {"ok": ok, "reason": reason})
            if not ok:
                caveats.append(f"The generated analytical query did not pass safety checks: {reason}.")
                sandbox_status = f"rejected:{reason}"
            else:
                if emit:
                    await emit("sandbox_execution_started", {})
                result = await self.sandbox.execute(safe_sql, query_name=query_name)
                if result.ok:
                    findings = result.rows
                    sql_log = [result.sql_log] if result.sql_log else []
                    sandbox_status = "ok"
                    if emit:
                        await emit("sandbox_execution_completed", {"row_count": len(findings), "timing_ms": result.timing_ms, "columns": result.columns})
                else:
                    caveats.append(f"The analytical query could not run: {result.reason}.")
                    sandbox_status = f"error:{result.reason}"
                    if emit:
                        await emit("sandbox_execution_completed", {"row_count": 0, "timing_ms": result.timing_ms, "columns": []})
        except CompileError as exc:
            caveats.append(f"I tried to assemble a safe analytical query but could not: {exc}.")
            sandbox_status = f"rejected:{exc}"
        timing_ms = int((time.perf_counter() - started) * 1000)
        run_id = str(uuid4())
        analytical = AnalyticalRunResult(
            run_id=run_id,
            sql=sql_text,
            sql_query_name=query_name,
            template_id=plan.template_id,
            bound_concepts=concepts,
            findings=findings,
            sql_log=sql_log,
            column_descriptions=_column_descriptions(self.catalog, plan.primary_table),
            caveats=list(dict.fromkeys(caveats)),
            timing_ms=timing_ms,
            schema_hash=self.catalog.schema_hash,
            lexicon_version=self.lexicon.version,
            plan=plan,
            sandbox_result=sandbox_status,
        )
        await write_analytical_audit(
            pool,
            conversation_id=conversation_id,
            turn_id=turn_id,
            question=question,
            result=analytical,
            verifier_status=None,
        )
        if emit:
            await emit("analytical_completed", {"run_id": run_id, "row_count": len(findings), "timing_ms": timing_ms})
        return analytical

    def extract_concepts(self, question: str) -> ConceptExtraction:
        concepts = extract_lexicon_concepts(question, self.lexicon)
        metric_intents = _metric_intents(question)
        refs = [ConceptRef(phrase=concept.replace("_", " "), canonical_concept=concept, confidence=0.9) for concept in concepts]
        years = [int(item) for item in re.findall(r"\b(20\d{2})\b", question)]
        geos = _geo_filters(question)
        return ConceptExtraction(
            concept_refs=refs,
            time_filters=[{"year": year} for year in years],
            geographic_filters=geos,
            metric_intents=metric_intents,
        )

    def plan(self, question: str, extraction: ConceptExtraction) -> tuple[QueryPlan, list[ResolvedConcept]]:
        lowered = question.lower()
        named_recipient = _extract_named_funding_recipient(question)
        table_name = _choose_table(lowered)
        table = self.catalog.table(table_name)
        if table is None:
            raise CompileError(f"No safe analytical table is configured for {table_name}.")
        name_column = _name_column(table_name)
        amount_column = _amount_column(table_name)
        date_column = _date_column(table_name)
        filters: list[FilterSpec] = []
        resolved: list[ResolvedConcept] = []
        for ref in extraction.concept_refs:
            if ref.canonical_concept is None:
                continue
            concept = resolve_concept(ref.canonical_concept, table_name, name_column, self.catalog, self.lexicon)
            if concept is not None:
                resolved.append(concept)
                filters.append(FilterSpec(concept=concept.concept))
        for item in extraction.time_filters:
            filters.append(FilterSpec(column=date_column, op="=", value=int(item["year"])))
        for geo in extraction.geographic_filters:
            column = _geo_column(table_name)
            if column:
                filters.append(FilterSpec(column=column, op="=", value=geo["value"]))
        if named_recipient:
            filters.append(FilterSpec(column=name_column, op="ILIKE", value=f"%{named_recipient}%"))
        if "phac" in lowered:
            filters.append(FilterSpec(column=_department_column(table_name), op="ILIKE", value="%PHAC%"))
        if "esdc" in lowered:
            filters.append(FilterSpec(column=_department_column(table_name), op="ILIKE", value="%ESDC%"))

        if "median" in lowered:
            template = "percentile"
            aggregations = [Aggregation(column=amount_column, fn="median", alias="median_amount")]
            group_by: list[str] = []
            select_list: list[str] = []
            sort_by: list[SortKey] = []
            limit = 1
        elif re.search(r"\b(how many|count|distinct recipients)\b", lowered):
            template = "count_distinct"
            aggregations = []
            group_by = [name_column]
            select_list = []
            sort_by = []
            limit = 1
        elif "average" in lowered or "avg" in lowered:
            template = "aggregate_by_group"
            aggregations = [Aggregation(column=amount_column, fn="avg", alias="average_amount")]
            group_by = []
            select_list = []
            sort_by = []
            limit = 1
        elif named_recipient or "total" in lowered or "sum" in lowered:
            template = "aggregate_by_group"
            aggregations = [Aggregation(column=amount_column, fn="sum", alias="total_amount")]
            group_by = []
            select_list = []
            sort_by = []
            limit = 1
        elif "top" in lowered and ("city" in lowered or "cities" in lowered):
            template = "aggregate_by_group"
            city = _city_column(table_name)
            aggregations = [Aggregation(column=amount_column, fn="sum", alias="total_amount")]
            group_by = [city]
            select_list = []
            sort_by = [SortKey(column=city, dir="asc")]
            limit = _extract_limit(lowered) or 20
        else:
            template = "aggregate_by_group" if _threshold(lowered) else "top_n_with_filter"
            aggregations = [Aggregation(column=amount_column, fn="sum", alias="total_amount")] if _threshold(lowered) else []
            group_by = [name_column] if aggregations else []
            select_list = [name_column, amount_column, date_column]
            sort_by = []
            limit = _extract_limit(lowered) or 1000
        threshold = _threshold(lowered)
        if threshold and template == "aggregate_by_group":
            filters.append(FilterSpec(column="total_amount", op=">", value=threshold))
        return (
            QueryPlan(
                template_id=template,
                primary_table=table_name,
                select_list=select_list,
                filters=filters,
                group_by=group_by,
                aggregations=aggregations,
                sort_by=sort_by,
                limit=limit,
                expected_columns=[],
                reasoning=f"Plan uses {table_name} with {template} for a concrete analytical question.",
            ),
            resolved,
        )


def analytical_to_recipe_result(question: str, result: AnalyticalRunResult) -> RecipeResult:
    return RecipeResult(
        recipe_id=f"{ANALYTICAL_RECIPE_PREFIX}:{result.template_id}",
        question=question,
        params={
            "template_id": result.template_id,
            "schema_hash": result.schema_hash,
            "lexicon_version": result.lexicon_version,
            "bound_concepts": [concept.model_dump(mode="json") for concept in result.bound_concepts],
            "plan": result.plan.model_dump(mode="json"),
            "sandbox_result": result.sandbox_result,
        },
        findings=result.findings,
        sql_log=result.sql_log,
        caveats=result.caveats,
        source_runs=[],
        latency_ms=result.timing_ms,
    )


async def write_analytical_audit(
    pool: asyncpg.Pool,
    *,
    conversation_id: UUID,
    turn_id: UUID,
    question: str,
    result: AnalyticalRunResult,
    verifier_status: str | None,
) -> None:
    await pool.execute(
        """
INSERT INTO investigator.ship_analytical_audit
    (id, conversation_id, turn_id, user_question, plan_json, sql_text, schema_hash,
     lexicon_version, sandbox_result, row_count, timing_ms, verifier_status)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
""".strip(),
        UUID(result.run_id),
        conversation_id,
        turn_id,
        question,
        json.dumps(json_ready(result.plan.model_dump(mode="json")), ensure_ascii=False),
        result.sql,
        result.schema_hash,
        result.lexicon_version,
        result.sandbox_result,
        len(result.findings),
        result.timing_ms,
        verifier_status,
    )


async def update_analytical_audit_verifier(pool: asyncpg.Pool, run_id: UUID, verifier_status: str) -> None:
    await pool.execute(
        "UPDATE investigator.ship_analytical_audit SET verifier_status = $2 WHERE id = $1",
        run_id,
        verifier_status,
    )


def _metric_intents(question: str) -> list[str]:
    lowered = question.lower()
    intents = []
    for key, pattern in {
        "count": r"\b(how many|count|distinct)\b",
        "sum": r"\b(how much|total|sum)\b",
        "average": r"\b(avg|average)\b",
        "median": r"\bmedian\b",
        "list": r"\b(list|which|show)\b",
        "top_n": r"\btop\s+\d+\b",
    }.items():
        if re.search(pattern, lowered):
            intents.append(key)
    return intents or ["list"]


def _choose_table(lowered: str) -> str:
    if "charit" in lowered:
        return "cra.govt_funding_by_charity"
    if "contract" in lowered and "federal" not in lowered:
        return "ab.ab_contracts"
    if "sole-source" in lowered or "sole source" in lowered:
        return "ab.ab_sole_source"
    if "alberta" in lowered and "grant" in lowered:
        return "ab.ab_grants"
    return "fed.grants_contributions"


def _extract_named_funding_recipient(question: str) -> str | None:
    patterns = [
        r"\bhow\s+much\s+(?:public\s+|government\s+)?funding\s+did\s+(.+?)\s+receiv(?:e|ed)\b",
        r"\bhow\s+much\s+did\s+(.+?)\s+receiv(?:e|ed)\s+(?:in|from)\s+(?:public\s+|government\s+)?funding\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if match:
            return _clean_named_recipient(match.group(1))
    return None


def _clean_named_recipient(value: str) -> str:
    cleaned = re.sub(r"\b(in|during|for)\s+(?:fy)?20\d{2}.*$", "", value, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" ?'\".,")
    cleaned = re.sub(r"^(?:the|a|an)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace("%", "").replace("_", " ")
    return " ".join(cleaned.split())[:120]


def _name_column(table_name: str) -> str:
    return {
        "fed.grants_contributions": "recipient_legal_name",
        "ab.ab_contracts": "recipient",
        "ab.ab_sole_source": "vendor",
        "ab.ab_grants": "recipient",
        "cra.govt_funding_by_charity": "legal_name",
    }.get(table_name, "canonical_name")


def _amount_column(table_name: str) -> str:
    return {
        "fed.grants_contributions": "agreement_value",
        "ab.ab_contracts": "amount",
        "ab.ab_sole_source": "amount",
        "ab.ab_grants": "amount",
        "cra.govt_funding_by_charity": "total_govt",
    }.get(table_name, "total_all_funding")


def _date_column(table_name: str) -> str:
    return {
        "fed.grants_contributions": "agreement_start_date",
        "ab.ab_contracts": "display_fiscal_year",
        "ab.ab_sole_source": "display_fiscal_year",
        "ab.ab_grants": "display_fiscal_year",
        "cra.govt_funding_by_charity": "fiscal_year",
    }.get(table_name, "fiscal_year")


def _geo_column(table_name: str) -> str | None:
    return {
        "fed.grants_contributions": "recipient_province",
        "ab.ab_sole_source": "department_city",
    }.get(table_name)


def _city_column(table_name: str) -> str:
    return "department_city" if table_name == "ab.ab_sole_source" else "recipient_province"


def _department_column(table_name: str) -> str:
    return "owner_org" if table_name == "fed.grants_contributions" else "ministry"


def _geo_filters(question: str) -> list[dict[str, str]]:
    lowered = question.lower()
    values = {
        "alberta": "AB",
        "quebec": "QC",
        "manitoba": "MB",
        "ontario": "ON",
        "saskatchewan": "SK",
    }
    return [{"value": code, "label": name} for name, code in values.items() if name in lowered]


def _extract_limit(lowered: str) -> int | None:
    match = re.search(r"\btop\s+(\d+)\b", lowered)
    return min(max(int(match.group(1)), 1), 10000) if match else None


def _threshold(lowered: str) -> float | None:
    match = re.search(r"(?:more than|over|above|>)\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kmb])?", lowered)
    if not match:
        return None
    value = float(match.group(1).replace(",", ""))
    suffix = (match.group(2) or "").lower()
    return value * {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}.get(suffix, 1)


def _column_descriptions(catalog: SchemaCatalog, table_name: str) -> dict[str, str]:
    table = catalog.table(table_name)
    if not table:
        return {}
    return {column.name: column.description for column in table.columns}
