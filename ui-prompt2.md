# Brief: Build a Slick Agentic Activity / Progress UI for the Analyst Chat

## 0. What this is, in one sentence

We need to replace the bullet-list "thinking trail" in `src/components/ship/ProgressTrail.tsx` with a polished, animated, real-time activity feed that shows — turn by turn, agent by agent, tool by tool — exactly what the system is doing while it answers, in the visual register of Grok DeepSearch, ChatGPT tool-calling, Perplexity Pro Search, and Gemini Pro "Show thinking".

This brief covers **only** the progress / agent activity surface. It does not redesign the answer card, the composer, the sidebar, or copywriting elsewhere. If you also have the broader UX brief (`ui-prompt.md`), this one supersedes section 7.7 and refines it to production detail.

---

## 1. Stack and Constraints

- React 18, TypeScript strict, Tailwind, react-query, lucide-react.
- The SSE stream protocol in `src/lib/ship.ts` is **frozen** — do not change event shapes, names, or function signatures.
- Use existing CSS tokens in `src/styles.css` (`--color-accent`, `--color-success`, `--color-warning`, `--color-risk-high`, `--color-muted`, `--color-border`, `--color-surface-subtle`, etc.).
- No new heavy UI kits. `@floating-ui/react` for popovers is fine. Framer Motion is **not** required — pure CSS transitions are preferred.
- The mental model is multi-agent (the nav now labels this surface "AGENTS"). Treat each step as an agent or tool call, not a generic event line.

---

## 2. The 21 SSE Events You're Rendering

Every progress UI element ultimately renders from this stream. Memorize them:

| Event | Phase | Visual treatment |
|---|---|---|
| `router_started` | Route | "Routing your question" — animated brain icon, no metadata |
| `router_decision` | Route | Resolves the Route step. Show `decision` label + `recipe_id` as a mono pill + the `reasoning_one_line` as a quiet caption underneath |
| `phase_started` | (transitions) | Drives phase pipeline progress — see §6. Don't render as a row. |
| `primitive_started` | Retrieve | A new agent/tool card under Retrieve. Title from `primitive_name` (humanize: `vendor_concentration_query` → "Vendor concentration query"). Show abbreviated args from `args_summary` as small kv chips (top 3 fields). Status: running. |
| `primitive_completed` | Retrieve | Resolves the matching `primitive_started` row. Status: done. Footer line: `${row_count.toLocaleString()} rows · ${(timing_ms/1000).toFixed(1)}s`. If `caveats.length > 0`, show an amber chevron with the caveats listed when expanded. |
| `sql_query_started` | Retrieve | Indented sub-row under the active primitive. Mono `query_name`. Status: running. |
| `sql_query_completed` | Retrieve | Resolves matching `sql_query_started` row. Status: done. Inline metadata: `${row_count} rows · ${timing}s`. Hover preview shows the SQL name and timing. Click → opens the SQL drawer (existing). |
| `web_search_started` | Retrieve | Indented sub-row. Globe icon. Title: `Searching the web` · subtitle: the literal `query` string in italic muted text. Status: running. |
| `web_search_completed` | Retrieve | Resolves. Footer: `${result_count} results · ${timing}s`. |
| `canlii_started` | Retrieve | Indented sub-row. Scale-of-justice icon (use `Scale` from lucide). Title: `Searching CanLII for ${entity_name}` · subtitle: the `query`. Status: running. |
| `canlii_completed` | Retrieve | Resolves. Footer: `${case_count} cases · ${timing}s`. |
| `refinement_filter_applied` | Retrieve | A small inline note (not a row): "Refined cached findings: 12,400 → 3,182" with a filter icon. |
| `summarizer_started` | Synthesize | New agent card under Synthesize. Title: "Drafting the answer". Subtitle: `~${prompt_token_estimate.toLocaleString()} input tokens`. Status: running. |
| `summarizer_token` | Synthesize | Do **not** render in the activity feed. The token stream feeds the answer card directly (per `ui-prompt.md` §7.8). However, accumulate a `tokensReceived` counter and update the Synthesize card's footer in real time: "Drafting… 312 tokens written". |
| `summarizer_completed` | Synthesize | Resolves. Footer: `${prompt_tokens.toLocaleString()} in · ${completion_tokens.toLocaleString()} out`. |
| `verifier_started` | Verify | New agent card. Title: "Checking grounding". Status: running. |
| `verifier_check` | Verify | Inline within the Verify card: a row per check with the check name (humanized), a status pill (pass/fail), and the `details` as a quiet caption. Pass = green check, fail = amber triangle. |
| `verifier_completed` | Verify | Resolves the Verify card. Footer: `${failures.length} concerns · ${(latency_ms/1000).toFixed(1)}s`. If `failures.length === 0`, the footer reads "All checks passed". |
| `heartbeat` | (any active phase) | Don't render as a row. Use to keep the elapsed counter alive and, after 10s of silence on the active card, show a soft "Still working — ${elapsed}" caption. |
| `final_response` | (terminal) | Closes the activity feed. Triggers collapse-to-summary (see §7). Do not render as a row. |
| `error` | (terminal/recoverable) | Mark the active step as failed. If `retryable === true`, show a small inline retry button on the failed step. The activity feed stays visible. |

---

## 3. The Pipeline: 4 Phases, Always Visible

While the turn is running, render a **horizontal pipeline strip** above the activity rows:

```
[ Route ●───● Retrieve ●───● Synthesize ●───● Verify ]
```

- 4 phase pills connected by 1px lines (which animate from gray → accent as each phase enters "running" or "done").
- Each pill has: phase label (sentence case), an icon, a tiny status dot inside (gray pending / accent pulse running / green done / amber failed), and an elapsed counter that begins when the phase starts and freezes when it ends.
- Mapping events → phases:
  - **Route** = `router_started` → resolves on `router_decision`.
  - **Retrieve** = first `phase_started{phase:'retrieve'}` OR first `primitive_started`/`sql_query_started`/`web_search_started`/`canlii_started` → resolves when no primitive is in flight AND `summarizer_started` arrives.
  - **Synthesize** = `summarizer_started` → resolves on `summarizer_completed`.
  - **Verify** = `verifier_started` → resolves on `verifier_completed`.
- The pipeline stays visible during the run AND inside the post-completion "Thought for Xs" disclosure (§7) so users can re-check phase timings.
- Below the pipeline, the active phase has a 1-line "Now: …" heading so you don't have to read the rows to know what's happening: e.g., "Now: Querying federal_grants_recipient · 3 of 5 queries done".

Phase icons: `Compass` (Route), `Database` (Retrieve), `PenLine` (Synthesize), `ShieldCheck` (Verify). All from lucide-react.

---

## 4. The Activity Card (the live, running view)

This is the headline element of the brief.

### 4.1 Placement and shape

- **Above** the assistant's answer card, full message-column width, rounded-lg, 1px `--color-border`, `bg-[var(--color-surface)]`, very soft shadow.
- A compact header bar on top: spinner icon (only while running), the phrase **"Thinking…"** in `text-sm font-medium`, the elapsed seconds in mono, and on the right an "✕ Stop" ghost button that aborts the stream (delegate to existing `abortRef.current?.abort()`).
- Beneath the header: the **pipeline strip** (§3).
- Beneath the pipeline: the **steps list** — a vertical list of step rows in stream order.
- The whole card is collapsible via a chevron next to "Thinking…" — collapsed shows just the header + pipeline + the latest step row; expanded shows everything. Default expanded while `isRunning`; auto-collapses 1 second after `final_response`.

### 4.2 Step row layout

Each step row is a single horizontal flex with these slots:

```
[ icon ] [ title + subtitle ]                   [ metadata · status ]
```

- **icon**: 16×16, lucide, color tied to the tool/agent kind (see §5). When running, the icon swaps to a soft 1.5s rotation OR is overlaid with a small pulsing dot in the top-right corner of the icon's bounding box.
- **title**: sentence case, `text-sm font-medium`. Examples: "Searching the web", "Querying federal_contracts_2023" (mono inline for query names), "Drafting the answer", "Checking grounding".
- **subtitle**: `text-xs text-[var(--color-muted)]`, optional, holds the human-readable parameter — the search query string, the entity name for CanLII, the recipe ID for routing, etc. Italicize quoted user-meaningful strings.
- **metadata**: right-aligned, mono, `text-xs`, the row count + timing once known, OR a live token counter for the summarizer.
- **status pill**: 14×14 to the right of the metadata. Three states:
  - **running**: an accent ring with a spinning conic gradient (CSS only — `background: conic-gradient`, animate via `@keyframes spin`).
  - **done**: a green check (`Check` lucide, 12px) on a soft green pill.
  - **failed**: an amber triangle (`AlertTriangle`) on a soft amber pill.
- Sub-rows are indented 24px and connected to their parent with a 1px L-shaped guide line on the left (1px gray vertical from parent's row down to ⌐, then 1px horizontal to the sub-row icon).
- Rows animate in: `opacity 0 → 1, translateY 4px → 0, height 0 → auto` over 160ms ease-out. Removing rows (rare; only on retries) reverses.

### 4.3 Real-time merge logic

This is the part most implementations get wrong. Treat the activity feed as a **state machine** keyed by step IDs, not as `events.map(...)`. Pseudocode:

```ts
type StepKind = 'route' | 'primitive' | 'sql' | 'web' | 'canlii' | 'summarize' | 'verify';
type StepStatus = 'running' | 'done' | 'failed';

type Step = {
  id: string;          // stable across started/completed
  parentId?: string;   // for sql/web/canlii nested under a primitive
  kind: StepKind;
  title: string;
  subtitle?: string;
  metadata?: string;
  status: StepStatus;
  startedAt: number;
  completedAt?: number;
  failure?: string;
  // kind-specific extras
  extras?: Record<string, unknown>;
};
```

Mapping events → step mutations:

- `router_started` → push step `id='route'`, kind=route, status=running, title="Routing your question".
- `router_decision` → resolve step `id='route'`: set status=done, title="Routed via " + `decision`, metadata=mono `recipe_id ?? 'no recipe'`, subtitle=`reasoning_one_line`.
- `primitive_started` → push step `id='prim:${primitive_name}:${counter}'`, kind=primitive, status=running, title=humanize(primitive_name), subtitle=summarizeArgs(args_summary), parentId=undefined.
- `primitive_completed` → resolve the most-recent unresolved primitive with matching name.
- `sql_query_started` → push step kind=sql, parent=current primitive's id, title="Querying " + `query_name` (mono).
- `sql_query_completed` → resolve matching sql step. metadata=`${rows} rows · ${secs}s`.
- `web_search_started` / `_completed` → same pattern. Title "Searching the web", subtitle the query.
- `canlii_started` / `_completed` → same pattern. Title "Searching CanLII for " + entity_name, subtitle the query.
- `summarizer_started` → push id=`summarize`, kind=summarize, status=running, title="Drafting the answer", subtitle=`~${prompt_token_estimate} input tokens`.
- `summarizer_token` → mutate id=`summarize`: increment a tokensReceived extra; set metadata=`${tokensReceived} tokens written`. Throttle this to 4 updates/sec to avoid re-render storms (use `requestAnimationFrame` or a 250ms tick — accumulate tokens between ticks).
- `summarizer_completed` → resolve id=`summarize`. metadata=`${prompt_tokens.toLocaleString()} in · ${completion_tokens.toLocaleString()} out`.
- `verifier_started` → push id=`verify`, kind=verify, status=running, title="Checking grounding".
- `verifier_check` → push a sub-step under id=`verify`, kind=verify, status=pass→done | fail→failed, title=humanize(check), subtitle=details.
- `verifier_completed` → resolve id=`verify`. metadata: `${failures.length} concerns · ${secs}s` or "All checks passed".
- `refinement_filter_applied` → push a slim "note" row (not a full step), italic muted: `Refined ${before} → ${after} rows`.
- `heartbeat` → not rendered. Track lastEventAt; if currentTime − lastEventAt > 10s, set a `stale` flag on the active running step → render "Still working…" caption underneath.
- `error` → resolve the active running step as failed with `failure = data.message`. If `retryable`, show a "Try again" button on the row that re-sends the original user message.
- `final_response` → trigger collapse-to-summary (see §7).

Use a reducer (`useReducer`) for this — it's the cleanest pattern. Export it from `src/components/ship/useActivityFeed.ts` so the answer card can subscribe to the streaming summary tokens too.

---

## 5. Tool / Agent → Icon + Color Mapping

Investigators read by glance. Each kind of step gets a consistent visual signature.

| Step kind | Icon (lucide) | Accent color token | Notes |
|---|---|---|---|
| route | `Compass` | `--color-accent` | The "router agent" decision |
| primitive | `Boxes` | `--color-ink-strong` | Generic agent / recipe primitive |
| sql | `Database` | `--color-success` | A SQL query |
| web | `Globe` | `--color-accent` | Web search |
| canlii | `Scale` | `--color-accent` | CanLII (legal) lookup |
| summarize | `PenLine` | `--color-warning` | The summarizer agent |
| verify | `ShieldCheck` | `--color-success` (pass) / `--color-warning` (concerns) / `--color-risk-high` (failed) | Verifier checks |

Use a thin (`strokeWidth: 1.75`) icon style across the board. Background tints for the icon container should be the accent at ~10% (`bg-[var(--color-accent)]/10` etc.) so they read as quiet badges, not loud chips.

When a step has special semantics — e.g. a primitive with caveats — overlay a small dot on the icon corner: amber for caveats, red for failure.

---

## 6. Reading the Subtitle Right (Copy Rules)

Subtitles do most of the work — they're how the user understands "what is the system doing right now". Be specific, never marketing.

**Examples (good):**

- `Searching the web` — *"recent enforcement actions against XYZ Foundation"*
- `Searching CanLII for XYZ Foundation Canada` — *"section 230 charitable status"*
- `Querying federal_contracts_2023` — `args: { fiscal_year: 2023, dept: "PSPC", min_value: 10000 }`
- `Routed via investigative_lookup` — *"Recipient-focused query with named entity → primary lookup recipe."*
- `Drafting the answer` — `~12,400 input tokens` → during stream: `312 tokens written`
- `Checking grounding` → during stream, sub-rows: `Cited findings exist`, `Numbers match source rows`, `Canonical entities verified`

**Rules:**

1. Quote search queries in italic muted text inside curly typographic quotes (`"…"`). Don't add a colon before them — the quotes are enough.
2. Use sentence case in titles. Mono only for query names (`federal_contracts_2023`), recipe IDs, and column names.
3. Format counts with `toLocaleString()`. Format times as `${(ms/1000).toFixed(1)}s` — no milliseconds shown to the user. Under 0.1s, show "<0.1s".
4. Args summary: pick the 3 most informative key-value pairs from `args_summary` — prefer named entity, year, jurisdiction, threshold, department. Render as `key: value` chips, mono key + sentence-case value.
5. Never show internal jargon like "primitive", "ship", "recipe_run_id" in titles/subtitles. Reserve "recipe" for the optional mono pill on the routed step.
6. Status copy on the header: "Thinking…" while running. After complete, the entire activity card collapses to the summary disclosure (§7).

---

## 7. Post-Completion: "Thought for Xs" Summary Disclosure

When `final_response` arrives:

- Fade the running spinner out, swap to a checkmark.
- Smoothly collapse the activity card to a **single-row summary**:
  - Left: a tiny pipeline mini-bar (4 colored dots representing phase status — green if done, amber if any failure occurred in that phase).
  - Center-left: text `"Thought for ${totalSeconds.toFixed(1)}s"`. Tertiary muted color.
  - Center-right (optional): inline glance metrics: `${primitivesRun} agents · ${sqlCount} queries · ${webSearches > 0 ? webSearches + ' searches' : ''}` — joined by `·`, suppressed when 0.
  - Right: chevron toggle to re-expand.
- Default state: collapsed. The user can re-expand to see the full activity feed at any time. Persist the expanded/collapsed preference for the duration of the conversation in component state (don't persist across reloads).
- When re-expanded after completion, all running spinners are replaced with their final done/failed icon. The pipeline strip stays visible at the top so users can review timings.

This mirrors the ChatGPT/Gemini Pro disclosure model and is the strongest single signal of "this is a polished product."

---

## 8. Animation, Motion, Micro-Interactions

- **Spinner** for running status: a 14×14 SVG with a 270° accent arc rotating at 1Hz. Pure CSS keyframes; no library.
- **Pulsing dot** overlay on running icons: 1.2s ease-in-out, accent at 30% → 60% opacity.
- **Row enter**: opacity 0 → 1, translateY 4px → 0, 160ms ease-out, staggered by 30ms when multiple rows arrive in the same tick.
- **Row resolve** (status: running → done): the spinner crossfades into the check icon over 200ms. The metadata text fades from `…` to the actual value. Don't relayout — reserve space for metadata when running so the row width is stable.
- **Pipeline progress fill**: each connector line fills left-to-right from gray to accent over the phase's actual duration. Use `transition: stroke-dashoffset` on an SVG line.
- **Collapse to summary on completion**: 220ms ease-out height crash + opacity fade of inner content. Then the summary row fades in over 120ms.
- **Reduced motion**: respect `@media (prefers-reduced-motion: reduce)` — disable the spinner rotation (use a static dot), disable row-enter translation (opacity only), instant pipeline fills.
- Never animate font-size, never animate non-composited properties (`width`, `height` only when wrapped in a height-auto crossfade trick). All transforms and opacity.

---

## 9. Edge Cases You Must Handle

1. **Long phases (>10s of silence).** When `lastEventAt + 10s` passes without a new event for the active running step, render a soft caption underneath: `Still working — ${elapsed}s`. Keep the spinner alive. After 30s, the caption upgrades to `This one is taking a while — you can stop it any time` with a subtle fade.
2. **Heartbeats.** `heartbeat` events update `lastEventAt` so the staleness logic resets, and update the elapsed counter on the active step.
3. **Out-of-order events.** Backend may emit `primitive_completed` before its `sql_query_completed` if the SQL was the only thing the primitive did. Merge tolerantly: `primitive_completed` resolves the parent primitive, and any unresolved children should auto-resolve (status=done) inheriting the parent's row_count/timing if their own metadata never arrived.
4. **Parallel primitives.** A retrieve phase may run multiple primitives simultaneously. Render each as its own top-level step in the order their `_started` arrives. Show a small `2 running` chip on the Retrieve pipeline pill while >1 primitive has status=running.
5. **Errors mid-stream.** `error` with `retryable=false` resolves the active step as failed, the pipeline strip's current phase pill turns amber, and the activity card stays open with a top-of-card banner: "The run was interrupted. Partial output below." The "Stop" button becomes "Retry" (re-sends the latest user message).
6. **Errors with `retryable=true`.** Don't end the run; show the failed row with an inline "Try again" button that re-emits the same step. Backend will continue once retried (or the user can wait — backend may auto-retry).
7. **Stream closes without `final_response`.** After the SSE reader's `done`, if no `final_response` was seen, render a card-level error and resolve all running steps as failed.
8. **Replay from history.** When the user opens a finished conversation, there are no live events — just the persisted assistant response. In that case render the activity card directly in collapsed-summary form, showing only `Thought for ${response.latency_ms / 1000}s` and (if you can derive them from `recipe_run_id`) the agent/query glance metrics. Clicking re-expand fetches the full `recipe_run` via `getRecipeRun(recipe_run_id)` and reconstructs a synthetic step list from `sql_log`, `findings`, and `verification.checks`. Do this lazily — only on first expand.
9. **Throttle token-counter updates.** `summarizer_token` can fire 30–60 times per second. Accumulate tokens in a ref; flush to state every 250ms via `requestAnimationFrame` or `setInterval` so React re-renders aren't a bottleneck.
10. **Abort cleanly.** If the user clicks Stop, mark the active running step as failed with title "Stopped by user", DO NOT mark prior completed steps as failed, and surface the partial summary if any.

---

## 10. Component Layout (file plan)

Add or replace these files:

- `src/components/ship/ActivityCard.tsx` — the live card (header, pipeline, steps list, summary collapsed state).
- `src/components/ship/PipelineStrip.tsx` — the 4-phase horizontal pipeline.
- `src/components/ship/StepRow.tsx` — one step renderer (icon, title/subtitle, metadata, status pill, sub-row guide lines).
- `src/components/ship/StatusPill.tsx` — a small running/done/failed indicator.
- `src/components/ship/Spinner.tsx` — the conic-gradient spinner (no SVG library).
- `src/components/ship/useActivityFeed.ts` — the reducer that turns `StreamEvent[]` into `{ steps, phases, totals }`.
- `src/components/ship/activityCopy.ts` — humanizers for primitive names, query names, args summaries, phase names. Pure functions, no React.

Delete `src/components/ship/ProgressTrail.tsx` once `ActivityCard` is wired in `ConversationView.tsx` — but keep its `formatEvent` switch as a fallback lookup table inside `activityCopy.ts` if useful.

In `ConversationView.tsx`, replace the inline progress accumulation with the new hook:

```tsx
const activity = useActivityFeed(item.events, {
  isRunning: item.isRunning,
  startedAt: item.startedAt,
  completedAt: item.completedAt,
});

return (
  <div className="space-y-3">
    <ActivityCard
      activity={activity}
      isRunning={item.isRunning}
      onStop={cancelStream}
    />
    {item.response && <AssistantMessageCard ... />}
  </div>
);
```

Keep `ConversationView` orchestrating the SSE; the feed hook is a pure reducer.

---

## 11. Reference Behaviors — Study These Before Coding

In rough order of how closely you should mirror them:

1. **Grok DeepSearch / "Think harder" UI.** The numbered, sequential agent activity card with collapsible details and per-step durations. The way it morphs into "Researched for 24 seconds" is the gold standard.
2. **Perplexity Pro Search.** The "Searching → Reading → Reasoning" phase indicator and the inline source previews as the search proceeds. The pipeline strip in §3 is inspired by this.
3. **ChatGPT tool calls (web search, code interpreter, file search).** Each tool call as its own row with input args visible, output count visible, and a "View" expander. The icon-per-tool pattern is from here.
4. **Gemini Pro "Show thinking".** The collapsible reasoning panel under the answer with phase-grouped reasoning. The collapse-after-completion pattern is from here.
5. **Linear's status indicators.** For the four step statuses (pending / running / done / failed) and the pulsing dot pattern.

You don't need to clone any of them. Borrow the **interaction model** (one-glance status, collapsible details, per-tool icons, post-run summary) and the **information density** (timings, counts, named queries inline). Avoid copying brand color or specific layouts; use this app's tokens.

---

## 12. Acceptance Criteria

Done when **all** observable behaviors hold:

1. While a turn streams, an Activity Card sits above the answer card with: a "Thinking…" header, an elapsed timer ticking every 100ms, a 4-phase pipeline strip showing the active phase pulsing accent, and a vertical list of step rows.
2. Each step row shows a tool-specific icon, a sentence-case title, a meaningful subtitle (search query, query name, recipe id, etc.), live metadata (rows, timings, token counts), and a status pill (running / done / failed).
3. Sub-steps (sql/web/canlii under their primitive) are indented with an L-shaped guide line and resolve independently of their parent.
4. The summarizer step shows a *live* token counter that ticks up as `summarizer_token` events arrive, throttled to ≤4Hz so the UI stays smooth even at 60 tokens/sec.
5. The verifier step shows each `verifier_check` as a sub-row with pass/fail status; the parent verifier resolves with a footer count of concerns.
6. `refinement_filter_applied` renders as a slim italic note ("Refined 12,400 → 3,182 rows"), not as a full step.
7. After 10s of silence on a running step, a "Still working — Xs" caption appears beneath that step. After 30s, it upgrades to a friendlier "This one is taking a while — you can stop it any time."
8. Pressing the "✕ Stop" button in the card header aborts the stream cleanly: the active running step resolves as failed with title "Stopped by user", earlier completed steps remain green, the answer area shows whatever partial summary was streamed.
9. On `final_response`, the card collapses to a single row: a mini pipeline of 4 colored dots, the text "Thought for Xs", glance metrics ("3 agents · 7 queries · 1 search"), and a chevron to re-expand. Re-expansion shows the full feed with all spinners replaced by their final state.
10. On opening a finished historical conversation, the Activity Card appears in collapsed-summary form, derived from the persisted response. Clicking re-expand lazily fetches the full recipe run and renders a reconstructed step list.
11. All step rows animate in with a 160ms opacity+translate; status changes crossfade icons; collapse-on-completion is a 220ms height crash. `prefers-reduced-motion` disables transforms but keeps state changes legible.
12. All step icons match the §5 mapping. All copy follows §6 rules (sentence case, mono only for technical names, localized counts, time formatting).
13. No `tracking-widest`, no `font-black`, no all-caps body text in the Activity Card. Eyebrow labels (≤ 2 words) may use `text-[11px] tracking-[0.14em] uppercase` if needed.
14. No console errors at 60 tokens/sec sustained for 30 seconds. Memory stable (no leaked intervals after stream ends or component unmounts).
15. The SSE protocol in `src/lib/ship.ts` is unchanged; the API contract is unchanged.

---

## 13. Non-Goals

- Don't redesign the answer card, citations, findings table, composer, or sidebar in this pass — they're separate briefs.
- Don't add backend telemetry, websockets, or new event types.
- Don't introduce a state library (Zustand, Redux) — `useReducer` inside the hook is enough.
- Don't add Framer Motion, Lottie, or animation libraries — CSS keyframes only.
- Don't add a UI kit (Radix is acceptable for an `@floating-ui/react` popover if you need one for the args-summary tooltip; otherwise plain divs).
- Don't persist activity-card state to localStorage. Per-turn collapse state lives in component state only.
- Don't implement multi-turn aggregation views ("show me all activity for this conversation"). Out of scope.

---

## 14. Deliverable

A single coherent diff over `src/components/ship/*` (and the small touch in `ConversationView.tsx` to wire it in). Include a short JSDoc on `useActivityFeed` describing the reducer's state shape and the events → mutations contract from §4.3. Match the project's existing TS strictness, no `any`.

Quality bar: a senior engineer reading the code should immediately understand why the activity feed feels alive (state machine + throttled tokens + CSS-only motion) and should not need to ask which event maps to which step row. A user running their first three queries should think the system is more capable than ChatGPT for this domain — because every agent and tool call is named, timed, and traceable in real time.

Now build it.
