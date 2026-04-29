# Ship Analyst Service Handoff

This document is for a developer who wants to bring the ship-mode analyst into a different project and consume it as a backend service.

The short version: run `output.ship.server:app` as a sidecar FastAPI service, point it at the loaded hackathon PostgreSQL database, give it an OpenAI key, and have the consuming app talk to it over HTTP.

## 1. What This Service Is

`output/ship` is a hybrid analyst for Canadian public-accountability data. It is not an autonomous agent loop. It intentionally keeps the LLM in narrow, auditable roles:

1. Route the user question to one of the registered recipes and extract parameters.
2. Summarize deterministic recipe results into cited prose.

Everything in the middle is deterministic:

- SQL primitives query the loaded Postgres database.
- Recipes compose primitives.
- Web and CanLII primitives are bounded and used only where needed.
- The verifier checks citation grounding, numeric claims, canonical entity names, URL citations, adverse-media funding overlap, and latency.
- Conversations and recipe runs are stored in Postgres for recovery and audit.

## 2. Recommended Integration Model

Use this as a sidecar HTTP service.

```text
Your UI / app server
  |
  | HTTP JSON or SSE
  v
Ship Analyst Service
  |
  | asyncpg, bounded SQL
  v
Hackathon Postgres database
  |
  | OpenAI / web / CanLII only where required
  v
External APIs
```

This is the recommended model because the service has heavy dependencies:

- A loaded accountability Postgres database.
- OpenAI model access.
- Optional CanLII API access.
- Long-running analytical requests.
- Server-side persisted conversations and run provenance.

Do not embed this directly inside a browser app. Do not make the browser talk directly to Postgres or OpenAI. The consuming app should call the service.

## 3. User-Facing Product Flow

From the user's perspective, the consuming app should feel like a chat workspace with inspectable analytical results:

1. The user opens a new investigation chat.
2. The UI calls `POST /conversations`.
3. The user types a question.
4. The UI calls `POST /conversations/{id}/messages`.
5. If the service returns `clarification_needed`, the UI shows a narrowing card with suggested chips and examples.
6. If the service returns `answer`, the UI shows:
   - `summary.headline` as the answer title.
   - `summary.paragraphs` as the prose explanation.
   - `summary.caveats` as an explicit caveat section.
   - `findings_preview` as the first five rows in a small evidence table.
   - `verification.status` as a trust indicator.
   - A "View full evidence" action that calls `GET /recipe_runs/{run_id}`.
7. If the next user turn is a filter/sort/detail request over the same findings, the service returns a fast cached `answer` with `based_on_run_id`.
8. If the next user turn needs fresh data, the service returns `needs_new_conversation` with a suggested starter.
9. Old conversations remain available through `GET /conversations` and `GET /conversations/{id}`.

## 4. Runtime Requirements

### Python

The repo currently targets Python 3.12 and uses `uv`.

Core dependencies already declared in the root `pyproject.toml`:

- `asyncpg`
- `fastapi`
- `httpx`
- `openai`
- `openai-agents`
- `pydantic`
- `pydantic-settings`
- `uvicorn[standard]`

### Database

The database must contain these source schemas:

- `general`
- `cra`
- `fed`
- `ab`

The service writes only to the `investigator` schema and bootstraps its own tables:

- `investigator.ship_conversations`
- `investigator.ship_messages`
- `investigator.ship_recipe_runs`

The startup hook in `server.py` calls `bootstrap_schema(pool)`, which runs idempotent `CREATE TABLE IF NOT EXISTS` SQL.

### Environment

Required:

```bash
DATABASE_URL=postgresql+asyncpg://hackathon:hackathon@localhost:5432/hackathon
OPENAI_API_KEY=...
```

Optional:

```bash
CANLII_API_KEY=...
PRIMARY_MODEL=gpt-5.5
FAST_MODEL=gpt-5.5
```

Notes:

- The SQL pool accepts `postgresql+asyncpg://` and `postgresql://`.
- OpenAI is required for routing and summarization.
- CanLII is optional. Without it, adverse-media court lookup returns a caveat instead of court rows.
- Model defaults are local to `output.ship.runtime_config` so the folder no longer imports the parent app's `src.core.config`.

## 5. Running Locally

From the repo root:

```bash
uv run uvicorn output.ship.server:app --host 127.0.0.1 --port 8765
```

Health check:

```bash
curl -s http://127.0.0.1:8765/healthz
```

Expected:

```json
{"status":"ok"}
```

Catalog check:

```bash
curl -s http://127.0.0.1:8765/catalog
```

OpenAPI:

```text
http://127.0.0.1:8765/docs
```

## 6. Minimal Client Flow

Create a conversation:

```bash
curl -s -X POST http://127.0.0.1:8765/conversations
```

Response:

```json
{
  "conversation_id": "uuid",
  "created_at": "2026-04-29T12:00:00.000000+00:00",
  "title": null
}
```

Ask a message:

```bash
curl -s -X POST "http://127.0.0.1:8765/conversations/$ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding loops"}'
```

Read a full result:

```bash
curl -s "http://127.0.0.1:8765/recipe_runs/$RUN_ID"
```

Use streaming:

```bash
curl -N -X POST "http://127.0.0.1:8765/conversations/$ID/messages?stream=true" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding loops"}'
```

## 7. Endpoint Contract

### `POST /conversations`

Creates a server-side conversation.

Request:

```json
{"title":"optional title"}
```

Response:

```json
{
  "conversation_id": "uuid",
  "created_at": "timestamp",
  "title": "optional title"
}
```

### `POST /conversations/{conversation_id}/messages`

Runs the full message path and returns one final response.

Request:

```json
{"content":"natural-language accountability question"}
```

Response:

- `answer`
- `clarification_needed`
- `needs_new_conversation`
- `not_answerable`

### `POST /conversations/{conversation_id}/messages?stream=true`

Runs the same message path but returns `text/event-stream`.

Important:

- The same user message is persisted.
- The same recipe run is persisted when an answer is produced.
- The terminal event is `final_response`.
- `final_response.data` is the same shape as the non-streaming response.
- If the client disconnects, delivery to that client stops, but the server-side run continues and persists.

### `GET /conversations`

Lists active conversations, newest first. Use this to render old conversations in the consuming app.

### `GET /conversations/{conversation_id}`

Returns full message history and recipe-run metadata, but not full findings.

Use this when reopening a conversation.

### `GET /recipe_runs/{run_id}`

Returns:

- Full findings.
- Full SQL log.
- Summary object.
- Verification object.
- Latency.
- Params.
- `based_on_run_id` when the run is a cached refinement.

Use this for an evidence drawer, table view, audit panel, or export flow.

### `DELETE /conversations/{conversation_id}`

Archives the conversation by setting `status='archived'`.

It does not physically delete the audit trail.

### `GET /catalog`

Returns recipe metadata for UI hints or a capability page.

### `GET /healthz`

Checks Postgres connectivity.

### `GET /docs`

FastAPI generated Swagger UI.

## 8. Response Types In UI Terms

### `answer`

Show a normal assistant answer with evidence controls.

Fields:

- `message_id`: assistant message id.
- `summary.headline`: one-sentence answer.
- `summary.paragraphs`: 2-4 cited paragraphs.
- `summary.caveats`: limitations to surface to the user.
- `findings_preview`: first five finding rows.
- `recipe_run_id`: fetch this for full evidence.
- `based_on_run_id`: non-null when this answer was refined from cached findings.
- `verification`: deterministic trust checks.
- `latency_ms`: end-to-end service latency.

Recommended UI:

- Show `summary.headline` prominently.
- Show paragraphs with compact citation pills.
- Show `verification.status`.
- If verification failed, show a warning banner and list `verification.failures`.
- Show a preview table.
- Add a "Full evidence" button that calls `GET /recipe_runs/{recipe_run_id}`.

### `clarification_needed`

Show a narrowing card.

Recommended UI:

- Headline at top.
- Reason under headline.
- Suggested narrowing chips.
- Example prompts as click-to-fill actions.
- A "Run broad scan anyway" action that sends `proceed_phrase`.

### `needs_new_conversation`

Show a boundary message with a "Start new conversation" action.

This prevents a user from accidentally turning a narrow evidence cache into an unrelated fresh investigation.

Recommended UI:

- Explain why the follow-up is outside the current cached result.
- Offer a button that creates a new conversation and sends `suggested_starter`.

### `not_answerable`

Show a normal assistant message explaining that no deterministic recipe can answer the question yet.

## 9. Streaming UI Behavior

Streaming is optional but recommended for anything slower than a few seconds.

A polished UI can map events to friendly progress rows:

| SSE Event | Suggested User-Facing Text |
| --- | --- |
| `router_started` | Understanding the question |
| `router_decision` | Chose an analysis path |
| `phase_started` with `primitive` | Gathering evidence |
| `sql_query_started` | Running a bounded database query |
| `sql_query_completed` | Database query returned rows |
| `web_search_started` | Searching public sources |
| `web_search_completed` | Public-source search returned results |
| `canlii_started` | Checking CanLII case records |
| `canlii_completed` | CanLII check returned case records |
| `summarizer_started` | Writing the cited answer |
| `summarizer_token` | Append text to a draft answer area |
| `verifier_started` | Verifying claims and citations |
| `verifier_check` | Update a trust checklist |
| `verifier_completed` | Verification complete |
| `heartbeat` | Keep the progress panel alive |
| `final_response` | Replace draft state with final answer |

Do not expose raw SQL unless the user opens a technical evidence drawer. The public progress panel should be plain-language and reassuring.

## 10. Persistence Model

The service stores:

### `investigator.ship_conversations`

One row per conversation.

Key fields:

- `conversation_id`
- `title`
- `status`
- `created_at`
- `updated_at`

### `investigator.ship_messages`

One row per user or assistant message.

Assistant message `content` stores the response payload.

### `investigator.ship_recipe_runs`

One row per answer-producing run.

Stores:

- `recipe_id`
- `params`
- `findings`
- `sql_log`
- `summary`
- `verification`
- `latency_ms`
- `based_on_run_id`

The consuming app should not write these tables directly. Use HTTP endpoints.

## 11. Stable Contract vs Internal Implementation

Stable:

- Endpoint paths.
- Four response types.
- `answer.recipe_run_id`.
- `answer.based_on_run_id`.
- `answer.findings_preview` is bounded.
- `GET /recipe_runs/{run_id}` returns full evidence.
- SSE terminal event is `final_response`.
- Conversation history persists in Postgres.

Not stable:

- Exact finding columns across recipes.
- Internal primitive names.
- Internal recipe composition.
- Prompt wording.
- Number of `summarizer_token` events.
- Exact order of events within long-running recipe internals, except that `final_response` is terminal.

## 12. Recipe Catalog

Registered recipes:

- `funding_loops`
- `zombie_recipients`
- `ghost_capacity`
- `duplicative_funding`
- `vendor_concentration`
- `sole_source_amendment`
- `contract_intelligence`
- `related_parties`
- `policy_misalignment`
- `adverse_media`

Expensive recipes that may ask for narrowing first:

- `adverse_media`
- `related_parties`
- `policy_misalignment`

Use `GET /catalog` rather than hardcoding this list in a UI.

## 13. Moving This Into Another Project

Recommended sidecar extraction:

1. Keep this repo as the service repo.
2. Run `uv run uvicorn output.ship.server:app --host 0.0.0.0 --port 8765`.
3. Point the other project at `SHIP_ANALYST_BASE_URL=http://host:8765`.
4. Consume JSON or SSE over HTTP.

If you must copy code into another backend repo, copy:

- `output/ship/`
- The root `pyproject.toml` dependency subset listed in this handoff.
- Environment variables listed above.
- Database schema/data setup for `general`, `cra`, `fed`, `ab`.

After copying:

1. Ensure `output` and `output/ship` remain Python packages with `__init__.py`.
2. Install the dependencies.
3. Set `DATABASE_URL`, `OPENAI_API_KEY`, and optional `CANLII_API_KEY`.
4. Run `uv run python -m compileall output/ship`.
5. Start `uvicorn output.ship.server:app`.
6. Hit `/healthz`, `/catalog`, and `/docs`.

Avoid copying only individual recipes or primitives. The service relies on the router, orchestrator, summarizer, verifier, and persistence layer working together.

## 14. Reverse Proxy and Production Notes

For nginx or similar proxies:

```nginx
location / {
  proxy_pass http://127.0.0.1:8765;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 300s;
  add_header X-Accel-Buffering no;
}
```

Production checklist:

- Add auth at the reverse proxy or API gateway.
- Restrict CORS.
- Add rate limits per user/session.
- Use HTTPS.
- Keep OpenAI and CanLII keys server-side only.
- Monitor request latency by route and recipe.
- Monitor failed verification rates.
- Monitor external URL timeout rates for adverse-media runs.
- Set database connection limits appropriate for the deployment size.
- Back up the `investigator.ship_*` tables if conversation history matters.

## 15. Security and Privacy Notes

This dataset is public accountability data, but it can include person names, emails, phone numbers, director names, and addresses.

UI recommendations:

- Do not surface raw contact details by default.
- Keep full `sql_log` behind a technical evidence drawer.
- Show canonical organization names from `canonical_name`.
- Treat `verification.status="failed"` as a reason to show a warning or block publication.
- Never expose API keys to the browser.

## 16. Troubleshooting

### `/healthz` fails

Likely causes:

- Postgres is not running.
- `DATABASE_URL` is wrong.
- The database is not loaded.
- Network policy blocks service to database.

Check:

```bash
curl -s http://127.0.0.1:8765/healthz
```

Then inspect Postgres activity from repo root:

```bash
node - <<'NODE'
const { Client } = require('./.local-db/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgresql://hackathon:hackathon@localhost:5432/hackathon' });
  await c.connect();
  console.log(await c.query('select 1 as ok'));
  await c.end();
})();
NODE
```

### Router or summarizer fails immediately

Likely cause:

- `OPENAI_API_KEY` is missing or invalid.

Check:

```bash
python - <<'PY'
import os
print(bool(os.environ.get("OPENAI_API_KEY")))
PY
```

### Adverse-media answer verifies as failed

Common causes:

- External source timed out.
- Source URL redirected.
- CanLII key missing.
- The summary cited a URL whose page no longer contains the identifying terms.

The service intentionally returns the answer with `verification.status="failed"` and detailed failures rather than hiding the issue.

### Streaming appears buffered

Likely causes:

- Reverse proxy buffering.
- Client framework buffers fetch response.
- A frontend proxy route is not forwarding chunks.

Check direct backend streaming first:

```bash
curl -N -X POST "http://127.0.0.1:8765/conversations/$ID/messages?stream=true" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding loops"}'
```

If direct backend streams but the app does not, the problem is in the proxy/client layer.

### Cached refinement unexpectedly runs fresh SQL

Expected behavior:

- Cached refinement returns `answer`.
- `based_on_run_id` is non-null.
- Stored `sql_log` is empty.
- SSE stream has `refinement_filter_applied` and no `sql_query_started`.

If this fails, inspect `refine.py` and `orchestrator.py`.

## 17. Verification Commands

Do these after moving or modifying the service:

```bash
uv run python -m compileall output/ship
curl -s http://127.0.0.1:8765/healthz
curl -s http://127.0.0.1:8765/catalog
curl -s http://127.0.0.1:8765/openapi.json
```

Check service-owned tables:

```bash
node - <<'NODE'
const { Client } = require('./.local-db/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgresql://hackathon:hackathon@localhost:5432/hackathon' });
  await c.connect();
  const r = await c.query(`
    select table_name
    from information_schema.tables
    where table_schema='investigator'
      and table_name in ('ship_conversations','ship_messages','ship_recipe_runs')
    order by table_name
  `);
  console.log(r.rows.map((row) => row.table_name));
  await c.end();
})();
NODE
```

Minimal non-heavy endpoint smoke:

```bash
ID=$(curl -s -X POST http://127.0.0.1:8765/conversations | python -c 'import json,sys; print(json.load(sys.stdin)["conversation_id"])')

curl -s -X POST "http://127.0.0.1:8765/conversations/$ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Which orgs have adverse coverage?"}'
```

This should return `clarification_needed` without starting a broad adverse-media scan.

## 18. Known Current Caveats

- The service is portable as an HTTP sidecar, but it is not yet packaged as a standalone wheel or Docker image.
- It depends on the hackathon database snapshot and schema names.
- `adverse_media` may take longer and depends on external web availability.
- External source URL verification can time out. The verifier reports this explicitly.
- Auth, tenant isolation, production CORS, billing limits, and durable background workers are not built in.
- Client disconnect does not cancel server-side work by design. This preserves conversation recovery but means production deployments should enforce request limits and worker monitoring.

## 19. Operator Mental Model

Use this service like an evidence-producing backend:

- Conversation endpoints are for the chat shell.
- Recipe-run endpoints are for evidence detail screens.
- SSE is for progress UX.
- Verification is for trust display.
- Catalog is for feature discovery and recipe-specific UI hints.
- `SHIP_LOG.md` is the current operational ledger.
- `AGENTS.md` is the local instruction file for future coding agents working in this folder.
