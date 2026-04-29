# Frontend Feature 01: Live Token Streaming + Multi-Agent Activity Pipeline

## 0. The Goal in One Sentence

Make the analyst chat *feel alive*: as soon as the user sends a question, a multi-agent activity card materializes with a phase pipeline (Route → Retrieve → Synthesize → Verify), each agent's work appears as a sub-step in real time, the answer prose streams in token-by-token with a blinking caret, and on completion the whole activity card collapses to a tidy "Thought for 12.4s · 3 agents · 5 queries" disclosure on top of the final structured answer card. This is the single most important "wow" moment for the demo.

Hackathon constraints: **2-hour window**, must work end-to-end, no broken paths. Keep it focused.

## 1. Stack and Wire Contract

- React 19, TS strict, Tailwind, lucide-react, `react-markdown` + `remark-gfm` (already installed), `@floating-ui/react`.
- The SSE protocol is **frozen**. We're rendering existing event types better, not adding new ones (the backend prompt covers cadence/flushing).
- The relevant events flowing in:
  ```
  router_started, router_decision,
  phase_started, primitive_started, primitive_completed,
  sql_query_started, sql_query_completed,
  web_search_started, web_search_completed,
  canlii_started, canlii_completed,
  refinement_filter_applied,
  summarizer_started, summarizer_token, summarizer_completed,
  verifier_started, verifier_check, verifier_completed,
  heartbeat, final_response, error
  ```
- `summarizer_token.data.text` is the per-token text that we accumulate into the live prose.

Files in scope:
- `src/components/ship/ActivityCard.tsx` — already exists, needs polish + post-completion collapse.
- `src/components/ship/StreamingAnswerCard.tsx` — **new**, renders the in-flight answer with caret.
- `src/components/ship/ConversationView.tsx` — wire the streaming card.
- `src/lib/streamPhases.ts` — small extensions for sub-step grouping.
- `src/styles.css` — caret keyframe.
- Optional: `src/components/ship/StepRow.tsx` (extracted), `src/components/ship/PhasePill.tsx` (extracted) if it makes the diff cleaner.

## 2. The Streaming Answer Card (NEW)

Create `src/components/ship/StreamingAnswerCard.tsx`:

```tsx
type StreamingAnswerCardProps = {
  events: StreamEvent[];
  summaryDraft: string;
  startedAt: number;
  isRunning: boolean;
  onStop: () => void;
};
```

Render:

1. **Activity card on top** (the existing `ActivityCard` component, expanded by default while running). See §3 for required updates.
2. **Live answer region** — appears the moment the first `summarizer_token` event arrives. Before that, a soft skeleton ("Drafting your answer…") in muted text:
   - When `summaryDraft.length === 0`: show a 3-line skeleton with shimmer.
   - When `summaryDraft.length > 0`: render the prose with `react-markdown` + `remark-gfm`, prose styles `text-[var(--color-ink-strong)] leading-7`, max-width 72ch.
   - At the tail of the streamed prose, render a blinking caret element: `<span className="inline-block w-[2px] h-[1.1em] bg-[var(--color-accent)] align-text-bottom -mb-0.5 animate-caret">&nbsp;</span>`.
   - Auto-scroll the message scroller as new tokens arrive — but ONLY if the user is already at the bottom (use the existing `showLatestPill` logic in `ConversationView`; if `showLatestPill` is true, do not auto-scroll).
3. **No findings table, no citations, no caveats, no message actions during streaming.** Those appear with the structured `AssistantMessageCard` after `final_response`.

Animation: when `final_response` lands, the streaming card unmounts and `AssistantMessageCard` mounts in its place. Wrap both in a wrapper with `transition: opacity 200ms ease`. To avoid layout pop, ensure the streaming-card prose width matches the final-card prose width (same `max-w-[72ch]` container).

Add to `src/styles.css`:

```css
@keyframes caret-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
.animate-caret { animation: caret-blink 1s steps(1, end) infinite; }
@media (prefers-reduced-motion: reduce) {
  .animate-caret { animation: none; opacity: 1; }
}
```

Throttle re-renders of the streaming prose. `summarizer_token` may fire 30–60×/sec. Inside `StreamingAnswerCard`, accumulate `summaryDraft` into a ref and flush to a `useState` snapshot on a 60ms `setInterval` (or `requestAnimationFrame`) so React re-renders ≤ ~16Hz.

## 3. Activity Card Polish

The existing `src/components/ship/ActivityCard.tsx` works but needs sharpening for the demo. Do all of:

### 3.1 Phase labels (drop the bad "Audit" label and the uppercase shouting)

Replace the four steps with the correct names and stop using `tracking-wider uppercase` on the labels:

```ts
const STEPS: StepSpec[] = [
  { id: 'route',       label: 'Route',       icon: Compass },
  { id: 'retrieve',    label: 'Retrieve',    icon: Database },
  { id: 'synthesize',  label: 'Synthesize',  icon: PenLine },
  { id: 'verify',      label: 'Verify',      icon: ShieldCheck },
];
```

Update the `phaseMap` in `useMemo` so `synthesize` no longer maps to a step called `audit`.

Step label rendering: `text-[11px] font-medium` (NOT uppercase). Active step is `text-[var(--color-accent)]`, others `text-[var(--color-muted)]`.

### 3.2 Sub-step nesting under Retrieve

The current activity-detail list shows the last 6 events flat. Restructure so retrieve-phase children nest under their parent primitive:

- A `primitive_started` opens a top-level row keyed by `primitive_name`.
- Subsequent `sql_query_*`, `web_search_*`, `canlii_*` events whose ordering puts them after that primitive_started become indented sub-rows under it (24px indent, 1px L-shaped guide line).
- `primitive_completed` marks the parent done with `${row_count} rows · ${(timing_ms/1000).toFixed(1)}s` metadata.
- `sql_query_completed` marks the matching sql sub-row done with `${row_count} rows · ${secs}s`.
- `web_search_completed` / `canlii_completed` likewise.

Use this helper in `streamPhases.ts`:

```ts
export type ActivityStep = {
  id: string;
  kind: 'route' | 'primitive' | 'sql' | 'web' | 'canlii' | 'summarize' | 'verify' | 'verify_check' | 'note';
  parentId?: string;
  title: string;
  subtitle?: string;
  metadata?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  completedAt?: number;
};

export function buildActivitySteps(events: StreamEvent[]): ActivityStep[] { … }
```

Each `kind` gets a different lucide icon:

| kind | icon |
|---|---|
| route | Compass |
| primitive | Boxes |
| sql | Database |
| web | Globe |
| canlii | Scale |
| summarize | PenLine |
| verify | ShieldCheck |
| verify_check | CheckCircle2 |
| note | Filter |

Subtitle copy rules (sentence case, mono only for technical names):
- route: "Routing your question" → on decision, "Routed via {decision}" with `recipe_id` as a small mono pill.
- primitive: humanize `primitive_name` ("vendor_concentration_query" → "Vendor concentration query"). Subtitle = a 1-line summary of `args_summary` (top 2 fields as `key: value`).
- sql: "Querying " + `query_name` (mono inline).
- web: "Searching the web", subtitle = `"{query}"` in italic muted text.
- canlii: "Searching CanLII for {entity_name}", subtitle = `"{query}"`.
- summarize: "Drafting the answer". Subtitle = `~${prompt_token_estimate.toLocaleString()} input tokens` while running.
- verify: "Checking grounding".
- verify_check: humanize `check`. Subtitle = `details`.
- note (refinement_filter_applied): `Refined ${before_count.toLocaleString()} → ${after_count.toLocaleString()} rows` italic muted.

### 3.3 Live "Now: …" line

Below the pipeline strip, when running, show a one-line "Now: …" headline derived from the latest non-token event using the existing `formatLatestEvent` helper. Keep it sentence case. Drop the existing animate-pulse loop — instead use a tiny inline 3-dot animation:

```tsx
<span className="inline-flex gap-0.5">
  <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:-0.3s]" />
  <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce [animation-delay:-0.15s]" />
  <span className="size-1 rounded-full bg-[var(--color-accent)] animate-bounce" />
</span>
```

### 3.4 Live token counter on Synthesize

Track total `summarizer_token` events received this turn. While `summarize` step is running, set its metadata to `${tokensReceived} tokens written`. Throttle to 4Hz so we don't thrash the DOM.

### 3.5 Heartbeat staleness

If `lastEventAt + 10s < now` while a step is running, show a soft caption beneath the active step: `Still working — ${elapsedSec}s`.

### 3.6 Post-completion collapse

When `final_response` lands (or `events` includes it), the activity card auto-collapses **after a 600ms delay** to a single summary row:

```
[ ✔ Thought for 12.4s ]   ·   3 agents · 5 queries · 1 search   ·   [ Show details ▾ ]
```

- `12.4s` from `(completedAt - startedAt) / 1000`.
- `3 agents` = unique primitive_completed count.
- `5 queries` = sql_query_completed count.
- `1 search` = web_search_completed + canlii_completed count (suppress if 0).
- Click "Show details" re-expands. State is component-local (per-turn).

### 3.7 Stop button

While running, show a small ghost "Stop" button in the activity card header (right side) that calls the same abort path as the composer's stop. Use the existing `cancelStream` from `ConversationView` (pass it as a prop).

## 4. ConversationView Wiring

Patch the assistant-item render path:

```tsx
{item.role === 'assistant' && (
  <div className="space-y-3">
    {item.isRunning ? (
      <StreamingAnswerCard
        events={item.events}
        summaryDraft={item.summaryDraft}
        startedAt={item.startedAt}
        isRunning={item.isRunning}
        onStop={cancelStream}
      />
    ) : (
      <>
        {item.events.length > 0 && (
          <ActivityCard
            events={item.events}
            isRunning={false}
            startedAt={item.startedAt}
            completedAt={item.completedAt}
            onStop={cancelStream}
          />
        )}
        {item.response ? (
          <AssistantMessageCard
            response={item.response}
            onPrefill={prefillComposer}
            onSend={(content) => void submitMessage(content)}
            onStartNewConversation={onStartNewConversation}
            onDismiss={dismissMessage}
            onRegenerate={() => regenerateAssistantResponse(item.id)}
          />
        ) : item.errorMessage ? (
          /* existing error path */
        ) : null}
      </>
    )}
  </div>
)}
```

Important: when reloading a historical conversation (events empty, response present), `ActivityCard` should not render with empty events. Skip rendering when `events.length === 0`. The `AssistantMessageCard`'s own `Thought for Xs` is enough for replayed messages (we already have it; verify it still renders post-refactor).

## 5. Acceptance Criteria

Reload the schools URL, send "which schools received funding in 2024?", and observe — within ~3 seconds:

1. A user-message bubble appears (right-aligned, soft accent tint).
2. An ActivityCard appears with 4 phase pills; the **Route** pill becomes accent-active and the "Now: Routing" line shows under the pipeline.
3. Within ~1s, the Route pill turns green-done, **Retrieve** pill goes accent-active. A primitive row appears titled e.g. "Sole source amendment query"; an indented `sql` sub-row appears titled `Querying federal_contracts_2023` with a running spinner.
4. As `sql_query_completed` arrives, the sub-row resolves to `12,400 rows · 1.2s`. If a web search runs, a `Globe` sub-row appears.
5. **Synthesize** pill activates; a "Drafting the answer" row shows; the metadata becomes `~9,400 input tokens`.
6. The instant the first `summarizer_token` arrives, an answer prose region appears below the activity card, growing letter-by-letter, ending in a blinking accent caret. Markdown formatting is rendered (bold, lists). Re-renders are throttled — text is smooth, not janky.
7. Live token counter on the Synthesize step ticks up (`312 tokens written`).
8. **Verify** pill activates near the end; sub-rows for each verifier check pass/fail.
9. On `final_response`, the streaming card unmounts (200ms fade), the structured `AssistantMessageCard` mounts (with headline, table expanded for list-shape, citations, etc.), and the ActivityCard collapses (600ms delay) to a single `Thought for 12.4s · 3 agents · 5 queries` summary row at the top of the answer.
10. Pressing the Stop button at any time aborts the stream cleanly: the active step resolves as failed with title "Stopped by user", earlier completed steps stay green, and any partial summary draft is preserved as a faded note above the structured-card slot.
11. Auto-scroll: while at the bottom, new tokens push the scroller to the bottom; if the user has scrolled up (the "↓ Latest" pill is visible), tokens DO NOT yank them down.
12. Reduced motion: `prefers-reduced-motion: reduce` disables the caret blink, the 3-dot bounce, and any slide-in transitions; status changes still happen, just without animation.
13. No console errors at sustained 60 tokens/sec for 30 seconds; no memory leaks (verify intervals clean up on unmount).

## 6. Non-Goals (so we don't blow the budget)

- Don't rebuild the full step tree from a reducer; the activity card can re-derive from events on each render given throttled re-renders.
- Don't add a separate state library.
- Don't ship dark mode in this pass.
- Don't add per-step expansion of args/SQL preview; the existing SQL drawer is enough.
- Don't change the SSE protocol or any backend types.
- Don't replace `react-markdown`; tune what's already there.
- Don't add a confidence ring inside the streaming card — that lives in the post-completion `AssistantMessageCard`.
- Don't worry about historical-message replay events; `events: []` for old turns is fine.

## 7. Order of Operations (45-minute build)

1. (5 min) Drop `tracking-wider uppercase` from `ActivityCard` step labels. Rename Audit → Synthesize. Verify it still compiles.
2. (5 min) Add the caret keyframe to `styles.css`.
3. (10 min) Build `StreamingAnswerCard.tsx` with throttled `summaryDraft` rendering + caret + skeleton.
4. (5 min) Wire `ConversationView` to render `StreamingAnswerCard` while `isRunning`, falling back to `ActivityCard + AssistantMessageCard` after.
5. (10 min) Add `buildActivitySteps()` to `streamPhases.ts` and rewire the activity detail list to use nested sub-rows with the icon mapping in §3.2.
6. (5 min) Add the post-completion auto-collapse + summary line in §3.6.
7. (5 min) QA on the schools URL; screenshot.

If you hit 30 minutes and only have steps 1–4 done, ship that — it's still a transformative win.
