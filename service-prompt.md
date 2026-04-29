# Brief: Multi-Turn Iterative Investigation in the Analyst Service (backend)

## 0. What this is, in one sentence

The Accountability Analyst service today treats every user message as a single isolated query — it routes to one recipe, runs it, and returns one grounded answer. We need to upgrade it so that follow-up turns can **refine, combine, drill into, or comment on prior runs** — exactly the way ChatGPT, Grok, or Gemini handle iterative conversations — while preserving every guarantee around grounding, citations, and verification.

This is the **service** half of a two-part change. The companion brief `ui-prompt3.md` covers the matching frontend. Both share an exact wire contract — read §4 carefully and treat those types as frozen.

---

## 1. Your Role and Constraints

You are a senior backend engineer fluent in Python, FastAPI, asyncpg, PostgreSQL, and modern LLM agent design (Pydantic-AI is already in the stack).

The codebase lives at `services/ship/output/ship/`. Existing modules and their roles:

| File | Lines | Role |
|---|---|---|
| `server.py` | 184 | FastAPI endpoints. Conversations, messages (sync + SSE stream), recipe runs, catalog, healthz. |
| `orchestrator.py` | 790 | The turn engine. Already split into `_handle_execute` (fresh recipe) and `_handle_refine` (in-memory refinement on the latest run). Owns SSE event emission. |
| `router.py` | 91 | Pydantic-AI `Agent` that classifies a turn into a `RouterDecision` (recipe pick / clarify / new_conversation) with strict-model output. |
| `refine.py` | 162 | Regex-based refinement detection: `filter`, `sort`, `detail` operations on the latest run's findings. |
| `summarizer.py` | 169 | Builds the grounded answer (paragraphs, citations, caveats) from findings. |
| `verify.py` | 361 | Grounding checks across the summary, findings, and SQL log. |
| `recipes/*.py` | ~12 files | One module per recipe; each defines params, SQL queries, primitive composition, and a row schema. |
| `primitives/*.py` | many | Shared building blocks (e.g. `discover_entities`, `trend`, `governance_overlap`). |
| `runtime_config.py` | 74 | Config plumbing. |
| `bootstrap_schema.py` | 57 | DB schema bootstrap. |

The existing `_handle_refine` path proves the architectural ambition exists. It operates on the most recent run's cached findings via `infer_refinement_filter` (regex) + `apply_refinement`. We're going to replace that narrow regex pipeline with a proper LLM-driven turn classifier, extend the operation set, expose multiple prior runs as addressable memory, and add multi-run composition + conversational modes.

Hard constraints:

- **Wire compatibility.** `AnswerResponse`, `ClarificationResponse`, `NeedsNewConversationResponse`, `NotAnswerableResponse` shapes stay parseable by older clients. New fields are added with defaults so the existing UI keeps working. The new mode-aware UI will key off the new fields.
- **Streaming protocol.** SSE remains. New event names listed in §5 are additive. Existing event names and their `data` shapes are frozen.
- **No external services without approval.** The LLM provider already in use (Pydantic-AI) is the only LLM dependency. Refinement compute happens in-process — DuckDB-in-memory is acceptable; pulling in Spark or a separate query engine is not.
- **Postgres remains the primary store.** Conversation memory persists in the same DB as messages and recipe_runs.
- **Latency budget.** A pure refinement turn (no new SQL) must complete in ≤ 3s p95. A conversational turn in ≤ 2s. A multi-run composition that needs one new recipe run in ≤ 12s p95. Heartbeats every 5s while a turn is active.
- **Determinism.** Pure refinement operations (filter, project, sort, slice, aggregate) on the same source run with the same params must produce identical output. Cache by `(source_run_id, op_hash)`.

---

## 2. The Problem in Concrete Examples

Today's behavior:

```
> "Show me Alberta sole-source contracts over $250K from FY2023."
[OK — runs the sole_source_amendment recipe with province=AB, fy=2023, min_value=250000 → 412 findings]

> "Filter that to procurement code 1234."
[Today: regex picks up "filter" + "code 1234" only if it matches a hand-crafted pattern; otherwise falls through to the router which may or may not produce a meaningful response]
```

What we want:

| User message | Expected mode | Operations | New SQL? |
|---|---|---|---|
| "Show me AB sole-source contracts over $250K, FY2023." | `fresh` | `[recipe_run]` | yes |
| "Filter that to procurement code 1234." | `refined` | `[filter]` on latest run | no |
| "Sort by amended value descending." | `refined` | `[sort]` | no |
| "Top 5 only." | `refined` | `[slice]` | no |
| "Group by department." | `refined` | `[aggregate]` | no |
| "Same query for Saskatchewan." | `fresh` | `[recipe_run]` (same recipe, new params) | yes |
| "What about FY2024?" (with FY2023 in memory) | `fresh` then `[compare]`? Or `composed`? | `[recipe_run, compare]` | yes |
| "Compare FY2023 to FY2024." | `composed` | `[compare]` | no (both runs already exist) |
| "Add adverse media for those recipients." | `composed` | `[recipe_run(adverse_media), join]` | yes (one new run) |
| "Drill into row 5." | `refined` then commentary | `[slice or filter, commentary]` | no |
| "Why is row 12's HHI high?" | `conversational` | `[commentary]` | no |
| "Forget that, start over with charity zombies." | `fresh` | `[recipe_run]` (new conversation hint optional) | yes |
| "Combine the loops we found earlier with the AB sole-source list." | `composed` | `[join]` across two memory runs | no |
| "Show me only rows where amount > $1M." | `refined` | `[filter]` | no |
| "Roll back to before the filter." | `refined` | `[commentary]` (sets a baseline pointer) | no |

The classifier must reliably pick the right path — and refuse to invent.

---

## 3. Target Architecture

A user message now flows through six stages instead of three:

```
inbound message
    │
    ▼
[1] Turn Classifier  ──►  decision: fresh | refined | composed | conversational | clarify | new_conversation | not_answerable
    │
    ▼
[2] Memory Recall   ──►  pulls referenced runs into a working set
    │
    ▼
[3] Plan            ──►  ordered list of Operations to execute
    │
    ▼
[4] Execute         ──►  runs each operation in order:
                          • recipe_run  → existing recipe pipeline
                          • filter/proj/sort/slice/aggregate  → DuckDB-in-memory over cached rows
                          • join/union/intersect/compare      → DuckDB across multiple runs
                          • commentary                         → no execution; passes through
    │
    ▼
[5] Synthesize      ──►  summarizer over the produced row set + memory context, citing across runs
    │
    ▼
[6] Verify          ──►  ground-checks every claim, including cross-run citations and diff numbers
    │
    ▼
final_response
```

Stages [1]–[3] are fast (LLM-only, no DB). Stage [4] is where compute happens. Stages [5]–[6] mirror today's path but get extra inputs.

The turn classifier replaces the regex inference in `refine.py` and absorbs the routing logic from `router.py` for refinement-eligible turns. The existing recipe-pick router becomes a sub-step invoked only when stage [1] returns `fresh`, `composed`, or refusal modes that need a recipe.

---

## 4. The Wire Contract (frozen — must match `ui-prompt3.md`)

### 4.1 New / extended Pydantic models

In `orchestrator.py` (or a new `responses.py` module if you want to reduce file size):

```python
from typing import Literal
from pydantic import BaseModel

class AnswerResponse(StrictModel):
    type: Literal["answer"] = "answer"
    message_id: str
    mode: Literal["fresh", "refined", "composed", "conversational"]
    recipe_run_id: str | None  # NEW: nullable in conversational mode
    based_on_run_id: str | None  # KEEP: most recent single source run, if any
    source_run_ids: list[str] = []  # NEW: every prior run referenced
    operations: list[Operation] = []  # NEW: ordered ops applied this turn
    diff: AnswerDiff | None = None  # NEW: vs the most recent prior run if meaningful
    summary: Summary
    findings_preview: list[dict]
    verification: Verification
    latency_ms: int

# Discriminated union over the operation kinds.
class RecipeRunOp(StrictModel):
    kind: Literal["recipe_run"] = "recipe_run"
    recipe_id: str
    run_id: str
    description: str
    row_count: int
    timing_ms: int

class FilterOp(StrictModel):
    kind: Literal["filter"] = "filter"
    source_run_id: str
    description: str
    before_count: int
    after_count: int
    predicate: str  # human-readable, e.g. "amount >= 1000000"

class ProjectOp(StrictModel):
    kind: Literal["project"] = "project"
    source_run_id: str
    description: str
    columns: list[str]

class SortOp(StrictModel):
    kind: Literal["sort"] = "sort"
    source_run_id: str
    description: str
    sort_by: list[SortKey]

class SortKey(StrictModel):
    column: str
    dir: Literal["asc", "desc"]

class SliceOp(StrictModel):
    kind: Literal["slice"] = "slice"
    source_run_id: str
    description: str
    offset: int = 0
    limit: int

class AggregateOp(StrictModel):
    kind: Literal["aggregate"] = "aggregate"
    source_run_id: str
    description: str
    group_by: list[str]
    aggregations: list[Aggregation]

class Aggregation(StrictModel):
    column: str
    fn: Literal["sum", "avg", "count", "min", "max", "median", "p95"]
    alias: str

class JoinOp(StrictModel):
    kind: Literal["join"] = "join"
    left_run_id: str
    right_run_id: str
    description: str
    keys: list[str]
    how: Literal["inner", "left", "outer"]

class UnionOp(StrictModel):
    kind: Literal["union"] = "union"
    source_run_ids: list[str]
    description: str

class IntersectOp(StrictModel):
    kind: Literal["intersect"] = "intersect"
    source_run_ids: list[str]
    description: str

class CompareOp(StrictModel):
    kind: Literal["compare"] = "compare"
    baseline_run_id: str
    comparison_run_id: str
    description: str

class CommentaryOp(StrictModel):
    kind: Literal["commentary"] = "commentary"
    source_run_ids: list[str]
    description: str

Operation = (
    RecipeRunOp | FilterOp | ProjectOp | SortOp | SliceOp | AggregateOp
    | JoinOp | UnionOp | IntersectOp | CompareOp | CommentaryOp
)

class AnswerDiff(StrictModel):
    baseline_run_id: str
    rows_added: int
    rows_removed: int
    rows_changed: int
    columns_added: list[str]
    columns_removed: list[str]

# Citation gains an optional run id.
class Citation(StrictModel):
    finding_index: int | None
    sql_query_name: str | None
    url: str | None
    source_run_id: str | None  # NEW
```

### 4.2 New endpoints (FastAPI)

In `server.py`:

```python
@app.post("/conversations/{conversation_id}/runs/{run_id}/pin")
async def pin_run(conversation_id: UUID, run_id: UUID) -> dict: ...

@app.post("/conversations/{conversation_id}/runs/{run_id}/unpin")
async def unpin_run(conversation_id: UUID, run_id: UUID) -> dict: ...

@app.post("/conversations/{conversation_id}/runs/{run_id}/forget")
async def forget_run(conversation_id: UUID, run_id: UUID) -> dict: ...
```

These flip flags in the memory table (§6.1). Forgetting a run does not delete the row; it sets `forgotten=true` and removes the run from LLM-context construction.

The conversation GET response gains a `memory` field:

```python
class MemoryEntry(StrictModel):
    run_id: str
    recipe_id: str | None  # null for derived (refinement) runs
    derived_from_run_id: str | None
    description: str
    params_summary: str
    row_count: int
    created_at: datetime
    pinned: bool
    forgotten: bool

# In the existing conversation payload:
class Conversation(StrictModel):
    conversation_id: str
    title: str | None
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    messages: list[Message]
    recipe_runs: list[ConversationRecipeRun]
    memory: list[MemoryEntry]  # NEW
```

### 4.3 New SSE events

Emit through the existing `Event` envelope. Add to the SSE event union:

```
turn_classifier_started     {}
turn_classifier_decision    { mode, reasoning_one_line, referenced_run_ids: [run_id...] }
memory_recall               { run_ids: [run_id...], reason }
refinement_started          { kind, source_run_id, description }
refinement_completed        { kind, source_run_id, before_count, after_count, timing_ms }
composition_started         { kind: 'join'|'union'|'intersect'|'compare', source_run_ids, description }
composition_completed       { kind, source_run_ids, output_count, timing_ms }
diff_computed               { baseline_run_id, rows_added, rows_removed, rows_changed, columns_added, columns_removed }
```

The existing `refinement_filter_applied` event remains for backwards compatibility but is deprecated in favor of `refinement_started` + `refinement_completed`. New code should not emit `refinement_filter_applied`.

---

## 5. The Turn Classifier (replacing `refine.py`'s heuristic + extending `router.py`)

Move turn classification out of regex into an LLM-backed decision step. Add a new module `services/ship/output/ship/classifier.py`.

### 5.1 Classifier output

```python
class TurnClassification(StrictModel):
    mode: Literal[
        "fresh", "refined", "composed", "conversational",
        "clarify", "new_conversation", "not_answerable",
    ]
    reasoning_one_line: str
    # Plan
    operations: list[PlannedOperation]
    referenced_run_ids: list[str]  # the runs whose data the plan reads
    # When clarify / new_conversation / not_answerable:
    clarification: ClarificationPayload | None = None
    new_conversation: NewConversationHint | None = None
    not_answerable_reason: str | None = None

class PlannedOperation(StrictModel):
    kind: Literal[
        "recipe_run", "filter", "project", "sort", "slice",
        "aggregate", "join", "union", "intersect", "compare", "commentary",
    ]
    # For recipe_run:
    recipe_id: str | None = None
    recipe_params: dict | None = None
    # For ops that read prior runs:
    source_run_id: str | None = None
    source_run_ids: list[str] = []
    left_run_id: str | None = None
    right_run_id: str | None = None
    baseline_run_id: str | None = None
    comparison_run_id: str | None = None
    # Op-specific params:
    predicate: str | None = None  # human-readable; the executor parses it
    columns: list[str] | None = None
    sort_by: list[SortKey] | None = None
    offset: int | None = None
    limit: int | None = None
    group_by: list[str] | None = None
    aggregations: list[Aggregation] | None = None
    keys: list[str] | None = None
    how: Literal["inner", "left", "outer"] | None = None
    description: str  # always required
```

### 5.2 Classifier prompt skeleton

System prompt (full text, used verbatim — tune wording if needed but keep semantics):

```
You are the Turn Classifier for a Canadian public-money accountability analyst.
You read the user's latest message AND a compact summary of the conversation
memory (prior recipe runs and their findings), and you produce a structured plan
for how to answer this turn.

You MUST emit a TurnClassification with:
  - mode: one of {fresh, refined, composed, conversational, clarify,
                  new_conversation, not_answerable}
  - reasoning_one_line: ≤ 140 chars, plain English, why you picked this mode
  - referenced_run_ids: the run_ids your plan reads from (empty for fresh/clarify/etc.)
  - operations: the ordered ops you will run
  - clarification, new_conversation, or not_answerable_reason: when applicable

Mode definitions:
  fresh           — user asked something that requires running a recipe from scratch.
                    The conversation memory does not already contain the data needed.
  refined         — user wants to reshape exactly one prior run (filter/sort/slice/
                    aggregate/project/commentary on a single source). No new SQL.
  composed        — user wants to combine MULTIPLE prior runs (join/union/intersect/
                    compare). May include exactly one new recipe_run if a needed
                    dataset isn't yet in memory.
  conversational  — user wants commentary on prior runs without re-querying. No new SQL,
                    no row reshaping. Ops will be exactly one [commentary] entry.
  clarify         — the question is too vague or under-specified. Provide a clarification.
  new_conversation — the question is sharply off-topic from the current thread.
                     Recommend opening a new conversation.
  not_answerable  — the question cannot be answered with our datasets and recipes.

Hard rules:
  • Never invent run_ids. Only reference run_ids that appear in the memory summary.
  • If the user uses pronouns ("that", "those", "the top 5"), resolve them to the
    most recent eligible run in memory unless they explicitly reference earlier ones.
  • Prefer `refined` over `fresh` when the data is already in memory and no
    new dataset is needed.
  • Choose `composed` when more than one source run is needed.
  • Choose `conversational` when the user asks "why", "explain", "how", "summarize"
    about existing data, with no new filtering or row selection.
  • If the user types something like "compare X to Y" and only one of X, Y is in
    memory, plan a recipe_run for the missing one followed by a compare op
    (mode = composed).
  • Predicates in filter ops must be expressible against the source run's columns
    (you'll see the column list in the memory summary). If a predicate uses a column
    not in the source, switch mode to `fresh`.
  • Limit operations to ≤ 5 per turn.
  • Slice ops: limit ≤ 1000.

Output strict JSON matching the TurnClassification schema. Do not output prose.
```

### 5.3 Classifier inputs (the memory summary)

Build a compact context object before calling the classifier:

```python
def build_memory_summary(conversation: Conversation) -> dict:
    """Return a list of memory entries as the LLM sees them.

    For each non-forgotten run, include:
      - run_id (UUID string)
      - recipe_id (or null for derived)
      - derived_from_run_id
      - description (humanized, ≤ 80 chars)
      - params_summary
      - row_count
      - column list (top 30 columns)
      - sample 3 rows (compact, with values truncated to 60 chars)
      - pinned (bool)
    """
```

The classifier sees this as compact JSON. Pinned and recent runs go first; forgotten runs are excluded; cap at 12 runs per call (most recent + all pinned).

### 5.4 Existing `router.py` becomes a `recipe_picker.py`

When the classifier picks `mode='fresh'` (or `'composed'` with a needed `recipe_run`), the orchestrator delegates to the existing `router.py` agent for the actual recipe pick, with `recipe_params` pre-filled from the classifier where possible. If the classifier supplied a `recipe_id` and `recipe_params` directly, skip the recipe picker.

---

## 6. Conversation Memory

### 6.1 DB schema additions

Add a new table `conversation_memory` (or extend the existing recipe_runs table with conversation-membership and pinned/forgotten flags):

```sql
-- New table
CREATE TABLE conversation_memory (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    run_id          UUID NOT NULL REFERENCES recipe_runs(id) ON DELETE CASCADE,
    pinned          BOOLEAN NOT NULL DEFAULT false,
    forgotten       BOOLEAN NOT NULL DEFAULT false,
    description     TEXT NOT NULL,           -- short human label
    params_summary  TEXT NOT NULL DEFAULT '',
    derived_from_run_id UUID REFERENCES recipe_runs(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, run_id)
);
CREATE INDEX conversation_memory_conv_recent ON conversation_memory (conversation_id, created_at DESC);
```

Add this migration via `bootstrap_schema.py`.

`recipe_runs` may need a column to mark "derived" runs (refinements have a recipe_id of NULL or a synthetic value `__derived__:<op_kind>`). Prefer a new column `is_derived BOOLEAN NOT NULL DEFAULT false` with `derived_op JSONB NULL` so derived runs persist their operation provenance.

### 6.2 Memory entry creation

Whenever a turn produces a run (fresh recipe OR derived refinement), insert a `conversation_memory` row tying it to the conversation. Set `pinned=false` and `forgotten=false` by default. Compute `description` (e.g. "AB sole-source ≥$250K, FY2023, 412 rows") with a small helper that reads recipe params + row count.

### 6.3 Eviction policy

A configurable cap (default 20) of *non-forgotten, non-pinned* runs per conversation. When a new run lands and the cap is exceeded, mark the oldest non-pinned non-forgotten run as `forgotten=true`. Never delete row data from `recipe_runs` — eviction is purely about LLM-context inclusion.

Pin / forget are explicit user actions:
- `POST /pin` sets `pinned=true`. Pinned runs are always included in the memory summary (subject to a per-conversation max of 8 pins to keep prompts bounded).
- `POST /unpin` sets `pinned=false`.
- `POST /forget` sets `forgotten=true`. Forgotten runs are excluded from memory summary.
- A `POST /pin` on a forgotten run also sets `forgotten=false` (re-attaches).

### 6.4 Memory summary builder

Implement `build_memory_summary(pool, conversation_id)` to return up to:
- All pinned, non-forgotten runs (capped at 8).
- Most recent N runs (configurable; default 8) that are non-forgotten and not already in the pinned set.
- Total cap 12. If the user references a run not in this set via @-mention id, fetch it ad-hoc and include.

For each entry, include the columns described in §5.3. Implement `_compact_findings(rows, k=3)` that picks 3 representative rows (pick the first row with the highest amount column if any, then 2 random others) and truncates each cell value to 60 chars.

### 6.5 Run descriptions

Add a `_humanize_run` helper:

```python
def humanize_run(recipe_id: str | None, params: dict, row_count: int) -> str:
    """Produce a short human label like 'AB sole-source ≥$250K, FY2023 · 412 rows'."""
```

Special-case each of the 10+ recipes — each `recipes/*.py` should expose a `def humanize(params: dict) -> str` function. Default implementation reads recipe description and lists the 2 most distinctive params.

---

## 7. The Refinement Engine

### 7.1 Replace `refine.py`'s body

Keep the file but replace its API:

```python
# refine.py

from typing import Any
import duckdb

class Refiner:
    """Executes Operation plans against cached findings using DuckDB in-memory."""

    def __init__(self, registry: "RunRegistry") -> None:
        self.registry = registry

    async def execute(self, op: Operation) -> RefinementResult: ...
```

`RunRegistry` is a thin adapter that loads a run's findings from `recipe_runs.findings` JSONB into a Pandas DataFrame (or directly into a DuckDB table). Cache decoded DataFrames per process — keyed by `run_id`.

Each operation translates to DuckDB SQL:

| Op | DuckDB strategy |
|---|---|
| `filter` | `SELECT * FROM run_{id} WHERE <predicate>` — predicate parsed from the LLM's natural-language string into a safe SQL fragment via a small expression parser; refuse arbitrary SQL. |
| `project` | `SELECT col1, col2 FROM run_{id}` |
| `sort` | `... ORDER BY col DESC, col2 ASC` |
| `slice` | `... LIMIT n OFFSET k` |
| `aggregate` | `SELECT group_by..., SUM(col) AS alias FROM run_{id} GROUP BY group_by` |
| `join` | `SELECT * FROM run_{a} a JOIN run_{b} b ON a.k = b.k` (driven by `keys` and `how`) |
| `union` | `SELECT * FROM run_a UNION SELECT * FROM run_b` (column-aligned) |
| `intersect` | `... INTERSECT ...` |
| `compare` | Special: produces a synthetic result with `_status` column ∈ {added, removed, changed, same} aligning rows by a stable key. |
| `commentary` | No-op in the engine — passes through to the summarizer with the named source runs. |

### 7.2 Predicate parsing

The classifier emits filter predicates as natural-language strings ("amount >= 1000000", "fiscal_year = 2024", "province in ('AB','SK')"). Implement a strict parser that:

- Tokenizes against a known column list for the source run.
- Allows operators: `=`, `!=`, `<`, `<=`, `>`, `>=`, `IS NULL`, `IS NOT NULL`, `IN`, `NOT IN`, `LIKE`, `BETWEEN`.
- Allows logical: `AND`, `OR`, `NOT`, parentheses.
- Refuses: subqueries, column references on the right of operators that aren't in the same row, `;`, comments, function calls except the safelisted (`LOWER`, `UPPER`, `LENGTH`, `ABS`, `COALESCE`, `EXTRACT`, `DATE_TRUNC`).
- Normalizes column names case-insensitively against the run's actual schema.

If parsing fails, the engine emits `refinement_completed` with the failure reason as a caveat and **falls back to passing the source run unchanged** with a verifier-readable note. The summarizer is then told "the requested filter could not be applied."

### 7.3 Cached operation results

Each derived run is persisted as a new row in `recipe_runs` with `is_derived=true`, the `derived_op` JSONB describing the operation, and the new findings/sql_log/etc. Include a stable hash:

```python
op_hash = sha256(json.dumps({
    "kind": op.kind,
    "source_run_ids": [...],
    # op-specific params
}, sort_keys=True)).hexdigest()[:16]
```

Before executing a derived op, look for an existing run with matching `op_hash` and `source_run_ids` — if present, reuse it (still emit `refinement_started/completed` events with the cached row counts and timing_ms=0).

### 7.4 Diff computation

When the orchestrator emits a turn whose `mode` is `refined`, `composed`, or `conversational` and the working set differs from the most recent prior run, compute an `AnswerDiff`:

- Pick a stable key per row (heuristic order: `entity_norm`, `business_number`, `recipient_id`, fall back to a deterministic hash of the row's values).
- `rows_added` = current keys − baseline keys.
- `rows_removed` = baseline keys − current keys.
- `rows_changed` = rows whose key is in both but whose non-id columns differ.
- `columns_added` / `columns_removed` = symmetric difference of column sets.

Emit `diff_computed` with the result; attach `diff` to the AnswerResponse. If the working set is identical (e.g. `sort` with no value change), emit `diff` with all zeros and let the UI render "Same row set, reshaped".

### 7.5 Verifier extensions

`verify.py` today checks paragraph claims against the single run's findings. Extend it:

- Accept a list of source runs with their findings, not just one.
- Check that every cited `finding_index` is valid for the run identified by the citation's `source_run_id` (defaulting to the primary run when null).
- Check that every numeric claim ("$412M", "23 rows", "the top 5") matches a value computable from one of the cited runs.
- For a `compare` op, verify that any "X grew from Y to Z" or "X dropped" claim has Y and Z findable in the named baseline / comparison runs respectively.
- Add a new check `cross_run_citations_consistent` to the verification.checks dict: count of cross-run citations whose `source_run_id` is in `source_run_ids`.
- For `conversational` mode, every claim must cite at least one prior run by index, query name, or URL — no uncited claims allowed.

If verification fails, the answer still ships but with the failure surfaced in `verification.failures` (existing pattern).

---

## 8. Orchestrator Changes (`orchestrator.py`)

The high-level shape becomes:

```python
async def stream_user_message(...):
    yield Event("turn_classifier_started", {})
    plan = await classify_turn(message, memory_summary, conversation_topic)
    yield Event("turn_classifier_decision", {
        "mode": plan.mode,
        "reasoning_one_line": plan.reasoning_one_line,
        "referenced_run_ids": plan.referenced_run_ids,
    })

    if plan.mode == "clarify":
        return await handle_clarification(...)
    if plan.mode == "new_conversation":
        return await handle_new_conversation_hint(...)
    if plan.mode == "not_answerable":
        return await handle_not_answerable(...)

    if plan.referenced_run_ids:
        yield Event("memory_recall", {
            "run_ids": plan.referenced_run_ids,
            "reason": derive_reason(plan),
        })
        # Hydrate the referenced runs (load findings from DB into the Refiner).

    operations_executed: list[Operation] = []
    primary_run_id: str | None = None

    for planned_op in plan.operations:
        if planned_op.kind == "recipe_run":
            # Stream existing primitive_started/completed/sql_query_* events.
            run = await execute_recipe(...)
            primary_run_id = run.run_id
            operations_executed.append(RecipeRunOp(...))
        elif planned_op.kind in REFINEMENT_KINDS:
            yield Event("refinement_started", {...})
            result = await refiner.execute(planned_op)
            yield Event("refinement_completed", {...})
            primary_run_id = result.run_id
            operations_executed.append(result.op_record)
        elif planned_op.kind in COMPOSITION_KINDS:
            yield Event("composition_started", {...})
            result = await refiner.execute(planned_op)
            yield Event("composition_completed", {...})
            primary_run_id = result.run_id
            operations_executed.append(result.op_record)
        elif planned_op.kind == "commentary":
            operations_executed.append(CommentaryOp(...))
            # No execution; primary_run_id may stay None.

    final_findings = current_working_set(operations_executed)
    diff = compute_diff(final_findings, baseline=most_recent_prior(plan)) if applicable else None
    if diff:
        yield Event("diff_computed", diff.dict())

    yield Event("summarizer_started", {...})
    summary = await summarize(
        question=message,
        operations=operations_executed,
        runs_referenced=plan.referenced_run_ids,
        working_set=final_findings,
        diff=diff,
    )
    # ... existing summarizer_token + summarizer_completed events ...

    yield Event("verifier_started", {})
    verification = await verify(summary, runs_in_context, working_set)
    yield Event("verifier_completed", verification.dict())

    response = AnswerResponse(
        type="answer",
        message_id=message_id,
        mode=plan.mode,
        recipe_run_id=primary_run_id,  # may be None
        based_on_run_id=most_recent_prior(plan),
        source_run_ids=plan.referenced_run_ids,
        operations=operations_executed,
        diff=diff,
        summary=summary,
        findings_preview=preview(final_findings, 25),
        verification=verification,
        latency_ms=...,
    )
    yield Event("final_response", response.dict())
```

Replace the existing `_handle_execute` / `_handle_refine` split with this unified loop. The recipe-execution code stays inside `execute_recipe`; the refinement/composition code stays inside `Refiner.execute`. The orchestrator's job is to drive them.

---

## 9. Summarizer Changes (`summarizer.py`)

Today the summarizer takes a single recipe run's findings and emits a Summary. Now it must:

- Accept multiple source runs as part of the prompt context.
- Be told, explicitly, what operations were applied this turn (the exact list of `Operation` objects).
- Be told the diff if one was computed.
- Emit citations whose `source_run_id` is set whenever the cited finding lives in a prior run, not the primary run of this turn.
- For `conversational` mode, accept zero new findings; cite only into prior runs.

Add a new prompt section to the summarizer system prompt:

```
You may be summarizing across MULTIPLE recipe runs. Each finding you cite must
include source_run_id pointing at the run that produced it. Use the most recent
run's findings as the primary subject unless the user explicitly asked about
earlier runs.

When summarizing a refinement (filter/sort/slice/aggregate), explicitly name what
changed from the baseline (e.g. "filtered to 38 rows where amount > $1M, down
from 412") and cite the affected rows.

When summarizing a comparison, lead with the magnitude of the difference, not
the row counts.

When the mode is conversational, cite at least one finding for every numeric or
named claim. You may not introduce new numbers that aren't in any prior run.
```

The token budget for the summarizer: cap memory context at ~20K tokens. If the combined source-run findings exceed that, sample down to top-K rows by some heuristic (largest amount column, or most recent date) and tell the summarizer the remaining rows are not visible in this turn — the summarizer may not make claims about unseen rows.

---

## 10. Routing Adjustments

`router.py` handles "which recipe to run" only. Move the macro decision (refine vs new vs conversational) to the classifier. The classifier may delegate recipe-pick decisions to `router.py` by leaving `recipe_id` null in a planned `recipe_run` op — when the orchestrator sees a null recipe_id, it calls `router.py` to fill it in.

---

## 11. Backwards Compatibility

- Existing clients that submit a message and expect today's `AnswerResponse` continue to receive a parseable response. New fields default safely:
  - `mode` defaults to `"fresh"` for clients pre-deploy data.
  - `source_run_ids = []`, `operations = []`, `diff = None` are valid defaults.
  - `recipe_run_id` may be null only for new clients that handle conversational mode. Old clients will error if recipe_run_id becomes null. Mitigation: in `conversational` mode, set `recipe_run_id` to the most recent prior run (the primary referenced run). The UI sees `mode='conversational'` and treats it as commentary; old UI sees a normal answer with the prior run's id and renders something sensible.
- The `refinement_filter_applied` event continues to be emitted alongside `refinement_started/completed` for the first 90 days post-deploy, then removed. Add a feature flag `ANALYST_LEGACY_REFINEMENT_EVENT=true|false`.
- The `Citation` schema change (adding `source_run_id`) is a strict additive — old clients that ignore unknown fields keep working.
- Existing recipe code is untouched. Only the orchestrator, summarizer, verifier, refine module, and a new classifier module change.

---

## 12. Latency, Caching, and Cost

### 12.1 Token budget per classifier call

- Memory summary: ~3K tokens cap (12 entries × ~250 tokens each).
- User message: ~1K tokens cap.
- System prompt: ~1.2K tokens.
- Output schema: ~400 tokens.
- Total ~5.6K tokens. Acceptable on cost; well under any LLM context window.

### 12.2 Caching

- Classifier cache: hash of `(conversation memory summary digest, user message)` → classification. TTL 1h. Invalidate on memory mutation. Don't cache `clarify`/`new_conversation` decisions (they're context-sensitive).
- Refinement cache: see §7.3 — `op_hash` keyed.
- Recipe run cache: existing behavior, untouched.

### 12.3 Heartbeats

Existing `heartbeat` events fire every 5s. Keep that. Also fire one immediately after a long-running stage transitions.

### 12.4 Latency targets

- `conversational` (no SQL, no refinement): ≤ 2s p95.
- `refined` (single op on cached): ≤ 3s p95.
- `composed` with no new recipe: ≤ 5s p95.
- `composed` with one new recipe: ≤ 12s p95.
- `fresh`: existing budgets, untouched.

---

## 13. Testing Scenarios

Add to `services/ship/output/ship/tests/`:

### 13.1 Unit / classifier tests

- "Filter that to 2024" → `refined`, ops=[filter], referenced_run_ids=[latest].
- "Sort by amount" → `refined`, ops=[sort].
- "Top 5 only" → `refined`, ops=[slice].
- "Group by department" → `refined`, ops=[aggregate].
- "What about FY2024?" with FY2023 in memory → `fresh` with same recipe + new fy param, OR `composed` with [recipe_run, compare] (LLM may pick either; both are acceptable — assert on referenced_run_ids and mode).
- "Compare FY2023 to FY2024" with both in memory → `composed`, ops=[compare].
- "Add adverse media for those" → `composed`, ops=[recipe_run(adverse_media), join].
- "Why is row 12's HHI so high?" → `conversational`, ops=[commentary], referenced_run_ids=[latest].
- "Forget that, start over with charity zombies" → `fresh`.
- "Combine the loops we found earlier with the AB sole-source list" → `composed`, ops=[join] with two referenced run ids.
- "Show me only rows where amount > $1M" → `refined`, ops=[filter] with predicate "amount >= 1000000".
- Off-topic ("What's the weather?") → `not_answerable`.
- Vague ("Tell me about contracts") → `clarify`.

### 13.2 Refinement engine tests

- Apply filter on a run with 412 rows → expected row count and predicate stored.
- Apply sort then slice → output is the top-K by sort key.
- Apply aggregate (group_by entity, sum amount) → one row per entity.
- Apply join (entity_name) across two runs → rows with the join semantics.
- Apply union with mismatched columns → fail with helpful caveat.
- Apply compare → output has `_status` column with correct add/remove/change classification.
- Apply commentary → no execution, summarizer receives both source runs.

### 13.3 Memory tests

- Pin a run → it's included in next memory summary even after 20 newer runs.
- Forget a run → it's excluded from next memory summary.
- Re-pin a forgotten run → it's re-included.
- Eviction: 21 unpinned runs → oldest is forgotten, others remain.
- Pin cap: 9th pin attempt fails with a clear error.

### 13.4 End-to-end SSE tests

- Full flow for a refined turn: classifier → memory_recall → refinement_* → summarizer → verifier → final_response. Assert event order and payloads.
- Aborted mid-stream (client closes): classifier completes, refinement aborts cleanly, no orphan rows.

### 13.5 Verifier tests

- Cross-run citation: claim cites a finding in Run #3 while the primary run is Run #5; verifier resolves Run #3 via `source_run_id`.
- Numeric claim about a diff: "added 8 rows" → verifier computes the same number from the live diff.
- Conversational answer with uncited claim → verifier fails with a clear failure entry.

### 13.6 Latency tests

- Classifier alone: ≤ 1.5s p95 over 100 runs.
- Refined turn end-to-end: ≤ 3s p95.

---

## 14. File / Module Plan

New files:
- `services/ship/output/ship/classifier.py` — the LLM Turn Classifier agent.
- `services/ship/output/ship/responses.py` — extracted Pydantic response models (optional; reduces orchestrator size).
- `services/ship/output/ship/memory.py` — memory summary builder, eviction, pin/unpin/forget DB ops.
- `services/ship/output/ship/predicate_parser.py` — filter predicate parser (§7.2).
- `services/ship/output/ship/diff.py` — `compute_diff(current, baseline)`.

Renamed/expanded:
- `refine.py` → keep filename, rewrite as `Refiner` class with the full op set (§7).
- `router.py` → renamed in spirit to `recipe_picker.py`, but keep the file name for git-blame continuity. Reduce its scope to "given a question and confirmed mode, pick a recipe + params".

Edited:
- `orchestrator.py` — replace the `_handle_execute` / `_handle_refine` split with the unified loop (§8). Wire new events.
- `summarizer.py` — multi-run prompts and citations (§9).
- `verify.py` — cross-run + diff verification (§7.5).
- `server.py` — three new endpoints (§4.2), extend the conversation GET payload with `memory`.
- `bootstrap_schema.py` — add `conversation_memory` table and `recipe_runs.is_derived`/`derived_op` columns.

Each `recipes/*.py` gets a `humanize(params: dict) -> str` function (§6.5).

---

## 15. Acceptance Criteria

1. The classifier returns a strict `TurnClassification` for every test message in §13.1 with the correct mode and referenced_run_ids.
2. A "filter that to 2024" follow-up to a fresh recipe run produces an `AnswerResponse` with `mode='refined'`, exactly one `FilterOp`, `recipe_run_id` pointing at a new derived run, and a `diff` showing the row delta.
3. A "compare FY2023 to FY2024" follow-up with both years in memory produces `mode='composed'`, one `CompareOp`, and a synthetic findings table with `_status` per row.
4. A "why is row 12 high?" turn produces `mode='conversational'`, ops=[commentary], no new recipe run, and citations whose `source_run_id` points at the prior run.
5. Pinning a run with `POST /runs/{id}/pin` keeps it in memory across at least 25 subsequent fresh turns.
6. Forgetting a run with `POST /runs/{id}/forget` removes it from the next classifier call's memory summary.
7. The full SSE stream for a refined turn emits, in order: `turn_classifier_started`, `turn_classifier_decision`, `memory_recall`, `refinement_started`, `refinement_completed`, `diff_computed`, `summarizer_started`, `summarizer_token`*, `summarizer_completed`, `verifier_started`, (`verifier_check`*), `verifier_completed`, `final_response`.
8. A second identical refinement turn (same predicate, same source_run_id) returns a cached derived run with `timing_ms=0` and produces the same `recipe_run_id`.
9. Verifier rejects a conversational answer that contains an uncited number; it accepts the same answer when the number is cited at a finding in a referenced run.
10. The conversation GET response now includes a `memory` array with one entry per non-forgotten run; `forgotten` runs do not appear there but still appear in `recipe_runs`.
11. Old clients (sending requests without any new fields) still receive parseable `AnswerResponse` objects with sensible defaults (`mode='fresh'`, `operations=[]`, `source_run_ids=[]`).
12. p95 latency targets in §12.4 hold under 50 concurrent conversations on the existing infra.
13. `bootstrap_schema.py` migration is idempotent — running it twice on a populated DB does not error and does not duplicate columns.
14. The deprecated `refinement_filter_applied` event continues to fire when `ANALYST_LEGACY_REFINEMENT_EVENT=true`; setting it to false suppresses only that event without affecting the new ones.
15. End-to-end smoke test (a 6-turn investigation: fresh → filter → sort → compose with adverse_media → drill into row → conversational explain) completes with no errors and produces a verifiable trail of memory entries.

---

## 16. Non-Goals

- Don't introduce a separate query engine service (no Spark, no Trino). DuckDB-in-process is the chosen tool.
- Don't allow user-supplied raw SQL in any field. Predicates are LLM-emitted natural-language strings, parsed by §7.2.
- Don't persist memory across conversations. Each conversation has its own working set.
- Don't share runs between conversations.
- Don't auto-pin runs the user "seems to like". Pinning is explicit.
- Don't introduce streaming over WebSockets — SSE remains.
- Don't change the existing recipe interface (`recipes/*.py`).
- Don't change the LLM provider or model selection logic. Use whatever the rest of the service uses.
- Don't bypass the verifier. Every answer goes through grounding checks, including conversational mode.
- Don't return the operation plan to the client *before* execution — only the executed `operations` array on the final response (the SSE events provide live progress in real time).

---

## 17. Deliverable

A single coherent diff over `services/ship/output/ship/*` plus the schema migration in `bootstrap_schema.py` and tests under `services/ship/output/ship/tests/`. Include a short `MULTITURN.md` at the repo root (or under `services/ship/`) describing:
- The classifier system prompt (verbatim).
- The operation kinds and what each does.
- The SSE event order for each mode.
- The memory eviction policy and pin caps.
- How to run the new test suite (`pytest -k iterative`).

Quality bar: a senior reviewer reads the orchestrator and immediately understands which mode each branch handles; a user runs a 6-turn investigation and the system never re-runs SQL it already has, never invents a citation, never silently drops a referenced run, and produces a verifiable lineage for every claim.

Now build it.
