# Brief: Redesign the Accountability Analyst Chat UI

## 1. Your Role

You are a senior product designer and front-end engineer. Your job is to take the existing Accountability Analyst chat interface (a React + TypeScript + Tailwind app) and redesign it into a polished, modern agentic chat experience that feels at home alongside ChatGPT, Gemini, and Grok — while preserving the gravity of an investigative tool.

You will produce **production-ready React/TypeScript code**, not a Figma mock. You may add small, well-justified utility libraries, but the stack stays React 18, TypeScript, Tailwind CSS, react-query, react-router-dom, and lucide-react icons. The streaming SSE protocol and all backend types must remain untouched.

The output should land as edits to existing files (and a small number of new components). Match the project's existing TS conventions.

---

## 2. Project Context

The product is **Accountability Max** — an investigation platform for Canadian public-money accountability (federal grants, contracts, charities, governance networks, vendor concentration, zombie recipients, funding loops, adverse media, etc.). Investigators, journalists, and policy analysts use it to inspect recipients of public funds, surface anomalies, and build evidence trails.

The "Accountability Analyst" surface (this brief) is the agentic chat. A user types a question; a backend service (`ship`) streams events back: it routes to a recipe, runs SQL primitives against several open datasets, may search the web or CanLII, drafts a grounded answer with verifiable citations, runs a verifier, and returns a structured response.

Users expect:
- **Trust.** Every claim must be traceable to a finding row, an SQL query name, or a URL.
- **Speed of comprehension.** Investigators scan, they do not read carefully on the first pass.
- **Calm authority.** It is a serious tool. It is not the IRS website circa 1998.

The current UI works correctly but reads like a 1980s government terminal: shouty all-caps, "FORENSIC THREAD", "OFFICIAL SHIP SERVICE", "EXECUTE", "ABORT". It is functional but cold, retro, and missing virtually all of the modern agentic-chat affordances (in-place streaming, suggested follow-ups, sidebar date grouping, hover-preview citations, sticky composer with stop button, message actions, etc.).

---

## 3. The Brief, in One Paragraph

Rebuild the chat surface so that it feels like ChatGPT or Gemini in interaction model, with the visual restraint of Linear or Bloomberg Terminal Lite, while keeping the investigative semantics (citations, verification, recipes, findings tables) front and center. Replace the all-caps "forensic" copywriting with calm, professional, journalist-grade prose. Make streaming visible, in-place, and reassuring. Make the composer feel modern. Make sources tactile. Make the sidebar useful.

---

## 4. Codebase You Are Working In

Stack: React 18, TypeScript strict, Tailwind, react-query v5, react-router-dom v6, lucide-react.

The route is **`/accountability`** (and `/accountability/:conversationId`). The nav label is "ANALYST" but in product copy it is the **Accountability Analyst**.

Files you will own / touch:

| File | Lines | Role |
|---|---|---|
| `src/routes/AccountabilityPage.tsx` | ~170 | Page shell, sidebar + main split, blank-state CTA, holds `CatalogModal` and conversation creation |
| `src/components/ship/ConversationList.tsx` | ~160 | Left sidebar — list of past conversations, "New" button, refresh |
| `src/components/ship/ConversationView.tsx` | ~550 | The thread itself: history + live items + composer + abort + auto-send + draft injection |
| `src/components/ship/AssistantMessageCard.tsx` | ~480 | Renders the four assistant response variants (Answer, Clarification, New Conversation, Not Answerable), embeds verification, findings table, SQL drawer |
| `src/components/ship/ProgressTrail.tsx` | ~145 | Streaming "thinking" log (router_started, sql_query_*, summarizer_*, verifier_*, etc.) |
| `src/components/ship/CitationChip.tsx` | ~65 | One chip — points to a finding index, an SQL query name, or a URL |
| `src/components/ship/FindingsTable.tsx` | ~180 | Sortable table of finding rows; currency / percent / URL formatting; row highlight from citation |
| `src/components/ship/CatalogModal.tsx` | ~105 | Modal listing recipe specs and example questions |
| `src/lib/ship.ts` | ~492 | API client + types + SSE stream parser. **Do not change exported function signatures.** |
| `src/styles.css` | (existing) | Design tokens — `--color-accent`, `--color-ink-strong`, `--color-muted`, `--color-success`, `--color-warning`, `--color-risk-high`, `--color-risk-low-soft`, `--color-risk-medium-soft`, `--color-risk-high-soft`, `--color-border`, `--color-border-soft`, `--color-bg`, `--color-surface`, `--color-surface-subtle`, `--color-accent-soft`, `--color-accent-hover`, plus utility classes `app-card`, `section-title`, `metric-value`, `interactive-surface`, `signal-badge-low`, `signal-badge-medium`, `signal-badge-info`, `icon-sm`, `icon-md`, `icon-tile` |

The chat lives inside an outer app shell with a sticky top bar (brand + system status) and a left nav rail. **Don't touch the outer shell** in `src/App.tsx`, except to refine spacing if it conflicts with your full-bleed chat layout (the outer route already lets `/accountability` render `w-full` without the `max-w-7xl` clamp).

---

## 5. Hard Constraints — Do Not Change

These are contracts. The redesign must continue to handle every shape below.

### 5.1 Assistant response variants

```ts
type AssistantResponse =
  | AnswerResponse
  | ClarificationResponse
  | NewConversationResponse
  | NotAnswerableResponse;

type AnswerResponse = {
  type: 'answer';
  message_id: string;
  recipe_run_id: string;
  based_on_run_id: string | null;
  summary: {
    headline: string;
    paragraphs: { text: string; citations: Citation[] }[];
    caveats: string[];
  };
  findings_preview: Record<string, unknown>[]; // small preview rows
  verification: {
    status: 'pass' | 'failed';
    failures: string[];
    checks: {
      paragraphs: number;
      cited_findings: number;
      cited_sql: number;
      numbers: number;
      canonical_entities_seen: number;
      canonical_entities_verified_in_text: number;
      web_urls_checked: number;
      total_latency_ms: number;
      latency_budget_ms: number;
    };
  };
  latency_ms: number;
};

type Citation = {
  finding_index: number | null;
  sql_query_name: string | null;
  url: string | null;
};

type ClarificationResponse = {
  type: 'clarification_needed';
  message_id: string;
  headline: string;
  reason: string;
  suggested_narrowings: string[];
  example_refinements: string[];
  proceed_phrase: string; // e.g. "Run the broad scan anyway"
};

type NewConversationResponse = {
  type: 'needs_new_conversation';
  message_id: string;
  reason: string;
  suggested_starter: string;
  current_conversation_topic: string;
};

type NotAnswerableResponse = {
  type: 'not_answerable';
  message_id: string;
  message: string;
};
```

### 5.2 Stream events (in order, roughly)

```ts
type StreamEvent =
  | { name: 'router_started';        data: {} }
  | { name: 'router_decision';       data: { decision: string; recipe_id: string | null; reasoning_one_line: string } }
  | { name: 'phase_started';         data: { phase: string } }
  | { name: 'primitive_started';     data: { primitive_name: string; args_summary: Record<string, unknown> } }
  | { name: 'sql_query_started';     data: { primitive_name: string; query_name: string } }
  | { name: 'sql_query_completed';   data: { primitive_name: string; query_name: string; row_count: number; timing_ms: number } }
  | { name: 'primitive_completed';   data: { primitive_name: string; row_count: number; caveats: string[]; timing_ms: number } }
  | { name: 'summarizer_started';    data: { prompt_token_estimate: number } }
  | { name: 'summarizer_token';      data: { text: string } }      // <-- streams answer prose
  | { name: 'summarizer_completed';  data: { prompt_tokens: number; completion_tokens: number } }
  | { name: 'verifier_started';      data: {} }
  | { name: 'verifier_check';        data: { check: string; status: 'pass' | 'fail'; details: string } }
  | { name: 'verifier_completed';    data: { status: string; failures: string[]; latency_ms: number } }
  | { name: 'web_search_started';    data: { primitive_name: string; query: string } }
  | { name: 'web_search_completed';  data: { primitive_name: string; query: string; result_count: number; timing_ms: number } }
  | { name: 'canlii_started';        data: { entity_name: string; query: string } }
  | { name: 'canlii_completed';      data: { entity_name: string; case_count: number; timing_ms: number } }
  | { name: 'refinement_filter_applied'; data: { filter: Record<string, unknown>; before_count: number; after_count: number } }
  | { name: 'heartbeat';             data: { elapsed_ms: number } }
  | { name: 'final_response';        data: AssistantResponse }
  | { name: 'error';                 data: { message: string; retryable: boolean } };
```

### 5.3 Public functions in `src/lib/ship.ts`

`createConversation`, `listConversations`, `getConversation`, `sendMessageSync`, `streamMessage`, `getRecipeRun`, `getCatalog`, `deleteConversation`, `getHealthz`, plus type guards. **Signatures are frozen.** Internals can be refactored.

### 5.4 Routes

`/accountability` and `/accountability/:conversationId` continue to work, with the same `state.autoSend` and `state.draft` semantics on navigation.

---

## 6. Core UX Principles (in priority order)

1. **Streaming is in-place, not in a separate log.** When `summarizer_token` events arrive, the assistant's actual answer prose grows letter-by-letter inside the message bubble, with a soft blinking caret. The phase events ("Routing your question…", "Querying federal_grants_recipient…") collapse into a small **"Thought for 12.4s"** disclosure pinned to the top of the assistant message — the way ChatGPT and Gemini Pro present reasoning. This is the single biggest perceived-quality win.
2. **Calm copy. No shouting.** Body text is sentence-cased. Buttons read "Send", "Stop", "Try again" — not "EXECUTE", "ABORT", "RETRY OFFICIAL INQUIRY". Reserve `uppercase` for *short* eyebrow labels (≤ 2 words) and section dividers. Never `tracking-widest` on running text.
3. **Every action is one keystroke or one click away.** Cmd/Ctrl+Enter sends. ↑ at empty composer recalls the last user message into the editor. Esc cancels streaming. `/` focuses the composer from anywhere.
4. **Citations are tactile and explorable.** Inline numeric superscripts `[1]` `[2]` in the prose, with hover-cards previewing the cited finding row or SQL name. Clicking opens the right context (scroll-to-row, drawer, or external URL).
5. **Continue the thread.** After every successful answer, surface 2–4 *suggested follow-ups* derived from the answer itself (entities mentioned, time periods, related recipes). One click sends them.
6. **Empty states sell the feature.** The blank chat doesn't say "AWAITING GROUNDED INQUIRY"; it says "Ask anything about Canadian public spending" with 4–6 example tiles grouped by category, pulled from the catalog.
7. **The sidebar is a workspace, not a list.** Conversations group by recency ("Today", "Yesterday", "Previous 7 days", "Earlier"), are searchable by Cmd/Ctrl+K, support hover-actions (rename, delete, pin), and show a 1-line preview.
8. **No layout jumps.** Reserve space for streaming content. New events animate in via opacity/translate, not by rearranging existing DOM.
9. **The investigative gravitas is in the *information density*, not in the typography.** Show the verification state, source datasets, recipe IDs, latencies, row counts — but in calm, secondary-text colors. Let the data carry the seriousness.

---

## 7. Surface-by-Surface Requirements

### 7.1 Page shell and layout

- Two-pane layout on `xl+`: 280–300px sidebar (collapsible to 64px rail), elastic main column. On `lg` and below, sidebar becomes a slide-in sheet triggered from a hamburger in the chat header.
- Chat header is **slim** (~52px), sentence-case title, subtle subtitle. Move the SHIP health pill to a quiet status indicator (small dot + "Connected" / "Reconnecting…" / "Offline") next to the title, not a screaming colored capsule.
- Main column fills the viewport; the message scroller and composer are the only two regions inside it.
- The composer is **sticky to the bottom** of the main column with a subtle backdrop-blur so messages can scroll under it.
- A floating "**↓ Latest**" pill appears at the bottom-right of the message scroller when the user scrolls up more than ~200px, returning them to the live edge with one click.
- Center messages in a max-width column (~768px) like ChatGPT, with extra room reserved on the right for citation hover-cards on wide screens.

### 7.2 Conversation sidebar (`ConversationList.tsx`)

- Top: a thin search input with placeholder "Search conversations" (icon left, ⌘K shortcut hint right). Filters the visible list locally on title text.
- Below: a primary "**+ New conversation**" button (full width, accent fill, single-tone — not the heavy black-uppercase pill).
- Conversation entries are grouped under sticky-positioned light-gray section labels: **Today / Yesterday / Previous 7 days / Previous 30 days / Earlier**. Compute groups locally from `updated_at`.
- Each row: title (truncated, two-line max, sentence-case fallback "Untitled investigation"), metadata row underneath in muted text — `${message_count} messages · ${relativeTime}`. No "SEGMENTS" jargon.
- Active row: 3px accent left border, soft accent-tinted background, slightly darker title color. No `shadow-inner`.
- Hover row: reveal a kebab menu on the right with Rename / Pin / Delete. Rename is in-place (double-click also enters rename). Delete prompts a small inline confirmation popover with a 4-second undo toast in the corner of the page (do not use `window.confirm`).
- Pinned conversations live in a top **Pinned** section above Today.
- Loading: 5 skeleton rows. Error: a single inline card with a retry link, not a red panel.
- Refresh button is a quiet ghost icon button in the section header. No animated spin unless actually fetching.

### 7.3 Empty state — no conversation selected (in `AccountabilityPage.tsx`)

- A centered hero, max-width ~640px.
- Eyebrow label "Accountability Analyst" in muted accent color, sentence-case.
- Headline (display-size, semibold, regular case): **"What would you like to investigate today?"**
- Sub-line: "Ask grounded questions about Canadian public spending — recipients, contracts, governance networks, and more. Every answer is cited."
- A **prompt-tile grid** (2 × 3 or 3 × 2) where each tile shows: a small category icon (use existing lucide icons mapped to challenge themes — `ShieldCheck`, `Network`, `ClipboardCheck`, `Database`, `FileSearch`, `AlertTriangle`), a 1-line example question pulled from the catalog, and a tiny recipe ID footer. Click → starts a new conversation with that question auto-sent.
- Below the grid: a quieter row with two ghost buttons — "Browse all examples" (opens catalog modal) and "Start blank conversation".
- No pulsing badges, no "OFFICIAL USE ONLY" subtitles. The shell already conveys gravity.

### 7.4 Empty state — inside a fresh conversation

When a conversation exists but has no messages, render a **smaller** version of the same prompt-tile grid centered above the composer, plus a single line: "Try one of these, or ask your own question." This replaces the current "AWAITING GROUNDED INQUIRY" panel.

### 7.5 Composer

- **Auto-growing textarea**, 1 line minimum, ~12 lines maximum, then internal scroll. Use `field-sizing: content` where supported, with a JS fallback.
- Rounded `12px` container, 1px border, soft shadow, subtle ring on focus (do not use solid accent border on focus — use a 2px outer ring with the accent color at 30% opacity).
- Placeholder: "Ask about a recipient, program, or risk signal…" — sentence case, single line.
- **Right-side icon-button stack** inside the composer:
  - When idle: a small "Browse examples" book icon (opens catalog), and a primary circular **Send** button (paper-plane icon). Send is enabled only when the trimmed value is non-empty and not streaming.
  - When streaming: replace Send with a **Stop** button (square icon, accent ring style). Pressing Stop aborts the in-flight stream via the existing `AbortController` ref.
- **Keyboard contract:**
  - Enter inserts a newline (textarea default) UNLESS the user has typed something AND modifier-Enter (Cmd or Ctrl + Enter) is pressed → send. Show a subtle hint "⌘↵ to send" at the bottom-right of the composer in muted micro-type.
  - Pressing Enter alone sends only if the user opts in via a small toggle. Default is Cmd/Ctrl+Enter to align with ChatGPT power users; provide a setting toggle in the composer footer ("Press Enter to send"). Persist via `localStorage`.
  - Esc while streaming aborts.
  - Up arrow on an empty composer recalls the last user message text.
  - `/` from anywhere on the page focuses the composer (unless already inside an input).
- **Max-length**: 4,000 chars soft limit. Show character count in muted micro-type when the user passes 80% of the limit.
- The composer surface is sticky and uses `bg-white/80 backdrop-blur` over the message list.
- Below the composer (still inside the sticky region) render a thin status line:
  - Idle: nothing, OR (when applicable) a 1-line "Working on a previous question…" if you ever queue.
  - Streaming: a thin animated progress bar AND the latest phase text from the stream ("Querying federal contracts… 3,182 rows in 1.2s"), max one line, fades in/out as events arrive.

### 7.6 User message rendering

- Right-aligned bubble, max-width 80% of the message column.
- Background: a gentle accent tint (`bg-[var(--color-accent)]/10` or a token equivalent), text in `--color-ink-strong`. Avoid a solid accent fill — it draws too much eye away from assistant output.
- Border-radius asymmetric: large on three corners, smaller on the bottom-right (the "tail").
- On hover, reveal an action row: Edit (pencil), Copy, Resend.
- **Edit** swaps the bubble for a textarea with the original text and Save/Cancel. Saving submits a new turn (do not rewrite history client-side; just send a new message with the edited text and let the user proceed).
- **Resend** sends the same content as a new turn.
- Whitespace and line breaks preserved (`whitespace-pre-wrap`).

### 7.7 Streaming UX — thinking trail (replaces `ProgressTrail.tsx` design)

The current `ProgressTrail` is a separate card above the answer. Replace with this pattern:

- While the assistant turn is streaming, render a compact **"Thinking…" chip** at the top of the message slot. The chip shows the *latest* phase event in plain English ("Routing your question", "Querying federal_grants_recipient", "Verifying citations"), an animated three-dot or shimmer indicator, and the elapsed seconds.
- Once `summarizer_token` events start arriving, the answer prose itself starts streaming **directly inside the assistant card** (see 7.8) below this chip.
- Once `final_response` arrives, the chip transforms into a **collapsible "Thought for 12.4s"** disclosure containing the full ordered event log, exactly as today (timestamps, query names, row counts, timings) — but visually softer: small dots in muted color, monospace recipe IDs, no oversized pills. Default state collapsed for completed turns; auto-expanded only when the user expands it.
- Group events into named *phases* in the expanded view: **Route → Retrieve → Synthesize → Verify**. Each phase is a small heading with the phase elapsed and a status dot (in-progress / done / failed). This is more legible than 30 raw event lines.
- For long-running phases, surface a heartbeat note "Still working — 18s elapsed" once `heartbeat` arrives, but only after 10s of silence.
- Web search and CanLII events appear as their own indented sub-items under the active primitive ("⮡ Searched the web for 'XYZ Foundation' — 12 results in 0.8s").

### 7.8 Assistant message — Answer variant

The Answer card is the heart of the product. It must look like a clean editorial document, not a dashboard.

Structure, top-to-bottom:

1. **"Thought for Xs" disclosure** (per 7.7) — full width, ghost background.
2. **Headline** — the `summary.headline`. Use a serif or display-leaning sans (Inter Tight is fine), `text-2xl`/`text-3xl`, semibold, sentence case (do not force uppercase even if the backend returns it). Trim trailing periods.
3. **Confidence row** — a small inline cluster on its own line directly under the headline:
   - A circular **confidence indicator** (a 16px ring) — full ring in green for `verification.status === 'pass'` with no failures, partial ring in amber if there are caveats or non-zero failures, hollow gray ring with a warning icon for `failed`.
   - Three quiet secondary chips next to it: `${cited_findings} findings`, `${cited_sql} SQL refs`, `${(latency_ms/1000).toFixed(1)}s`. Hover any chip → tooltip with the verifier check counts.
   - On click of the ring, expand a thin panel with the verifier checks dl, identical content to today but redesigned (see 7.15).
4. **Prose body** — `summary.paragraphs[].text`, rendered with **light Markdown support** (bold/italic, links, inline code, ordered/unordered lists, line breaks). Use `react-markdown` with `remark-gfm` and a slim allow-list (no images, no raw HTML). Line-height generous (1.7), max-width ~72ch, color `--color-ink-strong`.
5. **Inline citations** — replace today's external chip rows. After the markdown is rendered, post-process or pre-process so that each paragraph's `citations` are inserted as **inline numeric superscripts** at the END of the paragraph: `[1]` `[2]` `[3]`, in order. Each superscript is:
   - A button with a unique aria-label ("Open citation 1: finding 4").
   - Hovering or focusing it pops a **citation hover-card** (see 7.12) anchored above the chip.
   - Clicking executes the appropriate action (scroll, drawer, external link).
   - If you need fine control over placement, render citations *also* as a small ordered list "Sources" footer beneath the paragraph that listed them, but the inline numerics are required.
6. **Caveats** — if `summary.caveats.length > 0`, render a calm amber-tinted bordered note titled "Caveats" with bullets. Use a single warning icon, no "section title" eyebrow, body text `--color-ink-strong`.
7. **Findings table section** — collapsed by default with a header bar: title "Evidence ({n} findings shown)", and a primary text button "Load full results ({recipe_run_id} →)". On expand, show the table per 7.13. Above the table, render a thin meta strip: recipe ID (monospace, copyable on click), recipe-run ID (smaller, copyable), and a "View raw run" link that opens a side drawer with the JSON.
8. **Suggested follow-ups** — see 7.18.
9. **Footer message actions row** — left-aligned, ghost icon buttons:
   - **Copy** — copies the headline + paragraphs as Markdown to clipboard, with a small "Copied" toast.
   - **Copy as report** — copies a longer Markdown block including headline, paragraphs, caveats, sources list, and a footer with run ID + timestamp.
   - **Regenerate** — re-sends the most recent user message that produced this answer (you'll need to thread that content through; today's `retryContent` covers half of it — extend it).
   - **Permalink** — copies the URL `/accountability/{conversationId}#${message_id}` and scrolls accordingly.
   - **Like / Dislike** — purely cosmetic for now (store nothing); fire a CustomEvent so a future telemetry hook can subscribe. Tooltip: "Send feedback".
10. **Right-side rail** (only on `xl+`) — anchored to the message, offset to the right margin: a tiny vertical "Sources" panel listing every citation as a numbered card. Hovering a number scrolls the inline `[N]` into view. This is the "sticky table of citations" pattern from Gemini Pro.

### 7.9 Assistant message — Clarification variant

- A bordered card, soft amber tint, **but** redesigned to feel like an interactive form, not an alert.
- Headline (regular case, `text-xl`, semibold) + reason paragraph in `--color-ink-strong`.
- "Try one of these refinements" subheading, then `example_refinements` as **interactive chips** that fill the composer on click (and offer a secondary "Send" inline). Treat them as quick-replies with two affordances: Edit (prefill composer) or Send (immediate).
- "Or narrow your scope" subheading, then `suggested_narrowings` as a quiet bulleted list — these are guidance, not buttons.
- Primary CTA: a single button "Run the broad scan anyway" (the `proceed_phrase` rewritten in calm copy). On click, send `proceed_phrase` as the next message.
- A secondary ghost text-button: "Tell me more about why" — toggles a small panel showing `reason` in full (if longer than ~200 chars, truncate by default).

### 7.10 Assistant message — New Conversation variant

- A bordered card with a soft accent tint and a `GitBranch` icon.
- Headline: "This question deserves a fresh thread"
- Body: `reason`, then a "Current topic: {current_conversation_topic}" line in muted text inside a quiet box.
- Two buttons:
  - Primary "Open new conversation with this question" — calls `onStartNewConversation(suggested_starter)`.
  - Ghost "Ask it here anyway" — calls `onSend(suggested_starter)` in the current thread.
- A subtle "Dismiss" icon-button in the top right.

### 7.11 Assistant message — Not Answerable variant

- A muted card, no alarm. Small `Bot` icon left, label "Out of scope" in eyebrow muted text, body `response.message` in regular ink, sentence case.
- Append a soft suggestion footer: "Try the catalog for examples of supported questions." with a small button that opens the catalog modal.

### 7.12 Citation chips and hover-cards (`CitationChip.tsx` redesign)

The current chip is a pill with an icon and a domain. Replace with:

- **Inline numeric superscript** in the prose: `<sup><button>[N]</button></sup>`, where N is the 1-based citation order *within the entire answer*. Style: small (~10px), bold, accent color on hover, `cursor-pointer`, slight underline on focus.
- **Hover/focus card** (anchor with Floating UI or your own; do not pull a heavyweight popover library — Radix or `@floating-ui/react` are both fine):
  - For `finding_index !== null`: card title "Finding {N}", small grid of the row's most informative columns (use a heuristic: the first non-id, non-metadata 4–6 columns), value formatting consistent with `FindingsTable` rules (currency, percent, dates).
  - For `sql_query_name !== null`: card title "SQL · {query_name}", a 6-line max code preview of the query body if available locally (otherwise "Click to view"), and the row count + timing if known from streamed events.
  - For `url !== null`: card title `domainFromUrl(url)`, the full URL truncated, and a "Open in new tab" footer.
- **Click target** dispatches:
  - finding → `onFindingClick(index)` (existing behavior: highlight + scroll), but ALSO open the row's detail in a side panel if available.
  - sql → `onSqlClick(query_name)` → opens the SQL drawer.
  - url → opens in a new tab with `noreferrer noopener`.
- Keyboard: superscripts are tab-stops; Enter activates; Esc closes the hover-card.

### 7.13 Findings table (`FindingsTable.tsx`)

Keep the data model. Improve the visual:

- **Sticky header**, lighter weight type (medium, not black), no `tracking-wider` upcase.
- Sort indicator is a clear up/down chevron, not a generic "ArrowDownUp" — show direction.
- **Column type detection**: the existing currency / percent / hhi rules are fine; add detection for ISO dates → format `YYYY-MM-DD`, and detect booleans → render with a small `Check` / `X` icon.
- **Row hover** highlights the row. Keep the citation-driven outline (current `outline outline-2`), but use a 1px ring with accent color, not a heavy outline.
- **Numeric columns**: right-align values, tabular-nums.
- **URL columns**: keep external-link icon, but truncate long URLs with `text-ellipsis` and tooltip on hover for the full value.
- **Empty state**: the current dashed panel is fine; rewrite copy to "No matching findings."
- **Density toggle** in the table toolbar: Comfortable / Compact (default Comfortable). Affects row padding only.
- **Column visibility menu**: a small chevron in the toolbar that lists all columns with checkboxes. Persist visibility per `tableId` in `localStorage`.
- **CSV export**: a quiet "Download CSV" link in the toolbar.
- Up to ~420px max-height with overflow scroll; show a "Showing 50 of 4,812 — load all" link if `findings_preview` is shorter than the full run, wired to the existing "Show more findings" loader.

### 7.14 SQL drawer

The current drawer is a `fixed inset-0` overlay with a `max-w-2xl` aside. Refine:

- Slide-in from the right with a 200ms ease-out, fade the backdrop in.
- Header: "SQL evidence" eyebrow + the `query_name` as the title (mono).
- Tabs: **Query** (the SQL text, syntax-highlighted with `prism-react-renderer` or a lightweight alternative — pick *one* light theme, do not bring in highlight.js), **Rows** (the existing `FindingsTable` view), **Metadata** (rows count, timing, recipe ID, run ID, parameters from `RecipeRun.params`).
- Footer: a "Copy SQL" button and a "Open run in new tab" link to a future deep view.
- Close on Esc and on backdrop click.

### 7.15 Verification view

Replace today's `<details>` block with:

- A **circular confidence ring** (SVG) — see 7.8 — visible in the answer's confidence row. Color is determined by `status` and `failures.length`.
- Clicking the ring opens an inline accordion panel below the headline (does NOT push down the prose; reserve space). Panel content:
  - One-line status: "Verification passed" / "Verification raised {n} concerns" / "Verification failed".
  - If `failures.length > 0`, a list of failures with each presented as `failure → suggested action` if you can derive a reasonable suggestion (e.g. "Cited entity not in source rows" → "Open the SQL drawer for this finding"); otherwise just the failure text.
  - The full `checks` dl in a 4-col grid on `md+`, 2-col on smaller, with each label sentence-cased ("Cited findings" not "CITED FINDINGS"), value in tabular-nums.
- Don't render this panel inline in every message — only on demand.

### 7.16 Catalog modal (`CatalogModal.tsx`)

- Wider modal (max-w-5xl), slimmer header.
- Left: a **vertical category list** with the catalog's recipe themes (group recipes by an inferred category from `recipe_id` prefix or a manual mapping — be sensible; e.g. "Recipients", "Procurement", "Governance", "Adverse media"). Selecting a category filters the right panel.
- Right: cards per recipe — title (description), recipe ID in mono, "Specificity required" tag if applicable, then example questions as quick-reply chips. Click a chip → callback `onSelectExample(example)` and close.
- A search input at the top filters across recipe descriptions and examples in real time.
- Loading: 3 skeleton cards. Error: a calm inline retry, no red panel.
- Esc closes; backdrop click closes; trap focus inside the modal; return focus to the trigger button on close.

### 7.17 Error states (across the app)

- Replace the panel-style red boxes everywhere. Errors live in **two channels**:
  - **Inline retry cards** for blocking errors (conversation failed to load, stream aborted before completion). The card has a sentence-case title, a one-line explanation, and one primary "Try again" button. Color: `--color-risk-high-soft` background, `--color-risk-high` border-left (4px).
  - **Toasts** (top-right, stack of three, auto-dismiss 5s) for non-blocking failures (catalog fetch failed, ship.health flipped). Implement a tiny toast hook locally; do not import a toast library if you can avoid it. ARIA-live polite.
- Stream interruption: the error message in the assistant slot becomes a friendlier card: "The response was cut off. The partial answer is below — you can resend the question to retry." with the partial summary draft preserved.
- Network down: the header status indicator moves to "Offline — retrying" with a quiet pulse, and the composer disables Send (with tooltip "Reconnect to send").

### 7.18 Suggested follow-ups

- After a successful Answer response, render a row of 2–4 chip-buttons under the message actions, prefixed with a tiny eyebrow "Suggested follow-ups". Each chip click sends the suggestion as a new user turn.
- **Generation**: derive locally from the answer payload — do not call the backend. Heuristics:
  - For each canonical entity in `verification.checks.canonical_entities_seen` (you'll need to extend `ship.ts` to surface entity names — if the API doesn't return them, parse the prose for capitalized noun phrases or named-entity-like tokens), produce templates like "What other public funds did {entity} receive?", "Show governance links for {entity}", "Are there adverse media signals around {entity}?".
  - If recipe was a procurement recipe, suggest "Compare with last 5 fiscal years" / "Show the top 5 vendors in this category".
  - If the answer contained a date range, offer "Extend by 12 months".
  - Always include one generic "Show me the supporting SQL" → opens the SQL drawer for the first SQL query name.
- Limit to 4. Each chip ≤ 80 chars. Sentence case. No exclamation points.

### 7.19 Header bar (chat header)

- Slim (~48px), sentence-case title (`conversationQuery.data?.title || "New investigation"`), small subtitle "Accountability Analyst".
- Right side: a quiet status indicator (SHIP health) + a kebab menu with Rename / Pin / Delete / Copy share link / Export as Markdown.
- Title is editable in-place by clicking it.

---

## 8. Copywriting Overhaul

The single most important change. The current voice is a 1980s government terminal. The new voice is a calm, well-edited investigative product — like FT Alphaville × Linear × ChatGPT.

### 8.1 Tone principles

- **Sentence case everywhere**, with two exceptions: (a) tiny eyebrow labels that are ≤ 2 short words ("Sources", "Caveats", "Verification"), (b) acronyms (HHI, CR4, BN, CRA).
- **Active voice, present tense.** "Querying federal contracts" not "FEDERAL CONTRACTS BEING QUERIED".
- **Short.** Buttons are 1–2 words. Empty-state body ≤ 30 words.
- **Friendly, not folksy.** "Ask anything" yes; "Hey there!" no.
- **Investigative, not threatening.** "Investigation" yes; "Forensic Thread" no. "Ship" is internal jargon — never expose it.
- **Numbers are formatted.** `12,450` not `12450`. `1.2s` not `1247ms`. CAD currency where appropriate.
- **Honesty over swagger.** "Verified against 3 sources" beats "OFFICIAL CITATION CONFIRMED".

### 8.2 Replacement table — apply ALL of these

| Current | Replace with |
|---|---|
| `INITIALIZE ANALYST SESSION` | What would you like to investigate today? |
| `FORENSIC CONSOLE READY` | Accountability Analyst |
| `OFFICIAL ANALYST CONSOLE` | Accountability Analyst |
| `AWAITING GROUNDED INQUIRY` | Ready when you are |
| `OFFICIAL SHIP SERVICE · CACHED FINDINGS ACTIVE` | (delete) |
| `LIVE FORENSIC THREAD` | New investigation |
| `Untitled accountability thread` | Untitled investigation |
| `FORENSIC THREADS` / `Inquiry History` | Conversations |
| `NEW INQUIRY` | + New conversation |
| `NEW CONVERSATION` | + New conversation |
| `INQUIRY CATALOG` / `OPEN RECIPE CATALOG` | Browse examples |
| `OFFICIAL INQUIRY COMPOSER` | (delete the label entirely) |
| `ENTER INQUIRY REGARDING RECIPIENTS, PROGRAMS, OR RISK SIGNALS...` | Ask about a recipient, program, or risk signal… |
| `EXECUTE` | Send |
| `PROCESSING` | (replace with the streaming phase text) |
| `ABORT` | Stop |
| `RETRY OFFICIAL INQUIRY` | Try again |
| `RETRY CONNECTION` | Try again |
| `RETRY CATALOG` | Try again |
| `RETRY` | Try again |
| `SHIP ONLINE` | Connected |
| `SHIP UNAVAILABLE` | Offline |
| `CHECKING SHIP` | Reconnecting… |
| `SYSTEM ONLINE` (header) | Connected |
| `OFFICIAL USE ONLY · Secure Portal` (header) | (keep but downplay — sentence case "Official use" is fine, drop "Secure Portal") |
| `Audit Posture · Active Investigation` | (sidebar footer — keep label, sentence case) |
| `CATALOG UNAVAILABLE` | Couldn't load examples |
| `STREAM INTERRUPTED` / `ANALYST STREAM TERMINATED BEFORE RESPONSE COMPLETION.` | The response was cut off |
| `CONNECTION ERROR` / `SHIP CONVERSATION COULD NOT BE RETRIEVED.` | Couldn't load this conversation |
| `AWAITING ANALYST RESPONSE FROM SHIP BACKEND...` | (delete; the streaming card replaces it) |
| `${count} SEGMENTS` | ${count} messages |
| `Routing your question...` | Routing |
| `Querying ${query_name}...` | Querying ${query_name} |
| `Started ${phase}.` | (use phase name capitalized, no period) |
| `Final response received.` | Done |
| `Verification ${status}` (badge) | Verified / Caveats / Failed |
| `Grounding failures` | Grounding concerns |
| `Refined from run ${id}` | Refined from a previous run |
| `OFFICIAL CITATION CONFIRMED` (if present) | Verified |
| `Forensic` (anywhere) | Investigation / Investigative |
| `Inquiry` (anywhere) | Question / Query |
| `Run the broad scan anyway` | Run it broadly anyway |
| `Start a new conversation for this question` | This question deserves a fresh thread |
| `Stay in this conversation` | Ask it here anyway |
| `Verification pass` | Verified |
| `Verification failed` | Verification raised concerns |
| `Specificity required` (badge) | Needs specifics |
| `What can I ask?` (catalog header) | Browse example questions |

Audit your final implementation: there should be **zero occurrences** of "FORENSIC", "SHIP" (in user copy), "EXECUTE", "ABORT", "OFFICIAL" (except the existing header chip), "INQUIRY" (other than perhaps "inquiry" sentence-cased in a hover), and **zero `tracking-widest` on any text > 16 chars**.

### 8.3 Microcopy rules

- Empty composer placeholder: `Ask about a recipient, program, or risk signal…`
- Composer keyboard hint: `⌘↵ to send`
- "Working" inline status while streaming: derive from the latest event using the existing `formatEvent` rewritten to sentence-case ("Querying federal_grants_recipient" / "Verifying citations" / "Drafting answer").
- Confidence chips: `${n} findings`, `${n} sources`, `${n} SQL refs`, `${seconds}s`.
- Suggested follow-ups eyebrow: `Suggested follow-ups`.
- Toast on copy: `Copied to clipboard`.

---

## 9. Design Language

### 9.1 Type

- Body and UI: existing system stack is fine, but make sure the chat column uses a tighter weight scale: `font-medium` for body (not `font-bold`), `font-semibold` for emphasis, `font-bold` reserved for headlines and strong labels, **never `font-black`** in chat copy.
- Headline display weight: `font-semibold` at `text-2xl`/`text-3xl` with tracking `-0.02em`.
- No `uppercase` on running text. Eyebrow labels can be uppercase but ONLY for ≤ 2 words and ONLY at `text-[10px]` or `text-[11px]` with `tracking-[0.14em]` (not `0.20em+`).
- Tabular numerals (`font-variant-numeric: tabular-nums`) on all numeric cells, latencies, counts, currency.

### 9.2 Color

- Use existing tokens. Do not introduce new hex values.
- Chat backgrounds:
  - Page background: `--color-bg`.
  - Message column: `--color-surface` or transparent on top of `--color-bg`.
  - User bubble: a soft accent tint (e.g. `--color-accent-soft` or `bg-[var(--color-accent)]/10`).
  - Assistant card: `--color-surface` on `--color-bg`, with a 1px `--color-border` and a subtle shadow (`shadow-sm` is fine).
- Status:
  - Pass / connected: `--color-success` (text only, never solid fills bigger than a 2-3px ring).
  - Caveat: `--color-warning` with `--color-risk-medium-soft` background tint for the caveat box.
  - Failed: `--color-risk-high` with `--color-risk-high-soft` background tint.

### 9.3 Radii and shadows

- Default radius: `8px` (`rounded-lg`). Composer: `12px`. User bubble: `16px / 16px / 16px / 6px`. Modal: `12px`. Avoid `rounded-sm` everywhere — that's the source of the retro look.
- Shadows: prefer single soft layered shadow `shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]` on the composer and floating elements. Static cards: `shadow-sm` or none + a 1px border.

### 9.4 Spacing and density

- Conversation column horizontal padding: `px-6 lg:px-8`.
- Message vertical rhythm: `space-y-6` between turns, `space-y-3` within the assistant card.
- Composer outer padding: `px-4 py-3`. Sticky region top padding: 12px gradient fade.

### 9.5 Motion

- Use CSS transitions only (no Framer Motion). All transitions ≤ 200ms unless noted.
- New message slide-up: `opacity 0 → 1, translateY(8px → 0)` over 180ms ease-out.
- Streaming caret: 1Hz pulse on a `▍` character or a 1.5px-wide div, accent color, fades out at end of stream.
- Hover-card reveal: 100ms fade.
- Drawer slide: 200ms ease-out from right.
- Modal fade: 150ms.
- "Latest" pill: 200ms fade.
- Reduced-motion: respect `prefers-reduced-motion` and disable all non-essential transitions.

### 9.6 Iconography

- All icons from `lucide-react` (already installed). Default size 16px in chips, 20px in primary buttons, 14px in inline contexts. Stroke width 1.75. Never mix icon families.

---

## 10. Accessibility Requirements

- Color contrast: every text/foreground combination must meet WCAG AA (4.5:1 for body, 3:1 for large text). Run mental checks against your token choices.
- Focus rings: every interactive element has a visible focus ring (use `focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 focus-visible:ring-offset-2`). No `outline-none` without a replacement.
- Keyboard:
  - Tab order is logical (sidebar → header → messages → composer).
  - The composer is the natural landing point on entering a conversation.
  - The streaming "thinking" trail is keyboard-expandable.
  - Citation superscripts are tab-stops.
  - Modal and drawer trap focus; Esc closes.
- Aria:
  - The streaming answer region has `aria-live="polite"` and announces only the final headline (not every token — that's noisy). The phase chip has its own polite live region.
  - Status indicator has an `aria-label` describing the state.
  - Toasts use `role="status"` polite.
  - Citation hover-cards are `role="dialog"` with `aria-label` and proper `aria-describedby`.
- Screen-reader-only labels for icon-only buttons (Send, Stop, Copy, etc.).
- Don't communicate state with color alone — pair with an icon or text label everywhere.

---

## 11. Responsive Behavior

- `≥1280px`: two-pane layout with the right-side citations rail visible.
- `1024–1279px`: two-pane, no right rail; citations as inline footers under each paragraph.
- `768–1023px`: sidebar collapses to a 56px icon rail with conversation initials; full sidebar opens as an overlay sheet from the left (slide in 200ms).
- `<768px`: sidebar hidden by default behind a hamburger; composer pinned to bottom; message column padding tightens to `px-4`; suggested-follow-ups stack vertically.
- The composer always reflows correctly to single-column on touch widths.

---

## 12. Implementation Guidance

### 12.1 New files you'll likely add

- `src/components/ship/ThoughtDisclosure.tsx` — the "Thought for Xs" collapsible header with the phase trail.
- `src/components/ship/CitationSuperscript.tsx` — inline numeric citation with a hover-card.
- `src/components/ship/ConfidenceRing.tsx` — SVG ring + accordion panel.
- `src/components/ship/SuggestedFollowups.tsx` — derive + render chips.
- `src/components/ship/MessageActions.tsx` — copy / regenerate / permalink / like / dislike row.
- `src/components/ship/Composer.tsx` — extracted composer with auto-grow, keyboard contract, sticky behavior. Pull all composer logic out of `ConversationView.tsx`.
- `src/components/ship/EmptyState.tsx` — the prompt-tile grid (fetches catalog, picks 6 examples).
- `src/components/ship/SidebarSearch.tsx` — the conversation-list filter + grouping.
- `src/components/ship/Toast.tsx` + `useToast` hook — minimal local toast system.
- `src/lib/markdown.ts` — wrap `react-markdown` with a slim allow-list for use in answer prose.
- `src/lib/streamPhases.ts` — group `StreamEvent[]` into phases (Route / Retrieve / Synthesize / Verify) and synthesize sentence-case status lines.
- `src/lib/followups.ts` — heuristics for suggested follow-ups.
- `src/lib/clipboard.ts` — copy helpers + answer-as-markdown serializer.

### 12.2 Suggested dependencies

- `react-markdown` + `remark-gfm` — Markdown rendering with GFM tables/lists.
- `@floating-ui/react` — citation hover-cards, kebab menus, sidebar tooltips. Light-weight, no theming required.
- `prism-react-renderer` (or a comparable lightweight syntax highlighter) — SQL view in the drawer.
- That's it. Do not add Framer Motion, do not add a UI kit (Radix is acceptable for the modal and dialog primitives if you want them, but plain divs + Floating UI is enough).

### 12.3 ConversationView refactor

The current `ConversationView` is ~550 lines and combines: history fetch, live items, streaming, composer, draft injection, keyboard logic, route-state auto-send, scroll, abort. Split it:

- `ConversationView` (orchestrator) — owns thread state, query, streaming, abort.
- `ThreadList` — renders ordered turns; receives `threadItems`.
- `Composer` — owns text + keyboard + send.
- `useStreamingTurn` — a hook that takes a conversationId and content, returns `{ events, summaryDraft, response, isRunning, error, abort }`. Pure interface; no JSX.

Persist sane behavior of all the existing edge cases: `autoSend` route state, `draftInjection`, dismissed messages, abort on conversation switch. Add tests if you can; if not, walk through each edge case in commit messages.

### 12.4 Streaming text in-place

Today, `summarizer_token` events accumulate in `summaryDraft` and the final answer comes from `final_response`. To stream prose in place:

- While the assistant is running, render the answer card eagerly using:
  - the in-flight `summaryDraft` as the (single) prose paragraph,
  - a placeholder headline ("Drafting answer…" with a shimmer) until the first token arrives, then continue with summaryDraft until `final_response` overrides it,
  - no findings table yet, no citations yet (they arrive on `final_response`).
- A blinking caret at the tail of `summaryDraft` while `isRunning`.
- On `final_response`, swap to the structured rendering (paragraphs, headlines, citations, table). Animate the swap with a 150ms cross-fade so the user sees a smooth handoff.

### 12.5 Phase grouping

In `lib/streamPhases.ts`, fold the raw event list into phases:

- `Route` → `router_started`, `router_decision`.
- `Retrieve` → `phase_started{phase:'retrieve'}`, `primitive_*`, `sql_*`, `web_search_*`, `canlii_*`, `refinement_filter_applied`.
- `Synthesize` → `summarizer_*` (excluding `summarizer_token`, which streams in place).
- `Verify` → `verifier_*`.

Each phase has a status (`pending` / `running` / `done` / `failed`), an elapsed range, and an event list. Render phases as a tidy ordered list inside `ThoughtDisclosure`.

### 12.6 Citation numbering

Pre-compute a flat ordered list of citations across all paragraphs in `final_response.summary.paragraphs`, deduplicate (same `finding_index` or same `sql_query_name` or same `url` should reuse the same number), and produce a map `paragraphIndex → number[]`. Render the inline `[N]` superscripts at the end of each paragraph in the order they appear in `paragraph.citations`. The right-side rail (≥xl) uses the deduped flat list.

### 12.7 Persisted UI state

Use `localStorage` keys under a single `analyst.*` namespace:

- `analyst.composer.enterToSend: '0' | '1'`
- `analyst.sidebar.collapsed: '0' | '1'`
- `analyst.findings.density: 'comfortable' | 'compact'`
- `analyst.findings.columns.${tableId}: string` (JSON)
- `analyst.toasts.dismissed.${id}: '1'` (where useful)

### 12.8 What NOT to break

- Existing `streamMessage(conversationId, content, onEvent, signal)` semantics — keep using `AbortController`; cancel on conversation switch and on Stop.
- `responseFromHistoryMessage` for restoring history — keep its shape.
- `messageContentText` fallback for non-string content.
- Routing: `/accountability` and `/accountability/:conversationId` continue to work, including `state.autoSend` and `state.draft`.
- No backend changes.

---

## 13. Reference Behaviors (study these)

When in doubt, mirror these patterns:

- **Streaming + thinking disclosure**: ChatGPT (gpt-5/o1), Gemini Pro "Show thinking", Anthropic claude.ai. The pattern is: the answer streams in place, the model's reasoning lives in a collapsible header that says "Thought for Xs".
- **Composer**: ChatGPT — auto-grow, soft shadow, send button as small icon, stop button replaces send during streaming, keyboard hint visible.
- **Empty state**: ChatGPT new conversation screen — centered headline, 4 suggestion cards. Gemini's similar pattern with category icons.
- **Sidebar grouping**: ChatGPT date sections, Linear's hover actions on rows, Notion's pinned section.
- **Citation hover-cards**: Perplexity's source previews; Gemini's superscript citations with hover preview.
- **Suggested follow-ups**: Gemini's "Try asking" chips below the answer; ChatGPT's "Continue" suggestions.
- **Confidence ring**: Linear's status indicators, Stripe's risk score widget.
- **Toasts**: Linear's bottom-right stack with subtle animation.
- **Drawer**: Stripe's right-slide-in.

You don't need to re-implement those products. Borrow the *interaction model* and *visual restraint* — not the brand.

---

## 14. Acceptance Criteria

The redesign is done when **all** of the following are observable:

1. A user lands on `/accountability` (no conversation selected) and sees a centered headline, 4–6 prompt tiles drawn from the catalog, and two ghost actions ("Browse all examples", "Start blank conversation"). No all-caps body text. No "INITIALIZE ANALYST SESSION".
2. Clicking a prompt tile starts a new conversation and auto-sends the prompt; the user lands on the conversation with the streaming UI active.
3. While streaming: the user sees a "Thinking…" chip with the latest phase ("Querying …", "Verifying citations…") and an elapsed counter. As `summarizer_token` events arrive, the answer prose grows in place inside the assistant card with a blinking caret. Pressing Stop or Esc aborts cleanly.
4. On `final_response`: the chip transforms into a "Thought for Xs" collapsed disclosure; the prose renders as Markdown; inline `[1] [2] …` superscripts appear at the end of paragraphs; a confidence ring + chips show; the findings table is collapsed under a header; suggested-follow-up chips appear; a footer message-actions row offers Copy / Copy as report / Regenerate / Permalink / Like / Dislike.
5. Hovering an inline `[N]` citation superscript shows a card previewing the finding row (or SQL query name, or URL). Clicking does the right thing.
6. The composer auto-grows, has a placeholder reading "Ask about a recipient, program, or risk signal…", a circular send button, a stop button while streaming, a keyboard hint "⌘↵ to send", and persists the Enter-to-send preference across reloads.
7. The sidebar shows conversations grouped by Today / Yesterday / Previous 7 days / Previous 30 days / Earlier; each entry has a kebab menu with Rename / Pin / Delete; renaming is in-place; Cmd/Ctrl+K focuses the search field; Cmd/Ctrl+/ opens conversation actions.
8. The chat header is slim, sentence-cased, with a quiet status indicator (Connected / Reconnecting / Offline). No "FORENSIC" anywhere.
9. The catalog modal has a vertical category list, a search field, and example chips that fill or send.
10. The clarification, new-conversation, and not-answerable variants are redesigned per 7.9–7.11; users can act with one click on a refinement chip.
11. The findings table has a sticky header, sort with explicit direction icons, density toggle, column visibility menu, and a Download CSV link. Currency, percent, dates, and booleans are formatted.
12. The SQL drawer slides in from the right, has Query / Rows / Metadata tabs, syntax-highlighted SQL, and a copy button.
13. Errors live in toasts (non-blocking) and inline retry cards (blocking). No red full-width alarm panels. Friendly copy throughout.
14. All interactive elements have visible focus rings; the streaming region uses `aria-live`; reduced-motion is respected.
15. **Zero occurrences** in the rendered chat UI of: `FORENSIC`, `SHIP` (in copy), `EXECUTE`, `ABORT`, `INQUIRY` (uppercased), `INITIALIZE`, `OFFICIAL ANALYST`, `tracking-widest` on running text. Run `git grep -nE 'FORENSIC|EXECUTE|ABORT|INITIALIZE'` in `src/components/ship` and `src/routes/AccountabilityPage.tsx` and confirm it's empty.
16. Mobile (≤640px): the sidebar is hidden behind a hamburger; the composer is sticky; the answer card is comfortable to read; suggested-follow-ups stack vertically.

---

## 15. Non-Goals (do NOT do these)

- **Do not** change `src/lib/ship.ts` exported function signatures or alter the SSE protocol.
- **Do not** remove or rename the `/accountability` routes.
- **Do not** rebrand Accountability Max or change the outer app shell, header logo, or left nav rail.
- **Do not** introduce a UI kit or design system library that imposes its own theming (no Material UI, Chakra, Mantine, Ant Design). Tailwind + Floating UI is the toolkit.
- **Do not** add file uploads, voice input, multi-modal, or model-switching toggles in the composer. Out of scope.
- **Do not** persist new server-side state. All UI preferences are localStorage only.
- **Do not** introduce dark mode in this pass — the app is light-mode first; ensure your tokens still allow a future dark mode but don't ship one now.
- **Do not** turn the verification panel into a giant always-visible widget — it's a click-to-expand inline accordion.
- **Do not** silently drop the existing telemetry surface (recipe_run_id, run id, latencies, recipe ID): keep it visible in calm tertiary text.

---

## 16. Deliverable

Provide a single coherent diff that updates `src/routes/AccountabilityPage.tsx` and the files in `src/components/ship/*.tsx`, plus any new files under `src/components/ship/` and `src/lib/`. Include a short README section at the top of `AccountabilityPage.tsx` describing the new component layout (which file owns what). Keep the diff focused on this surface — don't refactor unrelated routes.

If you must compromise on any acceptance criterion due to a constraint you discover, call it out explicitly with the rationale, and propose the smallest follow-up that would close the gap.

Quality bar: a senior product designer should be able to drop into this UI cold, ask the analyst three questions in a row, and feel that the product is on par with ChatGPT or Gemini for *interaction model and polish* — while being *visibly more serious and grounded* in citations and verification.

Now redesign it.
