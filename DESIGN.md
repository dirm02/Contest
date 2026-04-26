# AccountabilityMax Design System

AccountabilityMax is an investigative data product for public funding, procurement, entity risk, governance links, adverse media, and challenge validation. The interface should feel like a serious evidence desk: fast, legible, calm, and credible.

This guide is for the whole app, not only the header. The header is the first visible place to apply it, but the same rules should guide dossiers, investigation modules, graphs, tables, filters, status cards, and admin/validation views.

## Design Direction

Use an IBM Carbon-inspired enterprise data style with a small amount of Linear-like polish.

- Primary feel: institutional, analytical, trustworthy, compact.
- Avoid: marketing hero pages, decorative blobs, chat-first layouts, oversized cards, playful dashboards, and one-note beige themes.
- Keep the current app practical: the user arrives to search, inspect evidence, compare cases, and decide what to review next.
- Design pages as working tools, not explanations of the tool.

## Product Shell

The product shell should stay stable across the app.

Recommended header:

```text
[ Logo image ]  AccountabilityMax        Search   Admin Panel   People        [ Data status ]
```

Header behavior:

- Replace the text-only brand with a compact logo placeholder plus `AccountabilityMax`.
- Remove `AccountibilityMax.app`.
- Remove `Investigative MVP`.
- Keep the main nav short: `Search`, `Admin Panel`, `People`.
- Keep challenge-specific routes inside `Admin Panel`, not in the top nav.
- Add a compact data status chip on the right.
- On mobile, wrap into a clean two-row shell: brand/status first, nav second.

Data status chip:

- Default label: `Data online`.
- Healthy state: green dot plus neutral border.
- Warning state: amber dot and short label such as `Partial data`.
- Error state: red dot and short label such as `API issue`.
- Later enhancement: clicking can open a small status popover for Postgres, BigQuery, media APIs, and last refresh time.

## Color System

Move gradually away from the warm beige foundation toward neutral gray and white with blue accents.

Core tokens:

```css
:root {
  --color-bg: #f4f4f4;
  --color-surface: #ffffff;
  --color-surface-subtle: #f8f8f8;
  --color-ink: #161616;
  --color-muted: #525252;
  --color-border: #e0e0e0;
  --color-accent: #0f62fe;
  --color-accent-hover: #0043ce;
  --color-accent-soft: #edf5ff;
  --color-success: #198038;
  --color-warning: #b28600;
  --color-danger: #da1e28;
  --color-info: #0f62fe;
}
```

Usage:

- Blue is for active navigation, primary actions, links, and selected states.
- Green is for healthy data and low-risk status.
- Amber is for review, partial data, caveats, and medium risk.
- Red is for confirmed high-risk or failed checks.
- Teal can remain for relationship/network signals, but use it sparingly.

## Typography

Current system fonts are acceptable. Do not add a font dependency yet.

Rules:

- Page titles: clear and direct, not marketing language.
- Section labels: small uppercase labels are acceptable for dense dashboards.
- Body copy: concise, evidence-first.
- Tables: favor compact line height and readable numeric alignment.
- Avoid viewport-scaled font sizes for operational UI.

## Layout

Use a dense but comfortable operational layout.

- Max content width: current `max-w-7xl` is fine.
- Spacing scale: 4, 8, 12, 16, 24, 32.
- Border radius: 8px maximum for cards and controls unless a component already requires otherwise.
- Prefer full-width sections over nested card stacks.
- Cards are for repeated items, evidence boxes, modals, and bounded tools.
- Avoid cards inside cards when a border row, table, or section divider is enough.
- Keep filters close to the table or graph they affect.

## Components

### Buttons and Links

- Primary actions: blue filled button.
- Secondary actions: white button with neutral border.
- Tertiary actions: text link or icon button.
- Use icons for common tool actions when available.
- Keep labels short and task-specific: `Open module`, `View case`, `Run check`.

### Cards

- Use flatter cards: neutral border, light surface, minimal shadow.
- Make repeated cards consistent in height when scanning matters.
- Put status badges at the top of investigation cards.
- Put evidence summaries below the case title, not in decorative sidebars.

### Tables

- Tables are the main analytical surface.
- Use numeric alignment for money, ratios, scores, and counts.
- Keep top columns visible: entity/vendor, source, department, category, value, score, reason.
- Use row actions rather than large action buttons inside every row.
- Empty states should distinguish `no results` from `data failed to load`.

### Graphs and XYFlow

- Graphs are evidence, not decoration.
- Nodes must be draggable where possible.
- Use generous spacing between identity, entity, signal, and source nodes.
- Long legal names should have abbreviations in nodes and full names in detail panels/tooltips.
- Selected nodes should rise above nearby nodes.
- Provide a side/focus panel for full details instead of overloading the node text.

### Dossiers

Dossiers are the main story surface.

Recommended order:

1. Entity identity and core funding summary.
2. Risk/status cards across solved challenges.
3. Relationship graph.
4. Funding timeline and tables.
5. Evidence panels and source rows.

Challenge boxes should be compact and comparable:

- Challenge name.
- Count or score.
- Short reason.
- Link to module/detail where available.

## Page Types

### Search

- Search is the front door.
- Keep it fast and uncluttered.
- Results should show enough metadata to choose the right entity: name, type/source, identifiers, funding total, and key signals.

### Admin Panel

Admin Panel is the investigation hub, not a marketing page.

It should contain:

- Challenge cards.
- Live/under-review/planned status.
- Cross-risk summaries.
- Links to validation and module pages.
- Data-quality caveats only where they affect interpretation.

### Challenge Modules

Each challenge page should answer:

- What is being ranked?
- Why was this case flagged?
- What evidence supports it?
- What are the limits or caveats?

Use the same pattern:

1. Summary metrics.
2. Filters.
3. Ranked table/cards.
4. Detail page.
5. Source/evidence rows.

### Validation/Admin Checks

`/challenge-review` is not a primary user journey. It is an internal validation page.

Design it as:

- Status cards by challenge.
- Pass/warning/fail verdicts.
- Last checked time.
- Mismatch examples.
- Links to current serving pages.

## Data And Trust

Never make failed data look clean.

- If a source fails, show a warning or partial-data state.
- If media search fails, never show it as `No adverse media found`.
- If BigQuery or Postgres comparison fails, return/display a warning or fail verdict.
- Keep caveats close to the metric they affect.
- Use neutral language unless the data supports stronger language.

## Dependency Policy

Do not add heavy UI or AI dependencies without a clear production need.

Current decision:

- Do not add CopilotKit/OpenGenerativeUI yet.
- Do not add Chartbrew as an embedded frontend dependency yet.
- Keep Recharts and XYFlow for now.
- Add component libraries only if they reduce real maintenance cost and fit the existing app.

## Implementation Order

Use staged rollout to reduce risk.

1. Header and shell:
   - Logo placeholder.
   - Brand rename to `AccountabilityMax`.
   - Short nav.
   - Data status chip.
   - Neutral header surface.

2. Global tokens:
   - Shift CSS variables from warm beige to neutral gray/white.
   - Keep accent blue and risk colors.
   - Reduce card shadows.

3. Admin Panel:
   - Tighten challenge cards.
   - Make status, route, source, and evidence hierarchy clearer.
   - Avoid nested card feel.

4. Dossier:
   - Add consistent challenge signal boxes.
   - Improve graph/detail balance.
   - Keep adverse media and amendment/concentration signals compact.

5. Challenge pages:
   - Standardize filters, metrics, tables, and detail pages.
   - Apply the same evidence-first layout to Challenges 1, 2, 3, 4, 5, 6, and 10.

6. Future modules:
   - Challenges 7, 8, and 9 should follow the same module pattern after analytics are validated.

## Review Checklist

Before shipping UI changes:

- Header does not wrap awkwardly on desktop or mobile.
- Top nav remains short.
- Data failures are visibly different from empty results.
- Tables remain readable at laptop width.
- Graph nodes do not overlap and can be interacted with.
- Long organization names do not break cards, buttons, or graph nodes.
- Main user path still works: Search -> Dossier -> Evidence/module.
- Build passes.
