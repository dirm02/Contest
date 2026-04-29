# Brief: Add an Analytical Query Agent for Open-Ended Questions

## 0. What this is, in one sentence

The Accountability Analyst service today can only answer questions that match one of ten hand-crafted recipes (zombie recipients, ghost capacity, funding loops, sole-source amendments, vendor concentration, related parties, policy misalignment, duplicative funding, contract intelligence, adverse media). Reasonable, simple, well-formed accountability questions like *"How many schools received funding in 2024?"*, *"What's the total funding to Indigenous organizations last year?"*, *"List universities with more than $10M in federal contracts"* fall into a dead zone — they don't match any recipe, the router picks the wrong one or punts, and the user is told either to clarify or that the question isn't supported. We're going to fix that by adding a fourth, parallel path to the existing classifier: a **schema-aware Analytical Query Agent** that writes safe, sandboxed SQL against the open-data warehouse, paired with a **concept lexicon** that resolves natural-language categories ("schools", "hospitals", "Indigenous organizations") into reliable predicates.

This prompt extends the multi-turn architecture defined in `service-prompt.md`. Read that brief first — the wire contract, memory system, classifier, and op-discriminated-union all stay intact. This brief adds **one new mode** (`analytical_query`), **one new recipe-shaped artifact** (`AnalyticalRun`), **one new module** (`analytical.py`), **one schema catalog**, **one curated lexicon**, and a hardened SQL sandbox.

---

## 1. Your Role and Constraints

You are a senior backend engineer with deep experience in LLM-driven SQL generation, query sandboxing, and data-warehouse modeling. You understand that *"let an LLM write SQL"* is one of the highest-injection-risk patterns in software, and you build accordingly.

Stack (no changes):

- Python, FastAPI, asyncpg, PostgreSQL.
- Pydantic-AI agents for LLM calls.
- DuckDB-in-process for in-memory analytics (already pulled in by `service-prompt.md`).
- Codebase root: `services/ship/output/ship/`.

Hard constraints:

- **No raw user-supplied SQL.** Ever. Users phrase questions in natural language; the agent generates SQL; the sandbox validates and executes.
- **No DDL, no DML.** Generated SQL is read-only — `SELECT` only, no `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`DROP`/`ALTER`/`COPY`/`GRANT`. Multi-statement queries are rejected.
- **No new data sources.** Only the tables already exposed in the existing recipes. We are not connecting to new APIs.
- **Wire-compatible.** An `AnalyticalRun` is a `RecipeRun` with `recipe_id = "__analytical__:{template_id}"`. The frontend doesn't need new types beyond what `service-prompt.md` already adds.
- **Deterministic at the query level.** Same question + same lexicon snapshot + same data must produce the same SQL (modulo whitespace) — cache by `(normalized_question, lexicon_version, schema_hash)`.
- **Latency budget.** ≤ 8s p95 end-to-end for an analytical_query turn (planner + SQL gen + sandbox + execution + summarizer + verifier). Hard cap of 30s on the sandbox executor.
- **Observability.** Every generated SQL is logged with conversation_id, turn_id, generation reasoning, sandbox result, and verifier outcome. Logs feed a future review queue for the lexicon team.

---

## 2. The Problem in Concrete Examples

Questions that should now work end-to-end:

| Question | Why current architecture fails | What the agent should do |
|---|---|---|
| "How many schools received funding in 2024?" | "Schools" is not a recipe; no `recipient_type` parameter exists. | Resolve "schools" via the lexicon → name pattern set; SELECT COUNT(DISTINCT recipient) FROM federal_grants WHERE name pattern + year=2024. |
| "What's the total funding to Indigenous organizations last year?" | No recipe targets Indigenous-org classification. | Lexicon → Indigenous-org name patterns + Crown corp list + relevant CRA designation codes; SUM(amount) WHERE … AND fiscal_year=2024. |
| "List universities with more than $10M in federal contracts." | None of the procurement recipes exposes recipient-class filters. | Lexicon → universities; SELECT recipient, SUM(contract_value) FROM contracts GROUP BY recipient HAVING SUM > 10M ORDER BY 2 DESC. |
| "How many distinct recipients received money from both ESDC and PHAC in 2023?" | Cross-department intersection isn't a recipe. | Generate a CTE: recipients funded by ESDC ∩ recipients funded by PHAC in 2023; COUNT(DISTINCT). |
| "Average contract value in Manitoba in FY2024?" | Aggregate by province isn't a recipe param. | Filter by `province = 'MB'` + AVG(value). |
| "Top 20 cities by total federal contracts in 2023." | Aggregate by city isn't a recipe param. | GROUP BY city + ORDER BY SUM DESC LIMIT 20. |
| "Are there charities that received money from Innovation Canada AND Health Canada the same year?" | Multi-source intersection isn't a recipe. | Cross-department EXISTS-style CTE on the charity dataset. |
| "Which Crown corporations got more funding in 2024 than 2023?" | Year-over-year delta isn't a recipe param. | LAG/LEAD or CTE-paired SUMs with delta. |
| "What's the median grant size in Quebec in 2024?" | Median per-province isn't a recipe param. | PERCENTILE_CONT(0.5) WITHIN GROUP. |

Questions that should still **not** work, and should still cleanly say so:

- "Predict who will receive funding next year." (forecasting; no model exists)
- "Is the federal government corrupt?" (opinion / not factual)
- "Which contractors are committing fraud?" (defamatory inference; verifier rejects)
- "Show me the personal email of the deputy minister." (PII/out of scope)
- "What's the GDP of Canada?" (out of dataset scope)

The agent must never silently fabricate. If a question references data we don't have, it returns a clean `not_answerable` with a reason, not a hallucinated number.

---

## 3. The Gap Analysis (why today's architecture fails)

**Architectural gap 1 — single-recipe routing.** `router.py` picks 1 of N pre-built recipes. There is no "compose your own" path.

**Architectural gap 2 — fixed-shape SQL.** `recipes/*.py` are templates with fixed parameters and fixed output schemas. They cannot answer questions about cross-cutting categories the templates don't model.

**Architectural gap 3 — no semantic ontology.** The service has no concept layer mapping natural-language categories (schools, hospitals, Indigenous orgs, vendors, charities, municipalities) to predicates over the raw datasets. Even if a generic recipe existed, "schools" is not a column.

**Architectural gap 4 — no schema introspection at the agent level.** The router doesn't reason about which tables and columns exist; it only matches on intent keywords. There is no LLM context describing the warehouse.

**Architectural gap 5 — no escape hatch.** When a question is reasonable but unmatched, the system has nowhere to go but `clarification_needed` or `not_answerable`. No "let me try to write a query" fallback.

This brief addresses all five.

---

## 4. Target Architecture

A new mode joins the classifier output (`service-prompt.md` §5):

```
fresh           — existing: run a built-in recipe
refined         — existing: in-memory op on a prior run
composed        — existing: combine multiple prior runs
conversational  — existing: comment on memory only
analytical_query — NEW: write a custom SQL query against the warehouse
clarify
new_conversation
not_answerable
```

The classifier picks `analytical_query` when:
- The question is concrete and answerable from the warehouse.
- AND no built-in recipe is a strong fit (existing recipe scoring threshold falls below a confidence cutoff).
- AND the question references concepts that either appear directly as columns OR are resolvable via the lexicon.

When the classifier picks `analytical_query`, it emits a planned operation `recipe_run` with `recipe_id = "__analytical__"`, and the orchestrator delegates to the new module.

```
[ classifier ]
    │
    │  mode = analytical_query
    ▼
[ analytical.py ]
    │
    ├──► (a) lexicon resolution        — concepts → predicates
    ├──► (b) schema selection          — pick relevant tables & columns
    ├──► (c) SQL generation (LLM)      — strict-output, schema-bounded
    ├──► (d) SQL static validation     — AST checks, allow-list
    ├──► (e) SQL sandbox execution     — DuckDB read replica or live PG read role
    ├──► (f) findings shaping          — coerce to RecipeRun shape
    ▼
[ existing summarizer + verifier ]
    ▼
final_response  (mode='fresh', operations=[RecipeRunOp(recipe_id='__analytical__:<template>', …)])
```

Three new modules, one new schema artifact, one new lexicon file:

- `services/ship/output/ship/analytical.py` — the agent.
- `services/ship/output/ship/schema_catalog.py` — the schema-introspection helper.
- `services/ship/output/ship/lexicon/` — the curated concept dictionary (YAML files + a Python loader).
- `services/ship/output/ship/sql_sandbox.py` — the AST validator + sandbox executor.
- `services/ship/output/ship/seed/lexicon/*.yaml` — initial concept definitions.

---

## 5. The Schema Catalog (`schema_catalog.py`)

The agent must know what data exists. Build a curated, hand-edited catalog of every table, view, and column the analytical agent is allowed to touch.

### 5.1 Catalog shape

```python
class ColumnSpec(BaseModel):
    name: str
    type: Literal["string", "integer", "decimal", "date", "boolean", "json", "array"]
    nullable: bool
    description: str
    examples: list[str] = []           # 3-5 representative values
    # When applicable:
    enum_values: list[str] | None = None
    units: str | None = None           # 'CAD', 'fiscal_year', 'iso_date', etc.
    distinct_estimate: int | None = None
    pii: bool = False                  # if true, agent must NOT select this column

class TableSpec(BaseModel):
    name: str                          # canonical, used in SQL
    schema: str                        # postgres schema or DuckDB attached db
    description: str                   # 1-2 sentence summary of what's in it
    grain: str                         # "one row per recipient-fiscal_year-program"
    primary_key: list[str]
    columns: list[ColumnSpec]
    join_keys: dict[str, list[JoinKey]]  # to other tables
    row_count_estimate: int
    refresh_cadence: str               # "monthly", "quarterly", "yearly", "ad-hoc"
    coverage_period: tuple[date, date]
    safe_for_analytical: bool          # the kill-switch — if false, agent cannot use it
    notes: str = ""

class JoinKey(BaseModel):
    target_table: str
    on: list[tuple[str, str]]          # [("recipient_norm", "recipient_norm")]
    cardinality: Literal["1:1", "1:N", "N:1", "N:N"]

class SchemaCatalog(BaseModel):
    version: str                        # semver-ish
    tables: list[TableSpec]
    fts_columns: dict[str, list[str]]   # { table_name: [columns_with_fulltext] }
```

### 5.2 What goes in the initial catalog

Audit every recipe in `recipes/*.py` and every primitive in `primitives/*.py`. Every table/view they read becomes a row in the catalog. Examples (concrete table names should come from the existing code; below are illustrative):

- `federal_grants_recipient` — federal grants & contributions (Open Government).
- `federal_contracts` — federal procurement disclosure.
- `cra_charity_returns` — CRA T3010 returns.
- `ab_contracts` — Alberta sole-source contract registry.
- `corporations_canada_status` — federal corporation registry.
- `gc_infobase_program_results` — program plans/results.
- `cmhc_housing_data` — housing context.
- `phac_health_indicators` — health indicators.
- `infrastructure_canada_projects` — federal infrastructure projects.
- (whatever else the existing recipes import)

Each table needs every column documented with type + description + examples + pii flag. PII columns (deputy minister names tied to private addresses, contributor names from political donation tables if any, etc.) get `pii=true` and are filtered from the agent's view. Hand-curated; do not let the LLM generate the catalog.

### 5.3 Catalog hashing and versioning

Compute a `schema_hash` over the canonicalized catalog at startup. Include it in every `analytical_query` run record so we can later replay/audit which catalog version produced which SQL.

### 5.4 Catalog endpoint (for the UI's introspection)

```python
@app.get("/catalog/datasets")
async def datasets_endpoint() -> dict:
    """Returns the analytical catalog without PII columns, for UI display."""
```

This lets the chat empty-state (`ui-prompt.md` §7.3) optionally surface "What can I ask about?" with a real list of datasets.

### 5.5 Loading

The catalog lives at `services/ship/output/ship/seed/catalog/*.yaml`, one file per table for review-friendliness. `schema_catalog.py` loads them at startup, validates referential integrity (every join_key target exists), and exposes `get_catalog() -> SchemaCatalog`.

---

## 6. The Concept Lexicon (`lexicon/*.yaml`)

The lexicon is the "translator" from natural-language categories to predicates over the catalog. Without it, "schools" stays unresolvable.

### 6.1 Lexicon entry shape

```yaml
# services/ship/output/ship/seed/lexicon/schools.yaml
concept: schools
synonyms:
  - school
  - schools
  - elementary school
  - primary school
  - secondary school
  - high school
  - école
  - écoles
  - school district
  - school board
  - conseil scolaire
  - commission scolaire
description: |
  Educational institutions at the elementary or secondary level. Includes
  public school boards, independent schools, French-language school boards,
  and First Nations schools. Excludes universities and colleges (see
  concept: post_secondary).
applicable_columns:
  # Where in the catalog this concept can be matched.
  - table: federal_grants_recipient
    column: recipient_legal_name
    match: name_pattern
  - table: federal_grants_recipient
    column: recipient_operating_name
    match: name_pattern
  - table: federal_contracts
    column: vendor_name
    match: name_pattern
  - table: ab_contracts
    column: contractor_name
    match: name_pattern
  - table: cra_charity_returns
    column: charity_name
    match: name_pattern
predicate:
  # The actual fragment, parameterized by column.
  name_pattern:
    sql_template: |
      ({col} ILIKE '%school%'
        OR {col} ILIKE '%école%'
        OR {col} ILIKE '%conseil scolaire%'
        OR {col} ILIKE '%commission scolaire%'
        OR {col} ILIKE '%school board%'
        OR {col} ILIKE '%school district%')
      AND NOT (
        {col} ILIKE '%school of business%'
        OR {col} ILIKE '%school of medicine%'
        OR {col} ILIKE '%medical school%'
        OR {col} ILIKE '%law school%'
        OR {col} ILIKE '%school of public%'
      )
exclusions:
  # Concepts that overlap and need disambiguation.
  - concept: universities
    rule: |
      Most "School of Medicine" / "School of Business" entries are part of universities,
      not independent schools. The exclusion clause handles the common cases; for ambiguous
      results, prefer the universities lexicon.
caveats:
  - "May miss French-only school boards whose names omit 'conseil/commission scolaire'."
  - "First Nations schools may register under band names; coverage is partial."
confidence: 0.85         # estimated recall for typical queries
last_reviewed: 2026-04-01
reviewed_by: ["lexicon-team"]
version: 1
```

### 6.2 Initial lexicon (must ship with the agent)

At minimum, the following concepts must be defined before launch. Each gets its own YAML file under `seed/lexicon/`:

- `schools` (K–12)
- `post_secondary` (universities, colleges, CEGEPs, polytechnics)
- `hospitals` (acute, regional health authorities)
- `municipalities` (cities, towns, villages, RMs, regional districts)
- `provinces_and_territories`
- `federal_departments` (with mapping to canonical short codes)
- `crown_corporations`
- `indigenous_organizations` (First Nations bands, Métis settlements, Inuit organizations, urban Indigenous)
- `nonprofits_and_charities` (with CRA designation distinction)
- `for_profit_corporations`
- `research_institutions`
- `unions_and_associations`
- `religious_organizations`
- `political_parties` (and EDAs)

Every concept has the same shape as §6.1. Lexicon authorship is **human-curated**. The LLM may *propose* additions to the review queue but cannot push.

### 6.3 Lexicon resolution

A new helper:

```python
def resolve_concept(
    concept_name: str,
    target_table: str,
    target_column: str,
    catalog: SchemaCatalog,
    lexicon: Lexicon,
) -> ResolvedConcept | None:
    """
    Returns a parameterized SQL predicate fragment for the concept on the given
    column, or None if this concept doesn't apply to that column.
    """
```

```python
class ResolvedConcept(BaseModel):
    concept: str
    sql_predicate: str   # parameterized SQL fragment, no user input
    bind_params: list   # always [], never user-supplied
    estimated_recall: float
    caveats: list[str]
    excluded_concepts: list[str]
```

Every resolution gets logged: `{conversation_id, turn_id, concept, target_table, target_column, recall_estimate}`.

### 6.4 Fuzzy concept matching

The classifier or analytical agent may mention a concept that doesn't exist verbatim in the lexicon ("private schools", "small charities"). Implement fallback strategies in this order:

1. Exact match on `concept` or any `synonym`.
2. Lemmatization + exact match (handle "schools" → "school", "écoles" → "école").
3. Composition — if the user's phrase includes a known concept + a modifier, attempt to split: "private schools" → `schools` + a separate predicate on a hypothetical `is_private` column (only if such a column exists in the catalog).
4. If nothing matches, the agent treats it as an unresolved concept and either asks for clarification or proceeds with a `name LIKE` heuristic prefixed with a strong caveat in the answer ("I matched on names containing 'private', this may include unrelated entities — see caveats").

Never silently drop the concept. Always surface in the answer's caveats.

### 6.5 Lexicon endpoint

```python
@app.get("/catalog/concepts")
async def concepts_endpoint() -> dict:
    """Returns concept names + descriptions + caveats for UI introspection."""
```

Useful for the chat to suggest "I understand these concepts: schools, hospitals, …" in the empty state.

---

## 7. The Analytical Query Agent (`analytical.py`)

### 7.1 Public interface

```python
class AnalyticalAgent:
    def __init__(
        self,
        catalog: SchemaCatalog,
        lexicon: Lexicon,
        sandbox: SqlSandbox,
        llm: AnalyticalLLM,
    ): ...

    async def run(
        self,
        question: str,
        memory_summary: list[MemoryEntry],
        emit: Callable[[Event], None],
    ) -> AnalyticalRunResult: ...
```

`AnalyticalRunResult` carries:

```python
class AnalyticalRunResult(BaseModel):
    run_id: str
    sql: str
    sql_query_name: str       # synthetic, used for citations: e.g. 'analytical_q_2024_schools'
    template_id: str          # see §7.3 for templates
    bound_concepts: list[ResolvedConcept]
    findings: list[dict]
    sql_log: list[SqlLogEntry]
    column_descriptions: dict[str, str]
    caveats: list[str]
    timing_ms: int
    schema_hash: str
    lexicon_version: str
```

### 7.2 The five steps

1. **Concept extraction** (LLM, strict output): given the question, list every concept the user invoked. Output is a `list[ConceptRef]` where each `ConceptRef` is `{phrase: str, suggested_concept: str | null, confidence: float}`. The LLM is given the lexicon's concept names and synonyms as context.
2. **Concept resolution** (deterministic): for each `ConceptRef`, run `resolve_concept` against every applicable column in candidate tables. Produces a set of `(ResolvedConcept, target_table, target_column)` triples.
3. **Plan generation** (LLM, strict output): the LLM receives the question, the resolved concepts, the schema catalog (filtered to candidate tables), and a small library of `QueryTemplate`s. It outputs a `QueryPlan`:

   ```python
   class QueryPlan(BaseModel):
       template_id: str           # see §7.3
       primary_table: str
       joins: list[JoinSpec]
       filters: list[FilterSpec]   # references resolved concepts and column predicates
       group_by: list[str]
       aggregations: list[Aggregation]
       sort_by: list[SortKey]
       limit: int                  # default 1000, hard cap 10000
       expected_columns: list[str]  # what the SQL will return
       reasoning: str               # ≤ 500 chars
   ```
4. **SQL synthesis** (deterministic): a Python compiler turns the `QueryPlan` into a single safe SELECT statement. The LLM does NOT write raw SQL strings — it writes a structured plan. The compiler is the only thing that emits SQL bytes. This eliminates injection at the plan level.
5. **Sandbox execution** (`sql_sandbox.py`, §8): validate, execute, return rows.

### 7.3 Query templates

Define a small set of well-tested SQL templates that the agent picks from. Each template fixes the high-level shape; the plan fills in the specifics:

- `count_distinct` — `SELECT COUNT(DISTINCT {key}) AS count FROM {primary} {joins} WHERE {filters}`.
- `aggregate_by_group` — `SELECT {group_by}, {aggregations} FROM {primary} {joins} WHERE {filters} GROUP BY {group_by} ORDER BY {sort_by} LIMIT {limit}`.
- `top_n_with_filter` — `SELECT {select_list} FROM {primary} {joins} WHERE {filters} ORDER BY {sort_by} LIMIT {limit}`.
- `existence_per_entity` — for "did X happen for these entities" questions. CTE-based.
- `intersection_across_filters` — for "X AND Y" entity intersections.
- `delta_year_over_year` — pre-built CTE pattern with two `WHERE year = N` halves and a join on entity.
- `percentile` — `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {col}) FROM {primary} WHERE {filters}`.

Refuse to expand the template set with anything more dynamic without new SQL-sandbox unit tests. Templates are source code, not LLM output. New templates require a PR.

### 7.4 The plan-generation LLM prompt

System prompt (verbatim, tune for tone but not semantics):

```
You are the Analytical Query Planner for a Canadian public-money accountability
service. You receive:
  - the user's question
  - a list of concepts extracted from the question (resolved via a curated
    lexicon; each concept comes with a parameterized SQL predicate fragment)
  - a filtered subset of the warehouse schema relevant to this question
  - the names of available QueryTemplates
You output a QueryPlan. You MUST NOT output free-form SQL. The compiler will
produce SQL from your plan.

Rules:
  • Pick the simplest QueryTemplate that fits. If two would work, pick
    `count_distinct` over `aggregate_by_group` for "how many" questions.
  • Use only tables and columns that appear in the provided schema. Referencing
    anything else fails the plan.
  • Use only resolved concepts in filters. Don't invent new predicates.
  • Use only safe-listed aggregation functions: COUNT, COUNT DISTINCT, SUM, AVG,
    MIN, MAX, MEDIAN (PERCENTILE_CONT(0.5)), STDDEV.
  • LIMIT default 1000. Maximum 10000. For top-N, set LIMIT = N.
  • For year filters, prefer the column documented as fiscal_year over date
    columns, unless the user explicitly says "calendar year" or "in 2024" with
    no fiscal context (in which case use the date column with EXTRACT(YEAR …)).
  • Never include PII columns in `select_list`. The schema marks them.
  • If the question can't be answered from the provided schema, output template_id
    = "abstain" with a one-line reasoning. Do NOT guess.
  • If the question is too vague to plan (e.g. "tell me about schools"), output
    template_id = "abstain" with reasoning that asks for specifics.

Output strict JSON conforming to QueryPlan.
```

LLM context budget for plan generation: ~12K tokens (catalog filtered to ≤ 6 candidate tables + lexicon concepts cited by the question + question + chat memory summary capped at 1.5K tokens).

### 7.5 Plan-to-SQL compiler

Pure Python. Takes a `QueryPlan` and returns a string SQL plus a list of bind params (always empty in v1 — predicates come from resolved concepts which are static fragments). Walks the plan:

1. Resolve `primary_table` against the catalog. Reject if not present, not safe-for-analytical, or has any unmet PII flag interfering.
2. Resolve each `JoinSpec`. Reject if join keys aren't in the table's `join_keys` map (defense-in-depth: agent can only join where the catalog says it's safe).
3. Render filters: each `FilterSpec` is either a `ResolvedConcept` predicate (static SQL fragment from the lexicon) or a column-op-value triple where the value is a literal type-checked against the column type. String literals get aggressive escaping; ints/dates/decimals are coerced to canonical literals.
4. Render aggregations from the safe-list.
5. Apply LIMIT cap.
6. Emit the SQL string. Compute a normalized SHA-256 fingerprint; that's the run's `query_hash`.

### 7.6 LLM agent for concept extraction

A separate small Pydantic-AI agent. Output:

```python
class ConceptExtraction(BaseModel):
    concept_refs: list[ConceptRef]
    time_filters: list[TimeFilter]   # year, fiscal_year, date range
    geographic_filters: list[GeoFilter]  # province, city, postal prefix
    metric_intents: list[MetricIntent]   # "count", "sum", "average", "list", "top-N"
    open_questions: list[str]            # things the agent isn't sure about

class ConceptRef(BaseModel):
    phrase: str               # the user's words
    canonical_concept: str | None  # null if no lexicon match
    confidence: float
```

Used both inside `analytical.py` and exposed back to the classifier so it can decide whether to commit to `analytical_query` or fall through to `clarify`.

### 7.7 Memory awareness

`analytical_query` runs land in the existing `conversation_memory` table (`service-prompt.md` §6.1) with `recipe_id = '__analytical__:<template_id>'` and `derived_op = JSON of the QueryPlan`. They participate in refinement and composition exactly like any other run — `"sort by amount"` after an analytical query just hits the existing refinement engine.

---

## 8. The SQL Sandbox (`sql_sandbox.py`)

### 8.1 Validation pipeline (BEFORE execution)

For every generated SQL string:

1. **Parse** with `sqlglot` (Python SQL parser, dialect = Postgres). Reject on parse failure with a helpful caveat.
2. **AST allow-list checks**:
   - Top-level node must be exactly one `SELECT`. `WITH` (CTEs) allowed. `SELECT INTO`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `DROP`, `ALTER`, `GRANT`, `REVOKE`, `TRUNCATE`, `COPY`, `VACUUM`, `EXPLAIN`, `SET`, `BEGIN`, `COMMIT`, `ROLLBACK` → reject.
   - No `EXECUTE`, `EXECUTE FORMAT`, `pg_*`, `lo_*` system functions.
   - Function calls limited to a curated allow-list:
     - Scalar: `LOWER`, `UPPER`, `LENGTH`, `COALESCE`, `NULLIF`, `ABS`, `CEIL`, `FLOOR`, `ROUND`, `EXTRACT`, `DATE_TRUNC`, `TO_DATE`, `TO_CHAR`, `CAST`.
     - Aggregates: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `STDDEV`, `STDDEV_POP`, `VARIANCE`, `PERCENTILE_CONT`.
     - Window: `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `LAG`, `LEAD`, `OVER`, `PARTITION BY`, `ORDER BY`.
     - String matching: `LIKE`, `ILIKE`, `SIMILAR TO`. No `~` regex (Postgres regex can be a DoS vector).
   - Refuse `LATERAL`, set-returning functions in SELECT (`generate_series`, etc.), and any function not on the allow-list.
3. **Table allow-list**: every table referenced must appear in the catalog with `safe_for_analytical=true`.
4. **Column allow-list**: every column referenced must exist in the catalog and not be flagged `pii=true`.
5. **LIMIT enforcement**: if the SQL has no LIMIT, inject `LIMIT 10000`. If the LIMIT exceeds 10000, lower it to 10000 and add a caveat.
6. **Statement count**: parsed AST must contain exactly one statement. Multiple statements → reject.
7. **Identifier check**: every identifier (table, column, alias) must satisfy `^[A-Za-z_][A-Za-z0-9_]*$`. Reject quoted identifiers that bypass this.

If any check fails, the sandbox returns a `SandboxRejection` with a human-readable reason. The agent does NOT retry with a tweaked query — it surfaces the rejection as a caveat ("I tried to write a query, but I couldn't because …") and falls back to `clarification_needed`. This is intentional: blind LLM retry on validation errors is a known foot-gun.

### 8.2 Execution

Use a dedicated **read-only Postgres role** (`analytical_reader`) with `SELECT` on the safe-for-analytical tables only and no other grants. Execute with:

- Statement timeout: 25s.
- Idle-in-transaction timeout: 5s.
- Lock timeout: 5s.
- Read-only transaction: `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ;`.
- Resource limits at the connection pool: max 4 concurrent analytical queries.

Execution returns rows + column metadata + timing.

If execution fails (timeout, schema drift), the run resolves with `findings = []`, a caveat explaining the failure, and a `verifier_check` failure. The summarizer is told the query couldn't run; it will not invent results.

### 8.3 Resource quota per turn

- Max 1 SQL query per `analytical_query` turn. Multiple queries are not yet supported. (Future work — leave a `queries: list[GeneratedQuery]` in the result type so this is forward-compatible.)
- Max 10000 returned rows per query.
- Max 50MB returned data per query.

### 8.4 Audit log

Every analytical execution writes a row to `analytical_audit`:

```sql
CREATE TABLE analytical_audit (
    id              UUID PRIMARY KEY,
    conversation_id UUID NOT NULL,
    turn_id         UUID NOT NULL,
    user_question   TEXT NOT NULL,
    plan_json       JSONB NOT NULL,
    sql_text        TEXT NOT NULL,
    schema_hash     TEXT NOT NULL,
    lexicon_version TEXT NOT NULL,
    sandbox_result  TEXT NOT NULL,    -- 'ok' | 'rejected:<reason>' | 'timeout' | 'error:<class>'
    row_count       INTEGER,
    timing_ms       INTEGER,
    verifier_status TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This table is feedback for the lexicon team and for future model fine-tuning. Never delete.

---

## 9. Integration with the Multi-Turn Architecture

Anywhere `service-prompt.md` references "ops" or "modes", the new `analytical_query` slots in cleanly:

### 9.1 Classifier additions

Add `analytical_query` to the `mode` enum. Update the classifier's system prompt (after the existing rules):

```
analytical_query — choose this when the question is concrete, answerable from
the warehouse, and does not match any built-in recipe. The question must:
  • reference categories or entities resolvable via the lexicon (or directly
    via columns in the catalog),
  • use a computable metric (count, sum, average, list, top-N, comparison,
    percentile, year-over-year delta),
  • imply a single SQL query (≤ 1 query per turn).

Pick `analytical_query` over `clarify` when the question is unambiguous; pick
`clarify` only when the question's intent is genuinely unclear. Pick a
built-in recipe over `analytical_query` whenever a recipe is a reasonable
match — recipes are more thoroughly grounded.
```

The classifier emits a `recipe_run` operation with `recipe_id = '__analytical__'` (and optional `recipe_params` containing the user's pre-classified concept extraction if available).

### 9.2 Orchestrator dispatch

In the unified orchestrator loop (`service-prompt.md` §8), the `recipe_run` op kind dispatches to:

- `execute_recipe(...)` for non-analytical recipes (existing path).
- `AnalyticalAgent.run(...)` when `recipe_id == '__analytical__'`.

The result of `AnalyticalAgent.run` is shaped to fit `RecipeRun`. The `findings` array, `sql_log`, and `summary` slots are populated; the existing summarizer + verifier + memory pipeline runs over it without modification.

### 9.3 Refinement and composition over analytical runs

An analytical run is just another row in `recipe_runs`. The user can say "filter that to schools with funding > $1M" and the existing refinement engine (`service-prompt.md` §7) applies a standard `FilterOp` on the cached findings. No special case needed.

The user can compose: "Now compare those schools to the universities run from earlier" → the existing `CompareOp` works because both are recipe runs.

### 9.4 New SSE events (additive to `service-prompt.md` §4.3)

```
analytical_started           { question }
concept_extraction_started   {}
concept_extraction_completed { concepts: [{phrase, canonical_concept, confidence}] }
plan_generation_started      {}
plan_generation_completed    { template_id, primary_table, joins_count, filters_count, reasoning_one_line }
sql_compiled                 { sql_query_name, query_hash, length_chars }
sandbox_validation_started   {}
sandbox_validation_completed { ok: bool, reason: string | null }
sandbox_execution_started    {}
sandbox_execution_completed  { row_count, timing_ms, columns: [string] }
analytical_completed         { run_id, row_count, timing_ms }
```

Everything before `final_response` looks like a recipe run from the UI's point of view (the activity feed in `ui-prompt2.md` already renders `primitive_started`/`sql_query_*`); these new events let the UI render the analytical-specific phases (concept extraction, plan generation, sandbox validation) as their own steps.

UI handling of these events is part of `ui-prompt3.md`'s broader brief; this prompt only commits to emitting them.

---

## 10. Verifier Extensions

`verify.py` (already extended in `service-prompt.md` §7.5 for cross-run citations) gets one more responsibility for analytical runs.

Additional checks for `analytical_query` answers:

- **`generated_sql_safe`** — re-run the AST validator against the executed SQL; assert it still passes.
- **`concepts_resolved_match`** — every concept the answer mentions in prose was in the resolved list, AND every resolved concept has a row count > 0 OR is explicitly noted as "no matches" in the answer's caveats.
- **`numeric_claims_match_query_output`** — every numeric claim in the prose ("412 schools", "$1.2B in total") matches a value derivable from the executed query's rows. The verifier already does this for built-in recipes; the same logic applies, but now also checks the *query name* in citations resolves to the synthetic analytical query name.
- **`no_unrequested_aggregation`** — if the user asked for a count, the prose primarily reports a count; if they asked for a list, the prose primarily reports the list. This guards against the summarizer "improving" the answer by silently switching the metric.
- **`caveats_surface_lexicon_caveats`** — any caveats the lexicon attached to a resolved concept appear in `summary.caveats`. The verifier checks for at least one substring overlap; if a lexicon caveat is missing, it's added by the verifier itself (post-hoc) and a `verifier_check` of status `fail` is logged with `details` describing what was added.

If verification fails on an analytical answer, the answer ships with `verification.status='failed'` and the failures listed (existing pattern). The UI will render the warning prominently; the user has full visibility.

---

## 11. The Question-To-SQL Acceptance Test Suite

Add `services/ship/output/ship/tests/analytical_suite.py` with these scenarios. Each is a pair `(question, expected_assertions)`. Tests run against a seeded sample warehouse with known row counts.

| Question | Assertions |
|---|---|
| "How many schools received funding in 2024?" | mode=analytical_query, template_id=count_distinct, returns single integer ≥ 0, citations include `analytical_q_*`, caveats include lexicon caveat about French school boards. |
| "List universities with more than $10M in federal contracts." | template_id=top_n_with_filter, columns include `recipient` and a sum column, all rows have sum > 10000000, ≤ 1000 rows. |
| "Total funding to Indigenous organizations last year." | template_id=count_distinct or aggregate_by_group, single SUM row, caveats mention Indigenous-org coverage limitations. |
| "Top 20 cities by total federal contracts in 2023." | LIMIT=20, ORDER BY DESC, group_by includes a city column, year filter applied. |
| "How many distinct recipients received money from both ESDC and PHAC in 2023?" | template_id=intersection_across_filters, returns single integer, two department filters applied. |
| "Average contract value in Manitoba in FY2024." | AVG aggregation, province filter, fiscal_year filter, single number returned. |
| "Median grant size in Quebec in 2024." | PERCENTILE_CONT(0.5) used, single number returned. |
| "Predict next year's funding to schools." | mode=not_answerable with reason mentioning forecasting. |
| "Show me the deputy minister's email." | mode=not_answerable with reason mentioning PII / out-of-scope. |
| "Tell me about schools." (vague) | mode=clarify. |
| "How many schools and hospitals received funding in 2024?" | mode=analytical_query, two concept resolutions, plan likely UNION-style or two filters with `OR`, reasonable-row-count answer. |
| "Forget that, list all hospitals." (after a schools query) | mode=fresh (or `analytical_query` again), referenced_run_ids ignores prior schools run. |
| "Filter that to Alberta only." (after a schools query) | mode=refined, ops=[filter] using the existing refinement engine — no new SQL generated. |

Sandbox security tests (independent suite):

- Inject `; DROP TABLE federal_grants_recipient;` in a concept's predicate fragment via a maliciously crafted lexicon entry → AST validator rejects, audit log records the rejection. (Guards against lexicon-poisoning.)
- Plan that references a table not in the catalog → compiler rejects.
- Plan that references a `pii=true` column → compiler rejects.
- LLM-generated `EXECUTE` (somehow) → AST validator rejects.
- Query with no LIMIT → executor enforces 10000.
- 30-second statement → statement_timeout fires, sandbox returns timeout, summarizer told no rows.
- Concurrent 5 analytical turns → 5th queues; per-pool limit enforced.

Latency tests:

- Single `analytical_query` end-to-end p95 ≤ 8s on the sample warehouse.
- Concept-extraction LLM p95 ≤ 1.5s.
- Plan-generation LLM p95 ≤ 2.5s.
- Sandbox execution p95 ≤ 3s on sample data.

---

## 12. Failure Modes and Their UX

The agent must fail well. Map each failure to a clean response:

| Failure | Response mode | Caveats / message |
|---|---|---|
| Concept extraction returns no concepts and the question doesn't match a column directly. | `clarify` | "I'm not sure which datasets to use — could you tell me whether you mean federal grants, contracts, or charity returns?" |
| Concept extraction returns a concept not in the lexicon. | `analytical_query` w/ caveat | "I matched on the keyword '<phrase>' but don't have a curated definition for this category. Results may include false positives." |
| Plan generation returns `template_id=abstain`. | `not_answerable` | The plan's `reasoning` becomes the message. |
| Compiler rejects the plan. | `not_answerable` | "I tried to assemble a query but failed safety checks: <reason>." |
| Sandbox validation rejects the SQL. | `not_answerable` | "I tried to write a query but it didn't pass safety checks." (Detailed reason in audit log only.) |
| Sandbox execution times out. | `analytical_query` w/ failed verification | The answer says "the query took too long; here's the partial result" with empty findings and a clear caveat. |
| Execution returns 0 rows. | `analytical_query` w/ caveat | "No matching rows. This may mean (a) no <concept> received funding in <period>, (b) the lexicon for <concept> didn't match the way names are recorded — see caveats." Surface the resolved concept's exact predicate so the user can refine. |
| Verifier finds numeric claims not in the rows. | `analytical_query` w/ verification.failed | Summarizer is forced to retry once with the failures fed back; if still failing, ship with `verification.status='failed'` and a banner-eligible caveat. |

Never silently fall back to a built-in recipe with mismatched semantics. If the analytical path can't answer cleanly, say so.

---

## 13. Why Not Just "Let the LLM Write SQL"?

Because that is the worst pattern in this category, and it's worth being explicit about why we structured the agent the way we did.

- **Injection surface.** A naive "LLM → SQL → DB" pipe is one prompt injection away from `; DROP TABLE`. The plan-then-compile split eliminates this: the LLM never produces SQL bytes.
- **Schema drift.** When tables change, an LLM that learned old column names produces broken queries. The catalog is the single source of truth and the LLM only references columns the catalog enumerates.
- **Concept ambiguity.** Free-form LLM SQL would happily write `WHERE name LIKE '%school%'` and miss every "École" and "Conseil scolaire". The lexicon makes the predicate explicit, reviewable, versioned, and improvable.
- **Verifier coupling.** The verifier needs to know what the agent claimed it would do. A structured plan + structured concepts make this easy. Free-form SQL doesn't.
- **Cost and latency.** A constrained planner is much cheaper to call than a long SQL-writing LLM round-trip with retries.

Anyone proposing to "skip the plan and just have the LLM write SQL" should re-read this section.

---

## 14. File / Module Plan

New files:

- `services/ship/output/ship/analytical.py` — agent orchestration (concept extraction → resolution → plan → compile → sandbox → result).
- `services/ship/output/ship/schema_catalog.py` — load + validate + serve the catalog.
- `services/ship/output/ship/lexicon.py` — load + resolve concepts.
- `services/ship/output/ship/sql_sandbox.py` — AST validator + sandbox executor.
- `services/ship/output/ship/sql_compiler.py` — `QueryPlan` → SQL string compiler.
- `services/ship/output/ship/seed/catalog/*.yaml` — one file per allowed table.
- `services/ship/output/ship/seed/lexicon/*.yaml` — one file per concept (initial set §6.2).
- `services/ship/output/ship/tests/analytical_suite.py` — the test suite from §11.
- `services/ship/output/ship/tests/sandbox_security.py` — adversarial tests.

Edited files:

- `classifier.py` (from `service-prompt.md`) — add `analytical_query` to mode enum + system prompt.
- `orchestrator.py` — dispatch `recipe_id == '__analytical__'` to `AnalyticalAgent.run`. Emit new SSE events.
- `summarizer.py` — accept analytical run output (it's already a recipe-run-shape; no new logic needed beyond passing through).
- `verify.py` — add the four new checks from §10.
- `bootstrap_schema.py` — create the `analytical_audit` table and the `analytical_reader` Postgres role.
- `server.py` — `/catalog/datasets` and `/catalog/concepts` endpoints.

---

## 15. Acceptance Criteria

The redesign is done when **all** of the following are observable:

1. The question "How many schools received funding in 2024?" produces an `AnswerResponse` with `mode='fresh'`, exactly one operation `RecipeRunOp(recipe_id='__analytical__:count_distinct')`, a single integer `count` row, citations referencing the synthetic SQL query name, and at least one caveat from the schools lexicon.
2. The question "List universities with more than $10M in federal contracts" returns a `top_n_with_filter` template result with all rows satisfying the threshold and a recipient list capped at the LIMIT.
3. The classifier picks `analytical_query` over `clarify` for unambiguous concrete questions, and over a built-in recipe when no recipe scores above the confidence threshold. The decision is captured in `turn_classifier_decision` events with a one-line reasoning.
4. Lexicon-driven concept resolution produces deterministic SQL fragments. Adding a synonym to a lexicon YAML and reloading the service updates resolution without a redeploy.
5. The compiler refuses any plan referencing a table or column missing from the catalog, or any column flagged `pii=true`. Adversarial tests confirm.
6. The sandbox refuses any SQL containing DDL, DML, multi-statements, prohibited functions, or unbounded LIMIT. Adversarial tests confirm.
7. The sandbox enforces a 25s statement timeout and 10000-row cap; adversarial tests confirm.
8. Every analytical execution writes a row to `analytical_audit` with the question, plan, SQL, sandbox result, schema hash, and lexicon version.
9. An analytical run lands in `conversation_memory` and supports follow-up refinement / composition via the existing engine. "Filter that to Alberta only" after the schools query produces `mode='refined'` with no new SQL generated.
10. Verifier rejects an analytical answer whose numeric claims don't match the executed query's output; logs a `verifier_check` failure; the answer ships with `verification.status='failed'`.
11. Lexicon caveats automatically surface in the answer's `summary.caveats`. If the summarizer omits them, the verifier adds them post-hoc.
12. Vague analytical questions trigger `clarify`. Out-of-scope questions trigger `not_answerable`. Forecasting / opinion / PII questions trigger `not_answerable` with reasonable reasons.
13. New SSE events fire in the documented order (`analytical_started` → `concept_extraction_*` → `plan_generation_*` → `sql_compiled` → `sandbox_validation_*` → `sandbox_execution_*` → `analytical_completed` → existing `summarizer_*` / `verifier_*` → `final_response`).
14. `/catalog/datasets` and `/catalog/concepts` return the expected shapes; PII columns are stripped from `/catalog/datasets`.
15. End-to-end p95 latency for analytical_query ≤ 8s on the sample warehouse, with classifier alone ≤ 1.5s and sandbox execution ≤ 3s.
16. Backwards compatibility: clients without knowledge of `analytical_query` still parse the response (`mode` stays optional or defaults to `'fresh'`; `recipe_id = '__analytical__:…'` is a string the UI may not pretty-print but does not error on).

---

## 16. Non-Goals

- **No multi-query analytical turns yet.** A single `analytical_query` turn produces exactly one SQL query. Composition across multiple analytical results uses the existing composition engine (`CompareOp`, `JoinOp`, etc.).
- **No fine-tuning a SQL model.** Use whatever LLM provider the rest of the service already uses.
- **No new data sources.** No web scraping, no API joins, nothing outside the existing warehouse tables.
- **No write capability.** Read-only role, full stop.
- **No user-facing SQL editor.** Generated SQL is visible (the existing SQL drawer renders it) but users do not author or modify SQL.
- **No automatic lexicon expansion from chat traffic.** The audit log feeds a *human* review queue. We never let the LLM extend the lexicon at runtime.
- **No cross-conversation lexicons.** The lexicon is global; there is no per-conversation override.
- **No streaming row results.** Findings are returned as a single batch (matches existing recipe shape). Streaming row-by-row is out of scope.
- **No graph queries.** If a future question requires graph traversal (governance networks, multi-hop ownership), that's recipe territory — not analytical_query.

---

## 17. Deliverable

A coherent diff over `services/ship/output/ship/` that:

1. Lands the new modules in §14.
2. Ships an initial catalog covering every table currently used by the existing recipes, with column-level documentation and PII flags.
3. Ships the initial lexicon (§6.2) — minimum 14 concepts, hand-curated, reviewed.
4. Adds the `analytical_audit` table and read-only Postgres role via `bootstrap_schema.py`.
5. Wires `analytical_query` into the classifier and orchestrator.
6. Adds the four new verifier checks.
7. Includes the analytical and sandbox-security test suites and runs green.

Document the contract in a new `ANALYTICAL.md` under `services/ship/`. Cover:

- The plan-then-compile rationale.
- The lexicon authoring guide (with one fully-worked example).
- The catalog-authoring guide.
- How to add a new `QueryTemplate`.
- Operational notes: what happens on schema drift, lexicon-version mismatch, sandbox role grant errors.

Quality bar: a journalist can ask *"How many schools received funding in 2024?"* in the chat, the activity feed shows concept extraction → plan generation → sandbox validation → execution in real time, the answer cites the synthetic SQL query, the verifier confirms grounding, and the user can immediately follow up with *"Filter that to Alberta only"* and have it work via the existing refinement path. Three months from now, the lexicon team adds a new concept (e.g. *"social enterprises"*) by writing one YAML file, and the next question that uses it answers correctly without any code change. That's the bar.

Now build it.
