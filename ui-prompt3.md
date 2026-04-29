# Brief: Multi-Turn Iterative Investigation in the Analyst Chat (UI side)

## 0. What this is, in one sentence

Today the Accountability Analyst answers each user message as a *single, isolated query*: it routes to one recipe, runs it, returns a grounded answer, and then on the next message starts over. We need to upgrade the UI so that follow-up questions can **refine, combine, drill into, or comment on prior answers** — exactly the way ChatGPT, Grok, and Gemini handle iterative conversations — and so that the lineage, diff, and provenance of every refined answer is obvious and trustworthy.

This is the **UI** half. A companion brief (`service-prompt.md`) covers the matching backend changes. Both share an exact wire contract — read §3 carefully and treat those types as frozen.

---

## 1. Your Role and Constraints

You are a senior product designer and front-end engineer.

Stack (no changes):
- React 18, TypeScript strict, Tailwind, react-query v5, react-router-dom v6, lucide-react.
- The chat lives at `/accountability` and `/accountability/:conversationId`.
- All work happens inside `src/components/ship/*`, `src/lib/ship.ts` (types only), `src/routes/AccountabilityPage.tsx`, and any new files you add under those directories.
- The streaming protocol is SSE. New event names listed in §4 are additive; existing events stay intact.
- The backend type definitions live in `src/lib/ship.ts`. You will extend them, not rewrite them.

This brief assumes the prior briefs (`ui-prompt.md` for chat polish, `ui-prompt2.md` for the activity feed) are already merged or in-flight. Where they conflict, this brief is more recent and wins.

---

## 2. The Problem, in Concrete Examples

A user runs an investigation. They ask:

> *"Show me Alberta sole-source contracts over $250K from FY2023."*

They get an answer with 412 findings. Today, that's the end of the line. Whatever they ask next is treated as an unrelated new query.

What we want next:

| User says | Expected behavior |
|---|---|
| "Filter that to procurement code 1234." | Apply an in-memory filter on the prior 412 findings → produce a new answer card with the filtered subset, the lineage `← Run #1`, and a diff "412 → 38 rows". |
| "Sort by amended value descending." | Re-shape the prior findings without re-querying. |
| "Now do the same for Saskatchewan." | Re-run the SAME recipe with `province=SK` and answer with the new findings — but optionally compare to the Alberta run, side-by-side. |
| "What about FY2024?" | Re-run the same recipe with the year changed; show a diff vs FY2023 if the user wants ("Compare with previous answer"). |
| "Are any of these recipients in adverse media?" | Compose: take the entity column from the prior run, run the adverse_media recipe with those names, join on entity, return a combined findings table with a new `adverse_media_count` column. |
| "Drill into row 5." | Pull the entity from row 5 of the prior findings, open a new dossier-style answer focused on that entity. |
| "Why is row 12's HHI so high?" | Conversational mode — explain using ONLY the cached findings + cached SQL log; no new query. |
| "Forget this thread, start over with charity zombie analysis." | New recipe path (today's behavior, with explicit acknowledgment that we're discarding context — see §13). |
| "Give me a CSV of just amount > $1M from rows you already have." | Refine + export, in-memory, no re-query. |
| "Combine that with the loops we found earlier." | Multi-run composition referencing run IDs from earlier in the conversation. |

The user must never have to phrase things like "using the data from message 3" or copy/paste prior findings. The system must understand "that", "those", "the top 5", "row 3", "the previous fiscal year".

The UI's job is to make this **legible**: every refined answer must visibly say "I built this on top of Run #N by doing X" — and let the user verify, undo, fork, or compare.

---

## 3. The Wire Contract (frozen — must match `service-prompt.md`)

### 3.1 New / extended types in `src/lib/ship.ts`

```ts
// Extend AnswerResponse with lineage and operations.
export type AnswerResponse = {
  type: 'answer';
  message_id: string;
  /**
   * The mode of this turn.
   *  - 'fresh'        – ran a brand-new recipe, no prior context used
   *  - 'refined'      – applied operations to a single prior run
   *  - 'composed'     – combined multiple prior and/or new runs
   *  - 'conversational' – no SQL ran; commentary on prior runs only
   */
  mode: 'fresh' | 'refined' | 'composed' | 'conversational';

  /** The primary run produced by this turn. Null in `conversational` mode. */
  recipe_run_id: string | null;

  /** Backwards-compat: the most recent single source run, if any. */
  based_on_run_id: string | null;

  /** Every prior run this answer reads from (memory recall). Ordered most-recent-first. */
  source_run_ids: string[];

  /** The operations applied this turn, in order. Each is a step in the lineage. */
  operations: Operation[];

  /** Diff against the most recent prior run, if applicable. Null when not meaningful. */
  diff: AnswerDiff | null;

  summary: Summary;
  findings_preview: Record<string, unknown>[];
  verification: Verification;
  latency_ms: number;
};

export type Operation =
  | { kind: 'recipe_run';  recipe_id: string;  run_id: string;  description: string; row_count: number; timing_ms: number }
  | { kind: 'filter';      source_run_id: string; description: string; before_count: number; after_count: number; predicate: string }
  | { kind: 'project';     source_run_id: string; description: string; columns: string[] }
  | { kind: 'sort';        source_run_id: string; description: string; sort_by: { column: string; dir: 'asc' | 'desc' }[] }
  | { kind: 'slice';       source_run_id: string; description: string; offset: number; limit: number }
  | { kind: 'aggregate';   source_run_id: string; description: string; group_by: string[]; aggregations: { column: string; fn: string; alias: string }[] }
  | { kind: 'join';        left_run_id: string; right_run_id: string; description: string; keys: string[]; how: 'inner' | 'left' | 'outer' }
  | { kind: 'union';       source_run_ids: string[]; description: string }
  | { kind: 'intersect';   source_run_ids: string[]; description: string }
  | { kind: 'compare';     baseline_run_id: string; comparison_run_id: string; description: string }
  | { kind: 'commentary';  source_run_ids: string[]; description: string };

export type AnswerDiff = {
  baseline_run_id: string;
  rows_added: number;
  rows_removed: number;
  rows_changed: number;
  columns_added: string[];
  columns_removed: string[];
};

// Citation now optionally carries a run_id.
export type Citation = {
  finding_index: number | null;
  sql_query_name: string | null;
  url: string | null;
  /** When the cited finding lives in a prior run, this is set. */
  source_run_id: string | null;
};
```

A new conversation field carries the cached runs:

```ts
export type ShipConversation = {
  conversation_id: string;
  title: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  messages: ShipConversationMessage[];
  recipe_runs: ShipConversationRecipeRun[];

  /** NEW — runs currently held in conversation memory and addressable by id. */
  memory: MemoryEntry[];
};

export type MemoryEntry = {
  run_id: string;
  recipe_id: string | null; // null for derived (refinement) runs
  derived_from_run_id: string | null;
  description: string;       // short human label, e.g. "AB sole-source ≥$250K, FY2023"
  params_summary: string;    // human-friendly param recap
  row_count: number;
  created_at: string;
  pinned: boolean;
};
```

### 3.2 New conversation endpoints

`src/lib/ship.ts` gets two new functions (signatures, not implementations):

```ts
export function pinRun(conversationId: string, runId: string): Promise<void>;
export function unpinRun(conversationId: string, runId: string): Promise<void>;
export function forgetRun(conversationId: string, runId: string): Promise<void>;
```

These let the user manage what's in conversation memory. The backend will respect them. Don't change the existing functions.

### 3.3 New SSE events (additive)

```ts
export type StreamEvent =
  // … all existing events stay …
  | { name: 'turn_classifier_started';  data: {} }
  | { name: 'turn_classifier_decision'; data: { mode: AnswerResponse['mode'] | 'clarify' | 'new_conversation' | 'not_answerable'; reasoning_one_line: string; referenced_run_ids: string[] } }
  | { name: 'memory_recall';            data: { run_ids: string[]; reason: string } }
  | { name: 'refinement_started';       data: { kind: Operation['kind']; source_run_id: string; description: string } }
  | { name: 'refinement_completed';     data: { kind: Operation['kind']; source_run_id: string; before_count: number; after_count: number; timing_ms: number } }
  | { name: 'composition_started';      data: { kind: 'join' | 'union' | 'intersect' | 'compare'; source_run_ids: string[]; description: string } }
  | { name: 'composition_completed';    data: { kind: 'join' | 'union' | 'intersect' | 'compare'; source_run_ids: string[]; output_count: number; timing_ms: number } }
  | { name: 'diff_computed';            data: AnswerDiff };
```

The backend may emit any subset; the UI must tolerate any combination.

---

## 4. UX Principles for Iterative Investigation (in priority order)

1. **Lineage is always visible.** Every refined or composed answer shows what it came from. The user should be able to point at a row and ask "where did this come from" without scrolling up.
2. **The diff is the headline.** When the answer is a refinement of a previous one, the most important visual element is **what changed** — rows added, rows removed, columns added, sort order changed.
3. **Quick refinements are one-click.** After every successful answer, the UI suggests refinement chips ("Filter to 2024", "Sort by amount", "Show top 5", "Compare with previous answer", "Add adverse media") that send a refinement turn directly. The user should not have to phrase the SQL.
4. **Findings are citable across runs.** If the assistant claims "row 5 from Run #3 still appears in this list", clicking that citation jumps to the right row in the right run's table.
5. **Memory is inspectable and editable.** A "Memory" pill in the chat header reveals every run currently in the conversation's working memory; the user can pin runs (so they don't get evicted), unpin, or forget runs (so they stop being sent to the LLM). Forgotten runs remain visible in the message thread but are de-prioritized.
6. **Mode is a glance away.** Every answer card carries a small badge — `Fresh`, `Refined`, `Composed`, `Commentary` — so the user knows whether this turn cost compute or just shaped existing data.
7. **No magic re-rendering.** If a refinement is applied, the UI does not silently mutate the prior answer's findings table. Every refinement is its own answer card, with its own findings, its own citations, its own verification. The lineage breadcrumb connects them.
8. **Mistakes are reversible.** Every operation can be undone with a single click that re-sends a refinement turn that "rolls back" to a prior run as the new working set.

---

## 5. Surface-by-Surface Requirements

### 5.1 Mode badge and lineage breadcrumb (top of every answer card)

Render a single line at the top of the answer card, *above* the headline and *below* the existing "Thought for Xs" disclosure:

```
[ Refined ]  Built on Run #3 (AB sole-source ≥ $250K, FY2023)  →  Filtered to procurement code 1234
```

- Mode badge: a small chip with kind-specific styling.
  - `Fresh` — accent outline, no fill, "New query".
  - `Refined` — soft accent fill, "Refined".
  - `Composed` — soft warning fill, "Composed".
  - `Commentary` — quiet gray fill, "From memory".
- Run reference: an inline button "Run #N" rendered in mono. Hovering shows a popover with the run's description, params summary, row count, recipe id. Clicking scrolls to that run's answer card in the thread.
- Operation chain: the `operations[]` array rendered as a horizontal arrow-separated list of human descriptions. Truncate descriptions over 60 chars with a tooltip on hover.
- If `operations` has more than 3 items, collapse to "Run #N → Filtered → … → Sorted (4 ops)" with a click to expand.
- Conversational mode shows: `[ From memory ]  Drawn from Run #3, Run #5  ·  No new query ran`.
- Composed mode shows: `[ Composed ]  Run #3 ⋈ Run #6 on entity_name`.

Numbering scheme: Run numbers are per-conversation, 1-based, derived from `conversation.recipe_runs` order. Compute it locally; don't trust an absolute count from the server. Pinned runs keep their original number even after eviction.

### 5.2 Diff strip (when `diff !== null`)

Right below the lineage breadcrumb, render a one-line diff strip:

```
↑ 8 rows added   ↓ 23 rows removed   ↻ 5 rows changed   + adverse_media_count, news_url
```

- Use lucide icons: `ArrowUp` (added), `ArrowDown` (removed), `RotateCcw` (changed), `Plus` (column added), `Minus` (column removed).
- Each metric is a button that filters the findings table to just that subset (toggle).
- "Added" rows shown in soft green tint; "removed" rows shown only in compare mode (see §5.5); "changed" rows shown with a diff highlight per cell.
- If `diff.rows_added === 0 && diff.rows_removed === 0 && diff.rows_changed === 0`, show a quiet "Same row set, reshaped" pill instead.

### 5.3 Findings table — refinement view (`FindingsTable.tsx` extensions)

Extend the existing component so it can render in three modes, controlled by props:

- `mode='single'` (today's behavior): one set of findings, sortable, citation-highlightable.
- `mode='diff'`: highlights `added` / `removed` / `changed` rows against a baseline run's findings (need to fetch baseline via `getRecipeRun` lazily). Adds a "Show only changes" toggle in the toolbar.
- `mode='compare'`: side-by-side two-table view (Baseline | Current) with synchronized sorting and a row alignment when a stable join key exists (default: try `entity_name`, `recipient_name`, `business_number`, fall back to row index).

Toolbar additions:

- A small **mode switcher** segment-control at the top-right: `Single | Diff | Compare`. Disabled options if no baseline run is referenced.
- A **"Tell me more"** column action: every row gets a small kebab on hover with options:
  - "Tell me more about this row" → sends a turn `Tell me more about row {index} ({primary_label}).`.
  - "Find similar in other runs" → sends a turn `Find rows like row {index} in earlier results.`.
  - "Open in graph" (if a graph route exists for this entity).
  - "Pin row" → marks that row as referenced in subsequent prompts (see §5.7).

Diff cell styling:
- `added` row: 1px left accent stripe in green, soft green row tint.
- `removed` row: 1px left accent stripe in red, strikethrough text in cells, only visible in `mode='diff'` with "show removed" enabled.
- `changed` row: each changed cell shows the new value above a small muted line with the old value (`new ↑ old ↓`).

### 5.4 Quick-refinement chips (under every successful answer)

Render a row of chips below the message-action footer of every Answer card:

```
Suggested refinements
[ Filter to 2024 ]  [ Sort by amount ]  [ Top 5 only ]  [ Compare with FY2022 ]  [ Add adverse media ]  [ Group by department ]  [ Show in graph ]
```

Generation rules — derive locally from the answer payload. **Do not call the backend.**

- **Date detection:** scan paragraphs and findings columns for years/quarters; produce one chip per detected period plus one "previous period" chip.
- **Numeric column detection:** for the largest numeric column (currency or count), suggest "Sort by {column}" descending and "Top 5 only".
- **Categorical column detection:** for low-cardinality string columns (≤ 20 distinct values), suggest "Group by {column}".
- **Cross-recipe suggestions:** if the recipe is `vendor_concentration_*`, suggest "Add adverse media", "Add governance links", "Add ghost capacity check". Maintain a small static map: `recipe_id_prefix → [related_recipe_chip_text]`.
- **Refinement vs commentary:** include one "Explain row 1" chip (commentary mode) for every answer.
- **Self-undo:** if the previous turn was a refinement, include "Roll back to Run #{baseline}" as a chip.
- Limit to 6 chips total. Each chip ≤ 60 chars. Sentence case.

Click behavior: each chip prefills the composer with the corresponding refinement phrase AND focuses the composer with the cursor at the end. Shift-click sends immediately without prefill confirmation. Persist the user's preference between prefill-only and immediate-send via a small ⚙︎ menu next to the chips.

### 5.5 Comparison view

When the user runs a refinement that produces a `diff`, surface a "Compare side-by-side" button next to the diff strip. Clicking opens a comparison panel that takes over the answer card body:

- Two-column layout: Baseline (Run #M) | Current (Run #N).
- Each column has its own findings table (use `FindingsTable` in single mode).
- A sticky toolbar row across the top: row alignment toggle (auto / by entity / by index / off), "Show only differences" toggle, "Sync scrolling" toggle.
- A separator with a thin vertical line; rows that match across align horizontally.
- Click on any row to see the joined diff inline below the comparison.

Close the comparison view returns to the diff-mode findings table.

### 5.6 Activity Card additions (extends `ui-prompt2.md` §2)

Three new step-kind concepts join the activity card:

1. **classifier** — a step with the brain-style icon (`Brain`) that resolves on `turn_classifier_decision`. Title: "Reading your follow-up". Subtitle: the `reasoning_one_line`. Metadata: a mode chip showing the chosen mode.
2. **memory_recall** — a slim step with `Archive` icon. Title: "Recalling 3 prior runs". Subtitle: the `reason`. Metadata: list of `run_ids` as mono Run #N pills. Resolves on `memory_recall` itself (it's a one-shot event).
3. **refinement / composition** — a top-level step with the `Filter` (refinement) or `Combine` (composition) icon. Title from `description`. Subtitle: `Source: Run #N` (or "Runs #N, #M" for composition). Metadata: `${before} → ${after} rows · ${secs}s` for refinement; `${output_count} rows · ${secs}s` for composition.

Pipeline strip (`ui-prompt2.md` §3) gains a phase: **Classify → Recall → Plan → Retrieve/Refine → Synthesize → Verify**. If you don't want to widen the strip, fold Classify+Recall into the existing Route phase, but prefer 6 distinct phases on `xl+` and 4 on smaller widths via a media query.

`refinement_filter_applied` (existing) is now redundant with the new `refinement_started/completed` events. Treat both for backwards compatibility — if both fire, prefer the new ones.

### 5.7 Composer affordances for follow-ups

The composer must telegraph that follow-ups can reference prior context.

- **Active context indicator:** a subtle bar at the top of the composer (above the textarea) that reads: "Replying with context from Run #3 + 2 more". Click reveals a dropdown of all runs in memory, each with a checkbox to opt out of including that run in this turn's context. The user's selection persists for the current message only and resets after send.
- **@-mentions for runs and findings:** typing `@` in the composer opens an autocomplete with two sections:
  - "Runs" — every run in memory, by Run #N + description.
  - "Findings" — every finding from any run currently open in a findings table on screen, by `Run #N · row {index} · {primary label}`.
  - Selecting an item inserts a token like `@run-3` or `@run-3:row-12` rendered as a styled inline chip. The chip carries the underlying ID through to the backend.
- **Slash commands:** typing `/` at the start of the composer opens a menu:
  - `/filter <expression>` — refinement
  - `/sort <column> [asc|desc]` — refinement
  - `/top <n>` — refinement (slice)
  - `/compare <run|period>` — composition
  - `/explain <row|column>` — commentary
  - `/show <view>` — change visualization (graph / table / map)
  - `/pin` `/unpin` `/forget <run>` — memory management
  - `/undo` — roll back to the previous run as the working set
  - These translate to natural-language refinement phrases on send. Show the translated phrase as a preview chip below the composer before sending.
- **Implicit referent hint:** when the user types a pronoun ("that", "those", "them", "the top 5") without a slash command, render a quiet inline hint below the composer: "Resolves to: Run #N — {description}". This hint fades out 3s after the last keypress.
- **Send mode:** when in a follow-up to a previous answer, the Send button gets a subtle suffix "Refine" or "Compose" — the inferred mode based on detected refinement keywords. Pure heuristic, server still has the final say.

### 5.8 Memory pill (chat header)

Add a small pill to the right side of the chat header next to the status indicator:

```
[ ▢ Memory · 5 runs ]
```

Click opens a popover (Floating UI) with:

- A list of every entry in `conversation.memory`, ordered most-recent-first.
- Each row: Run #N badge, description, params summary, row count, age, three actions:
  - 📌 Pin / unpin (calls `pinRun` / `unpinRun`).
  - 🗑️ Forget (calls `forgetRun`; confirmation inline).
  - ⤴ Jump to message (scrolls to the answer card that produced this run).
- A footer line: "{n} runs in memory · {m} pinned · {evicted_count} forgotten".

Pinned runs render with a 📌 prefix in their Run #N pill anywhere they appear (lineage breadcrumb, @-mention, memory pill).

### 5.9 Conversational mode (no new query)

When `mode === 'conversational'` and `recipe_run_id === null`:

- Render the answer card with the `Commentary` badge and a slightly lighter border (no shadow).
- No findings table at all.
- Citations point at prior runs; each citation chip carries a `Run #N` prefix in the hover-card.
- A small footer line: "No query ran — drawn from cached findings."
- The Latency footer shows a smaller number (typical for commentary < 1.5s) and a label "summarizer-only".

### 5.10 Composition mode (multi-run)

When `mode === 'composed'`:

- The lineage breadcrumb renders all source runs joined with the operation's symbol (`⋈` for join, `∪` for union, `∩` for intersect, `↔` for compare).
- The findings table shows a `source` indicator column on the left when columns from different source runs were merged. Hovering shows which run that column came from.
- For `compare` operations, default the table to `mode='compare'` (§5.5) automatically.

### 5.11 Citation chips with cross-run support (`CitationChip.tsx`)

- A citation with `source_run_id` set renders the inline numeric superscript with a small accent dot. Hovering shows a `Run #N` line at the top of the hover-card and the row preview from that specific run.
- Clicking such a citation scrolls the user to that earlier run's findings table. If the table is collapsed, expand it. If the run was forgotten, render the hover-card with a "Re-attach this run" button that calls `pinRun`.

### 5.12 Finding rows: drill-in actions

The existing findings table doesn't expose row-level actions today. Add:

- A persistent kebab on hover at the right edge of every row.
- Menu items:
  - "Tell me more about this" — sends a refinement turn referencing this row.
  - "Find similar across runs" — sends a turn that asks the assistant to look across memory for similar rows.
  - "Show in graph" (if a graph route is wired for the entity).
  - "Pin row" — see §5.7 on @-mentions; pinned rows persist in autocomplete.
  - "Copy row as Markdown" — copies a key-value list of the row's columns.
- Selecting a row by clicking (anywhere not a link) toggles a row-checked state. Selected rows show in a footer toolbar: "{n} selected · Drill into selection · Compare · Pin all". "Drill into selection" sends a turn that constrains future refinements to those rows.

### 5.13 Roll-back / undo

- Every refined or composed answer card shows an "↩ Roll back to baseline" button in its footer (next to Copy / Permalink).
- Clicking sends a turn that re-attaches the baseline run as the working set. Implementation-side it's just a phrase like "Use Run #3 as the working set going forward; ignore the refinement.".
- Optimistic UI: visually mark all answer cards downstream of the rollback as "rolled back" with a subtle 50% opacity overlay and a label "Superseded by undo at Run #M". They remain in the thread; nothing is deleted.

### 5.14 Empty / fresh-thread behavior

When the conversation has zero memory entries (it's a brand-new conversation), hide the Memory pill, hide the active-context indicator on the composer, and treat the first turn as fully fresh. Once the first answer arrives, the lineage system activates.

---

## 6. Copywriting

Sentence case across the board. No "EXECUTE", no "FORENSIC", no all-caps body text. Specific phrases:

- Mode badges: "New query", "Refined", "Composed", "From memory".
- Lineage prefix: "Built on Run #N" (for refined), "Combining Run #N + Run #M" (for composed), "Drawn from Run #N, Run #M" (for commentary).
- Diff line (positive): "8 rows added · 23 rows removed · 5 rows changed".
- Diff line (no change): "Same row set, reshaped."
- Suggested-refinements eyebrow: "Suggested refinements".
- Memory pill: "Memory · 5 runs". Empty: "Memory empty".
- Active context indicator: "Replying with context from Run #3 + 2 more" (or just "Replying with full memory" when all runs included).
- Conversational footer: "No query ran — drawn from cached findings."
- Roll-back action: "Roll back to Run #3".
- Forget confirmation: "Forget this run? It will stop being sent to the analyst on follow-ups, but stays visible above."
- Pin tooltip: "Keep this run in memory" / "Stop keeping this run pinned".
- Slash command preview: "Will send: 'Filter the prior results to fiscal_year = 2024'."

---

## 7. State, Hooks, and Components You'll Add

- `src/components/ship/LineageBreadcrumb.tsx` — mode badge + run refs + operation chain.
- `src/components/ship/DiffStrip.tsx` — the one-line diff summary with toggle filters.
- `src/components/ship/MemoryPopover.tsx` — the Memory pill popover with pin/unpin/forget actions.
- `src/components/ship/ActiveContextBar.tsx` — the composer's prior-context indicator + opt-out checkboxes.
- `src/components/ship/RunRefChip.tsx` — the inline "Run #N" pill component used in lineage, citations, autocompletes.
- `src/components/ship/MentionAutocomplete.tsx` — @-mention dropdown for runs and findings.
- `src/components/ship/SlashCommandMenu.tsx` — the slash-command palette.
- `src/components/ship/RefinementChips.tsx` — quick-refinement chips beneath each answer.
- `src/components/ship/RowActionsMenu.tsx` — the kebab on findings rows.
- `src/components/ship/CompareView.tsx` — the side-by-side two-table comparison.
- `src/lib/lineage.ts` — pure helpers: compute Run #N indices, format operation chains, detect refinement intent in composer text, derive suggested refinements from an answer payload.
- `src/lib/memorySelection.ts` — encode/decode "context opt-out" per turn.
- Extend `useActivityFeed` (from `ui-prompt2.md`) to handle the new SSE events.
- Extend `FindingsTable` props with a `mode`, `baselineFindings`, `diff`, and `onRowAction`.
- Extend `ConversationView` to thread `conversation.memory` and per-message lineage through to children.
- Extend `Composer` with the active-context bar, slash menu, mention autocomplete, and inferred send-mode label.

Persist UI prefs in localStorage under `analyst.iter.*`:

- `analyst.iter.refinementChips.shiftToSend: '0' | '1'`
- `analyst.iter.compareView.alignBy: 'auto' | 'entity' | 'index' | 'off'`
- `analyst.iter.findingsMode.${tableId}: 'single' | 'diff' | 'compare'`
- `analyst.iter.composer.preview: '0' | '1'`

---

## 8. Edge Cases You Must Handle

1. **Backend hasn't shipped yet.** Until the service emits new events and types, the UI must degrade gracefully: if `mode` is missing on an `AnswerResponse`, treat it as `fresh`; if `operations` is missing, render no lineage; if `source_run_ids` is missing, render no Memory pill state. A feature flag is acceptable: respect a `VITE_ANALYST_ITERATIVE` env var that, when false, hides the new affordances.
2. **Inconsistent run numbering.** A user may have forgotten Run #2 — its number is no longer rendered in the breadcrumb. Don't renumber. Skipped numbers are fine and informative.
3. **Citation points at a forgotten run.** Render the citation, but hover-card displays a "This run was forgotten — re-attach to inspect" affordance.
4. **Cross-conversation references.** Out of scope. Refuse to resolve `@run-…` from a different conversation_id (warn in console, no chip is created).
5. **Race: refinement turn + earlier turn still streaming.** Disable the composer (and refinement chips) while any turn is streaming, exactly as today. Once the active stream completes, all UI affordances re-enable.
6. **Long lineage chains.** If `operations.length > 6`, collapse the breadcrumb to "Run #3 → … → Sorted (7 ops)" with a chevron to expand. Print all in the popover.
7. **Diff against a forgotten baseline.** If `diff.baseline_run_id` is no longer in memory, render the diff strip with a "Baseline forgotten — re-attach Run #M to view diff" action that restores the baseline via `pinRun`.
8. **Empty diff.** When all diff counts are zero, do not show the diff strip — show the "Same row set, reshaped" pill.
9. **Composition with a recipe that wasn't run yet.** The backend may, mid-stream, kick off a fresh recipe to satisfy a join. The activity card will see normal `primitive_started/completed` events alongside `composition_started`. No special UI handling needed beyond rendering both.
10. **Conversational mode misclassified.** If the user says "filter that to 2024" but the backend returns `mode='conversational'` (it interpreted as commentary), render a small ghost button "Run as refinement instead" that re-sends the same content with a hint phrase appended.

---

## 9. Accessibility Additions

- Every Run #N pill has an aria-label describing the run ("Run 3, Alberta sole-source contracts FY2023, 412 rows").
- The lineage breadcrumb is a `<nav aria-label="Answer lineage">`.
- The diff strip metric buttons are toggles (`aria-pressed`).
- The compare view's row alignment toggle has an aria-label and visible label.
- @-mention autocomplete is a combobox with proper aria-activedescendant.
- The Memory popover is `role="dialog"` with focus trap; Esc closes; returns focus to the pill.
- Keyboard shortcuts:
  - `Cmd/Ctrl+M` toggles the Memory pill popover.
  - `Cmd/Ctrl+\\` re-runs the most recent refinement on the most recent run.
  - `Cmd/Ctrl+Z` (when composer is empty and the last action was a refinement): rolls back to baseline.

---

## 10. Acceptance Criteria

1. After running a fresh answer, the user can type "Filter that to 2024" and a new answer card appears with a `Refined` badge, a "Built on Run #N" lineage breadcrumb, a diff strip ("412 → 38 rows"), and a findings table in `diff` mode by default.
2. After two answers, the user can type "Combine that with the loops we found earlier" and a `Composed` answer card appears with a lineage like "Run #3 ⋈ Run #5 on entity_name".
3. Clicking a citation that points to a row in Run #3 from an answer rendered in Run #5 scrolls to Run #3's findings table and highlights the cited row.
4. The Memory pill in the chat header shows a count matching `conversation.memory.length`. Clicking it opens a popover that lists every run with pin / unpin / forget actions; pinning persists across conversation reloads.
5. Quick-refinement chips appear beneath every successful answer, derived locally from the payload (no backend call), with at most 6 chips. Clicking a chip prefills the composer; shift-clicking sends immediately.
6. Slash-command menu opens when the user types `/` at the start of the composer; arrow keys navigate; Enter inserts.
7. @-mention autocomplete opens when the user types `@`; lists runs and on-screen findings; selection inserts a styled chip; the chip's underlying ID round-trips back to the backend in the message body.
8. Conversational answers (no new SQL) render with a `From memory` badge, no findings table, citations carrying Run #N prefixes, and a "No query ran" footer.
9. Composed answers render with a `Composed` badge and a column-source indicator in the findings table.
10. The activity card extends with classifier / memory_recall / refinement / composition step kinds, each with appropriate icons (`Brain`, `Archive`, `Filter`, `Combine`).
11. The findings table supports `mode='single'` (default), `mode='diff'` (highlighted adds/removes/changes), and `mode='compare'` (side-by-side). Mode switcher in the toolbar swaps between them.
12. Comparison view aligns rows by entity name when possible, falls back to row index, supports synchronized sorting and scrolling.
13. Roll-back button on every refined / composed answer sends a rollback turn; downstream answer cards visually mark as "Superseded".
14. The composer's active-context indicator displays "Replying with context from Run #N + …" and lets the user check / uncheck specific runs to exclude from this turn's context. The selection resets after send.
15. The UI degrades cleanly when the backend doesn't yet send new fields: `fresh` mode, no lineage, no Memory pill, classic single-recipe flow. Behind an env-var flag if needed.
16. Cmd/Ctrl+M toggles the Memory popover. Cmd/Ctrl+Z (empty composer, last action was refinement) rolls back. Cmd/Ctrl+\\ re-runs the most recent refinement.
17. No `tracking-widest` running text. No `font-black` body. Sentence case throughout. All lineage, diff, and badge copy follows §6.
18. All new components have visible focus rings, proper aria semantics, and respect `prefers-reduced-motion`.

---

## 11. Non-Goals

- Don't build a query builder UI. Slash commands and natural-language refinements are the only way users compose refinements.
- Don't render the full SQL log diff. SQL stays accessible via the existing drawer.
- Don't implement cross-conversation memory or run sharing.
- Don't try to client-side execute SQL. All refinements go through the backend; the UI only displays.
- Don't persist active-context exclusions across messages. They're per-turn only, by design.
- Don't introduce a state library. `useReducer` + `useContext` for memory is enough.
- Don't auto-ping the backend with pin/unpin/forget — these only fire on explicit user action.
- Don't redesign citations beyond adding the run-id awareness. The hover-card pattern from `ui-prompt.md` §7.12 stays.
- Don't ship dark mode in this pass.

---

## 12. Deliverable

A single coherent diff over `src/components/ship/*`, `src/lib/ship.ts` (types + the three new memory functions), `src/routes/AccountabilityPage.tsx` (only if needed for the Memory pill / header), plus the new files in §7.

Behind a feature flag (`VITE_ANALYST_ITERATIVE=true|false`) so the UI can ship before the full backend lands. When false, the UI behaves like today's single-turn flow.

Quality bar: a user runs three follow-up refinements on a fresh investigation and the UI never asks them to repeat themselves, never re-renders prior data silently, and always shows what changed and why. A senior reviewer should be able to read every answer card and immediately identify (a) what it was built on, (b) what changed, (c) what compute it cost.

Now build it.
