# Brief: Fix the Accountability Analyst Conversation View — It Looks Terrible

## 0. Context

Open the conversation at `/accountability/35d0a881-7591-47bd-89b3-4ac4e30ae63a` (or any conversation in the current state). What you'll see right now (a screenshot is saved at `accountability-current.png` in the repo root):

- The browser tab title literally says **"Maple DOGE"**.
- The conversation has two turns: the user said "hello" and got a clarification card, then asked *"which schools received funding in 2024?"* and got an answer that buries the actual list under five paragraphs of dense prose, displays "8 findings · 1 SQL refs · 43.3s" as a single line of metadata with no streaming trail to explain where 43 seconds went, and offers four broken suggested follow-ups that treat "School" as if it were a literal entity name (`What other public funds did School receive?`, `Show governance links for School?`, `Are there adverse media signals around School?`, `Show me the supporting SQL`).
- The page is a wall of `UPPERCASE TRACKING-WIDEST FONT-BLACK` labels: `INTELLIGENCE AGENT` / `LIVE FORENSIC THREAD` / `OFFICIAL AGENT SERVICE · CACHED FINDINGS ACTIVE` / `FORENSIC THREADS` / `INQUIRY HISTORY` / `NEW INQUIRY` / `CATALOG` / `OFFICIAL INQUIRY COMPOSER` / `EXECUTE` / `AGENTS ONLINE` / `OFFICIAL USE ONLY` / `SYSTEM ONLINE` / `AUDIT POSTURE` / `ACTIVE INVESTIGATION` / `MAIN NAVIGATION` / `5 SEGMENTS` / `2M AGO`. There is more capitalized eyebrow type than there is body content.
- The chat header alone stacks **four headlines** — `INTELLIGENCE AGENT`, the conversation title `LIVE FORENSIC THREAD`, the subtitle `OFFICIAL AGENT SERVICE · CACHED FINDINGS ACTIVE`, and one more line above for the status pill — eating roughly 130 vertical pixels for almost no information.
- The status pill `VERIFYING AGENTS` is rendered in solid green, top-right, larger than the chat title.
- The user message is a **bright primary-red bubble**. The assistant's answer card sits below it on a yellow-cream background that is visually identical to the *clarification* warning card directly above it — clarifications and answers cannot be told apart at a glance.
- Citations render as plain bracketed numbers in the prose (`[1] [2] [3]`, then `[4] [5] [6]`, then `[7] [8] [9] [10]`) clustered at paragraph ends, with no styling, no hover, no clear interactivity.
- The findings table is **collapsed** by default behind a "Show details" link, even though the question literally asks "which schools" and the table is the answer.
- The composer at the bottom has a `OFFICIAL INQUIRY COMPOSER` eyebrow, an all-caps placeholder `ENTER INQUIRY REGARDING RECIPIENTS, PROGRAMS, OR RISK SIGNALS…`, and a primary-red `EXECUTE` button.

The previous briefs (`ui-prompt.md`, `ui-prompt2.md`, `ui-prompt3.md`) describe the right end-state in depth. This brief is **tactical and immediate** — fix the visible problems on this exact page, in a single coherent diff, so reloading the URL shows a chat that looks like a 2026 product instead of a 1985 government terminal. Where this brief and the earlier ones differ, this brief wins; where they agree, this brief is a checklist of the specific issues to clear first.

---

## 1. Your Role and Constraints

Senior product designer / front-end engineer. Stack unchanged: React 18, TypeScript strict, Tailwind, react-query, react-router-dom, lucide-react. SSE protocol and types in `src/lib/ship.ts` are frozen.

Files in scope (and only these unless absolutely necessary):

- `index.html` — the page title bug.
- `src/App.tsx` — top-bar branding and the right-side status duplication.
- `src/routes/AccountabilityPage.tsx` — the conversation page shell, the chat header.
- `src/components/ship/ConversationView.tsx` — the in-conversation header, message rendering, composer.
- `src/components/ship/ConversationList.tsx` — the threads sidebar (the "FORENSIC THREADS · Inquiry History" header, the conversation rows).
- `src/components/ship/AssistantMessageCard.tsx` — the answer card (mode-less today; needs a real visual hierarchy).
- `src/components/ship/CitationChip.tsx` — citations need to look interactive.
- `src/components/ship/FindingsTable.tsx` — the table that's currently buried.
- `src/components/ship/CatalogModal.tsx` — only minor copy fixes.
- `src/styles.css` — token tweaks if needed; do not introduce new color hexes.

Anywhere this brief calls for a copy change, apply it everywhere the same string occurs in the codebase, not just on the visible surface.

---

## 2. Issue Inventory (work the list)

Each item below is observable on the current page. You are done with that item when reloading the URL no longer shows the bad behavior.

### 2.1 Bugs

1. **Page title is "Maple DOGE".** Set `<title>Accountability Analyst</title>` in `index.html`. When inside a conversation, set the document title to `${conversationTitle} · Accountability Analyst` via a `useEffect` in `ConversationView.tsx`, falling back to "Accountability Analyst" when no conversation is selected.

2. **Suggested follow-ups treat "schools" as a proper-noun entity.** The chips read "What other public funds did School receive?" / "Show governance links for School?" / "Are there adverse media signals around School?". The follow-up generator is plugging the *concept* into an *entity* template. Fix the generator so:
   - Concept-class questions ("which X received funding in YEAR?") generate refinements like *"Filter to Alberta only"*, *"Group by department"*, *"Top 10 by total funding"*, *"Compare to 2023"*, *"Add adverse media signals for these recipients"*.
   - Only when an answer cites a specific named entity (a single recipient row dominating the prose, or `verification.checks.canonical_entities_seen >= 1` and the answer explicitly names one) should entity-specific chips appear, and even then they must use the actual entity name from the data, not the category word.
   - Default chip set when no entity is identified: 1) "Show me the full list", 2) one filter chip (largest column → "Sort by X"), 3) one comparison chip if a date is detected, 4) "Show me the supporting SQL". Cap at 5.
   - Sentence case throughout.

3. **The "hello" turn produced a clarification card, but the question that *should* have produced a real answer ("which schools received funding in 2024?") is rendered identically — same border, same colour, same icon family.** Clarifications must read as *interactive forms* (info icon, soft accent tint), not yellow alerts. Answers must read as *editorial documents* (clean white card, headline-first). See §3.4–3.5.

### 2.2 Layout and chrome

4. **Quadruple-stacked headlines in the chat header.** Today: `INTELLIGENCE AGENT` (eyebrow) + `LIVE FORENSIC THREAD` (h1) + `OFFICIAL AGENT SERVICE · CACHED FINDINGS ACTIVE` (subtitle) + a status-pill row. Collapse to a single 48–56 px header bar:
   - Left: the conversation title in sentence case (h1, `text-base font-semibold`, NOT uppercase). Show the literal `conversation.title?.trim()` or "New investigation" if absent. Stop applying `uppercase` to user-derived titles — the user's "hello" should not display as "HELLO" anywhere.
   - Right: a *quiet* status indicator (8 px dot + small label "Connected" / "Reconnecting…" / "Offline") and a kebab menu (rename, delete, copy link, export). The kebab replaces the standalone "Catalog" button — move Catalog into the empty-state and the composer's left side icon button.
   - Delete the `OFFICIAL AGENT SERVICE · CACHED FINDINGS ACTIVE` line entirely. It is jargon and adds no signal.
   - Header bottom border: 1 px `--color-border`. No shadows.

5. **Two competing status pills in the top-bar.** The outer app shell shows `OFFICIAL USE ONLY · Secure Portal` + `SYSTEM ONLINE` on the right; the chat header then adds `VERIFYING AGENTS` directly below. Pick one. Move the agent connection status to the chat header (per item 4) and keep `OFFICIAL USE ONLY` in the outer shell — but in sentence case, smaller, less weight. Drop the `Secure Portal` line. Drop the bright-green `SYSTEM ONLINE` link styling: a small dot + "Connected" matches the chat status idiom.

6. **All-caps everywhere.** Sweep these strings and rewrite them in sentence case (`UPPERCASE` → friendly):
   - `MAIN NAVIGATION` → "Navigation" (or remove entirely; the icons + tooltips are enough).
   - `SEARCH`, `AGENTS`, `INVESTIGATION PANEL`, `PEOPLE` → "Search", "Analyst", "Investigations", "People".
   - `AUDIT POSTURE` / `ACTIVE INVESTIGATION` → either remove this entire footer panel from the left rail or replace with a single muted line ("Investigation in progress · 5 conversations") that's actually informative.
   - `FORENSIC THREADS` / `Inquiry History` → "Conversations" (single line eyebrow, sentence case).
   - `NEW INQUIRY` → "+ New conversation".
   - `5 SEGMENTS` / `2M AGO` → "5 messages · 2 min ago".
   - `INTELLIGENCE AGENT` (chat eyebrow) → delete (the page is called Analyst already).
   - `LIVE FORENSIC THREAD` → use the actual conversation title.
   - `OFFICIAL AGENT SERVICE · CACHED FINDINGS ACTIVE` → delete.
   - `CATALOG` → "Browse examples" (or just an icon button).
   - `OFFICIAL INQUIRY COMPOSER` → delete the label entirely.
   - `ENTER INQUIRY REGARDING RECIPIENTS, PROGRAMS, OR RISK SIGNALS...` → "Ask about a recipient, program, or risk signal…".
   - `EXECUTE` → "Send" (or just a paper-plane icon button).
   - `AGENTS ONLINE` / `VERIFYING AGENTS` / `SHIP ONLINE` / `SYSTEM ONLINE` → "Connected".
   - `EVIDENCE (8 FINDINGS)` → "Evidence · 8 findings".
   - `SUGGESTED FOLLOW-UPS` → "Suggested follow-ups".
   - `CAVEATS` (in the answer card metadata strip) → "Caveats noted".
   - `OFFICIAL USE ONLY` → keep but render as `text-[10px]` muted gray, sentence case, in the right corner of the outer top bar; drop the heavy uppercase weight.

   The only places `uppercase` is still allowed: a single 11px eyebrow label *above* a section heading, ≤ 2 short words, with `tracking-[0.14em]` (not `0.20em+`). Apply this rule across all touched files.

### 2.3 Conversation list (sidebar)

7. **Conversation row reads `HELLO · 5 SEGMENTS · 2M AGO`.** The user typed lowercase "hello"; the UI shouts it back. Remove `uppercase` from the conversation-title element. Show it as the user typed it, truncated to two lines. If the title is empty or whitespace, render "Untitled conversation".

8. **"5 SEGMENTS" is jargon.** Use "messages". "2M AGO" → "2 min ago" (lowercase, with a space).

9. **Active row visual.** The active row has a red left bar plus a tinted background — the bar plus background is fine, but make the title weight `font-medium` (not `font-bold uppercase`) and the background `var(--color-accent)/8` not `var(--color-surface-subtle)` so it actually reads as the active selection.

10. **Sidebar header `FORENSIC THREADS / Inquiry History` (two stacked labels) plus a refresh icon plus a giant red `+ NEW INQUIRY` button.** Compress to one slim header line: muted "Conversations" eyebrow, ghost refresh icon, then below it a single full-width primary "+ New conversation" button — same width, but solid accent fill at normal weight (not `font-black tracking-[0.2em]`).

11. **The dead `Audit Posture / Active Investigation` panel** at the bottom of the left rail. Remove it. If the team wants a status footer there later, design that separately.

### 2.4 Empty/clarification state

12. **The clarification card is yellow-cream and looks like an answer.** Move clarifications to a soft *info* affordance, not a warning:
    - Icon: lucide `Lightbulb` or `HelpCircle` (not `AlertTriangle`).
    - Background: `bg-[var(--color-accent)]/5`, border `var(--color-accent)/30`. Reserve yellow/amber for *caveats inside answers*.
    - Headline (sentence case): the existing `headline` text, but rephrased for the "hello" case to "Tell me what you'd like to investigate" instead of "What would you like to investigate?".
    - Below the headline: the suggested narrowings as a vertical list of clickable rows (each row has a quick-action arrow on the right). On click, prefill the composer.
    - "Try one of these refinements" example chips below, sentence case.
    - The `Run it broadly anyway` button stays as a ghost-secondary button; do not make it red.

13. **The user message bubble is solid primary-red.** Replace with `bg-[var(--color-accent)]/10` background and `text-[var(--color-ink-strong)]` text. Round the bubble `rounded-2xl rounded-br-md`. Drop the `border-[var(--color-accent-hover)]` border. Limit to 75% column width.

### 2.5 Answer card (the big problem)

The answer to "which schools received funding in 2024?" is currently a five-paragraph essay where the actual list of schools is collapsed under "Show details" at the bottom. That is upside-down. Restructure:

14. **Headline first.** Change the headline placement and content so the user's question is answered visually within 2 seconds of looking at the card. For a list-shaped question, the headline reads: `"8 schools received funding in 2024"` (use the row count from the findings) — derive the headline shape from the question + recipe template, not from the existing `summary.headline`. Use the existing `summary.headline` as a one-line subtitle below.

    *(If you cannot reliably derive a count-shaped headline locally, fall back to the existing `summary.headline` but render it sentence-case; do not show "Returned school-related funding recipients" as if it were a complete sentence — strip leading "Returned" and trailing nominalizations.)*

15. **Findings table NOT collapsed by default.** The "Show details" gate is wrong for analytical questions. When the answer's primary question is a "which/list/how many" shape (detect heuristically: `summary.paragraphs.length <= 1` OR `findings_preview.length <= 25` OR the question text matches `^(which|how many|list|show|name|who)`), render the table fully expanded above the prose. The prose becomes commentary *below* the table, not above it.

    For other shapes (commentary, comparison), keep the prose-first layout but still show a compact 5-row preview of the table inline; the existing "Show more findings" button continues to work.

16. **A real "Thought for Xs" disclosure.** The current card displays `8 findings · 1 SQL refs · 43.3s` as a one-liner with no way to inspect what happened during 43 seconds. Add a collapsed disclosure at the top of the answer card titled `Thought for ${(latency_ms/1000).toFixed(1)}s` (always present when `latency_ms > 1500`). When expanded, show the existing `ProgressTrail` event log (which today is in `ProgressTrail.tsx` and used during streaming but disappears post-completion). For historical messages where events are not available, show whatever derived metadata we can: SQL queries run (count + names), web searches (count + queries), entities verified, and the verification check counts. Click on a SQL query name in the disclosure opens the existing SQL drawer.

17. **Verification badge is invisible.** Today the verification status reads `CAVEATS` (uppercase, no fill) and is the only visual cue that something needed careful review. Replace with a confidence ring (per `ui-prompt.md` §7.8): a 16px SVG ring whose fill = pass/caveats/fail, plus three quiet chips next to it: `${cited_findings} findings`, `${cited_sql} SQL refs`, `${(latency_ms/1000).toFixed(1)}s`. Click the ring → expand the verification accordion in place, no full-card replacement.

18. **Citations are unstyled bracket clusters at end of paragraphs (`[1] [2] [3]`).** Make them inline numeric superscripts that look interactive:
    - Wrap each in `<sup><button>[N]</button></sup>` with `text-[10px] font-bold text-[var(--color-accent)] underline-offset-2 hover:underline` styling.
    - On hover/focus: a Floating-UI popover showing a preview of the cited finding row (top 4 columns, formatted) or SQL query name + row count, or external URL.
    - On click: the existing scroll-to-row / open-SQL-drawer / open-external-URL behavior. Do not bury this behavior inside an unclickable-looking bracket. (See `ui-prompt.md` §7.12 for the long-form spec.)

19. **The yellow "Caveats" panel and the yellow Clarification card use identical visual language.** Distinguish:
    - Clarification card: soft accent (info) styling — see item 12.
    - Caveats inside an answer: keep amber, but tighten the visual: a single `AlertTriangle` icon, "Caveats" eyebrow in `--color-warning`, body in `--color-ink-strong`, no background fill — instead use a 4 px amber left-rule and 1 px amber border.

20. **Answer card "EVIDENCE (8 FINDINGS)" header.** Sentence case ("Evidence · 8 findings"). The collapsible chevron must be visually obvious; today the affordance is just text "Show details". Use a chevron icon and click-the-whole-row.

21. **Mode badge.** Per `ui-prompt3.md` §5.1, every answer carries a small mode chip ("Fresh" / "Refined" / "Composed" / "From memory"). If `AnswerResponse.mode` is missing on this payload (the new contract may not be live yet), default to "Fresh" without rendering the chip — but make sure the lineage breadcrumb code path is in place so it activates when the backend ships the field. Behind the same `VITE_ANALYST_ITERATIVE` flag that already exists in `ui-prompt3.md`.

22. **Massive 43.3s latency with no prior progress signal.** The chat shows the answer instantly because the events were not streamed in real time when this conversation was created. Going forward, the activity card from `ui-prompt2.md` should be in place; for replayed/historical messages, the "Thought for Xs" disclosure (item 16) is the substitute.

### 2.6 Composer

23. **`OFFICIAL INQUIRY COMPOSER` eyebrow + all-caps placeholder + red `EXECUTE` button.** Strip:
    - Remove the eyebrow label entirely.
    - Placeholder: "Ask about a recipient, program, or risk signal…" (sentence case, ellipsis, single line).
    - Button: a circular Send button (paper-plane icon, 40 px, accent fill) anchored on the right, **inside** the composer container with rounded `12 px` corners and a soft 1 px border. While streaming, the Send button swaps to a square Stop button (existing abort wiring).
    - Add a tiny keyboard hint right-aligned beneath the textarea: `⌘↵ to send · / for commands` in 11 px muted text.
    - Composer container: `rounded-xl border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]`. Sticky to the bottom of the chat column.
    - Auto-grow up to ~12 lines, then internal scroll. (`field-sizing: content` with a JS fallback.)

24. **Suggested-follow-ups row position.** Move it **into** the composer's sticky region, just above the textarea, so the chips travel with the composer when scrolling and are always within reach. Eyebrow "Suggested follow-ups" in 11 px muted text.

25. **No keyboard hint, no shortcut affordance, no preview.** Add the `⌘↵ to send` hint (item 23). When the user types `/` at the start of an empty composer, open a small popover listing the future slash commands (per `ui-prompt3.md` §5.7) — for this pass it's enough to render the popover with the commands disabled and a "Coming soon" footer, just so the affordance is discoverable. Acceptable to ship without slash commands wired up, as long as the affordance does not disappear.

### 2.7 Outer shell

26. **Top red 1.5 px strip + sticky white header is fine, keep.** But the right side reads `OFFICIAL USE ONLY · Secure Portal · SYSTEM ONLINE`. Reduce to a single `Official use` muted line (sentence case, 10 px) and move the system status to a quiet 8 px dot inside the chat header (item 4). The /api/health link can live inside a tiny "i" hover popover in the brand corner if needed; nothing in the persistent header should shout.

27. **Left rail remains.** Sentence-case the labels, drop the audit-posture box (item 11), and reduce the logo block: the small accent square with "A" is fine, but the Accountability Max wordmark beneath it can lose `tracking-tighter font-black uppercase` and become `font-semibold` sentence case. Tagline "Forensic system" → drop.

### 2.8 Conversation-thread layout

28. **Center the message column at `max-w-3xl` (768 px) inside the available chat area.** Today messages stretch to the full chat-column width which makes long answers hard to read. Add comfortable left/right margins in the message scroller. The composer is also centered to the same max-width with the same horizontal padding.

29. **Vertical rhythm.** `space-y-8` between turns, `space-y-3` within an answer card. Drop the heavy borders and shadows around the answer card; use a 1 px `--color-border` and `bg-[var(--color-surface)]`, with a soft `shadow-sm`. Today the card has multiple competing borders/shadows that fight each other.

30. **Floating "↓ Latest" pill** that appears bottom-right of the message scroller when the user has scrolled up. Today no such affordance exists; for a long answer like this one, scrolling is annoying.

---

## 3. Component-level Acceptance

You're done with each component when the assertions below hold on a fresh reload of `/accountability/35d0a881-7591-47bd-89b3-4ac4e30ae63a`.

### 3.1 `index.html` + outer App

- `document.title === "Accountability Analyst"` on `/accountability` (no conversation), and `${title} · Accountability Analyst` on a specific conversation.
- The outer header has no `font-black uppercase tracking-widest` strings except the logo wordmark "Accountability Max" (and that may keep its weight only — drop `uppercase` from the wordmark).
- "OFFICIAL USE ONLY" rendered as `text-[10px] text-[var(--color-muted)]` (no uppercase, no tracking).
- The "/api/health" "SYSTEM ONLINE" link is removed from the outer bar.

### 3.2 `AccountabilityPage.tsx` (the chat shell)

- Chat header is one row, ≤ 56 px tall, containing: title (sentence case, h1, `text-base font-semibold`), a small status indicator (8 px dot + 11 px label), and a kebab menu. No four-line stack.
- The "Browse examples" / Catalog action moves into the empty-state hero (when no conversation is selected) and into the composer's left-edge ghost icon button (when a conversation is open). It is removed from the chat header.

### 3.3 `ConversationList.tsx` (left threads sidebar)

- Header reads exactly one eyebrow line "Conversations" + a refresh icon, then the primary "+ New conversation" button below it. No "FORENSIC THREADS / Inquiry History" stack.
- Conversation row title is rendered with the user's actual case (no `uppercase` class on the title element).
- Metadata line reads `${count} messages · ${relativeTime}` lowercase with a space (e.g. `5 messages · 2 min ago`).
- The footer "Audit Posture / Active Investigation" panel is removed.

### 3.4 `ConversationView.tsx`

- The user message bubble has class signature: `bg-[var(--color-accent)]/10 text-[var(--color-ink-strong)] rounded-2xl rounded-br-md max-w-[75%]`. Solid red is gone.
- The composer:
  - has no "OFFICIAL INQUIRY COMPOSER" label,
  - has placeholder `Ask about a recipient, program, or risk signal…`,
  - renders a circular Send icon button (or "Stop" while streaming),
  - shows the keyboard hint `⌘↵ to send · / for commands`,
  - is sticky-bottom with rounded 12 px corners and a soft layered shadow,
  - sits above a sticky band that contains the suggested-follow-up chips for the most recent assistant answer.
- The thread is centered at `max-w-3xl`.
- A floating "↓ Latest" pill appears when the user scrolls up > 200 px.

### 3.5 `AssistantMessageCard.tsx` (Answer variant)

For the schools answer (`AnswerResponse` with 8 findings):

- A "Thought for 43.3s" disclosure renders at the top of the card, collapsed by default.
- The headline reads "8 schools received funding in 2024" (or, if you can't synthesize the count headline locally, the existing headline rendered sentence-case with leading nominalizations stripped).
- Confidence ring + 3 chips render next to the headline (no `CAVEATS` uppercase pill).
- The findings table is **expanded** by default for this question shape.
- Citations render as inline numeric superscripts with hover-card previews; clicking finding[N] highlights and scrolls to row N.
- The caveats panel uses a left-rule + amber border (no full background fill); not visually identical to the clarification card.
- Suggested-follow-up chips, when this answer has no canonical entity in the prose, render category-level refinements (e.g. *"Group by department"*, *"Top 10 by total funding"*, *"Compare to 2023"*, *"Add adverse media for these recipients"*, *"Show me the supporting SQL"*) — **never** "What other public funds did School receive?".
- Footer message-actions row: Copy, Copy as report, Regenerate, Permalink, 👍, 👎 — in ghost icon-button style.

### 3.6 `AssistantMessageCard.tsx` (Clarification variant)

For the "hello" turn:

- Card uses info styling (lucide `Lightbulb`/`HelpCircle`, `bg-[var(--color-accent)]/5`, `border-[var(--color-accent)]/30`).
- Headline sentence case: "Tell me what you'd like to investigate".
- Suggested narrowings render as a vertical click-through list (each row clickable, with a right arrow), not a bulleted body.
- Example refinement chips below, sentence case.
- The "Run it broadly anyway" button is ghost secondary (not red).

### 3.7 `CitationChip.tsx`

- The component returns `<sup><button>` for finding citations, with hover-card on focus/hover, and the styling described in item 18. The plain `[1] [2] [3]` text-only rendering is removed.

### 3.8 `FindingsTable.tsx`

- For the schools answer's table, the columns are visible by default (not collapsed).
- Numeric columns are right-aligned with `tabular-nums`.
- URL columns are truncated with a tooltip; currency columns use CAD format; year/date columns format as `YYYY-MM-DD`.
- Header row: `font-medium` (not `font-black tracking-wider uppercase`), sticky.

### 3.9 Global copy sweep

`git grep -nE "(FORENSIC|EXECUTE|ABORT|INITIALIZE|OFFICIAL ANALYST|OFFICIAL INQUIRY|FORENSIC THREADS|INQUIRY HISTORY|LIVE FORENSIC|OFFICIAL AGENT|SYSTEM ONLINE|AGENTS ONLINE|VERIFYING AGENTS|AUDIT POSTURE|ACTIVE INVESTIGATION|OFFICIAL USE ONLY|MAIN NAVIGATION|NEW INQUIRY|tracking-widest)" src/components/ship src/routes/AccountabilityPage.tsx src/App.tsx index.html` should print **zero matches** from the chat surfaces. (`OFFICIAL USE ONLY` may remain in the outer shell but only with sentence-case rendering and no uppercase class — so the source string itself shouldn't contain the uppercase form; lowercase the source.)

---

## 4. Things You Are NOT Allowed to Change

- The SSE protocol or any function signature in `src/lib/ship.ts`.
- The router setup in `src/App.tsx` (`/accountability` routes, nav items).
- The `/investigations` page (`ChallengeAtlasPage`) — it's a separate brief.
- The backend / ship service.
- The brand identity (`Accountability Max` wordmark, accent color). You may restyle their typography (drop `uppercase`/`font-black`/`tracking-widest`) but not their color or naming.

---

## 5. Validation Steps

After implementing, do all of these and paste evidence:

1. Reload `http://127.0.0.1:5173/accountability/35d0a881-7591-47bd-89b3-4ac4e30ae63a`. The browser tab title is "(conversation title) · Accountability Analyst", not "Maple DOGE".
2. Take a full-page screenshot. Compare to `accountability-current.png`. Visible improvements: headline answer reads "X schools received funding in 2024" (or a sentence-case rewrite of the existing one), the table is expanded, citations look interactive, the user bubble is no longer solid red, the chat header is a single row, the "Audit Posture" footer is gone, the composer says "Send" not "EXECUTE".
3. Hover a citation `[N]`. A popover preview appears.
4. Click the "Thought for 43.3s" disclosure. A list of phases / SQL queries / verification checks expands.
5. Click a suggested-follow-up chip. The composer prefills with the chip text — and the chip text is a sensible category-level refinement, not a "School receive" phrase.
6. Scroll up the message thread; a "↓ Latest" pill appears bottom-right; clicking it returns to the bottom.
7. Resize to 768 px wide. The left sidebar collapses or hides; the chat is comfortably readable.
8. `git grep` the strings in §3.9. Zero matches in chat surfaces.
9. Run TypeScript: `tsc --noEmit` — clean.
10. Run lint: `npm run lint` (or whatever the project uses) — clean.

---

## 6. Deliverable

A single coherent diff over `index.html`, `src/App.tsx`, `src/routes/AccountabilityPage.tsx`, and `src/components/ship/*.tsx`. Optional new helper files under `src/components/ship/` for the confidence ring, citation hover-card, and follow-ups generator if you choose to extract them. Keep the diff focused on this conversation surface.

Quality bar: a journalist who lands on this URL cold should immediately see the answer to "which schools received funding in 2024?" — count, list of recipients, total funding by recipient — without scrolling, without expanding anything, and without parsing 350 words of academic prose. Citations must invite clicks. Follow-ups must make sense. Nothing on the page should shout in caps.

Now fix it.
