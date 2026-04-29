# Ship Analyst Service

`output/ship/` is the portable service version of the hackathon analyst. It is designed to run as a sidecar HTTP backend that another application can consume.

The visible product flow is simple:

1. The UI creates a server-side conversation.
2. The UI sends a user message.
3. The service routes the message to a deterministic recipe or asks for clarification.
4. The recipe runs bounded SQL, web, and CanLII primitives against the real loaded database.
5. The summarizer writes cited prose from deterministic result rows.
6. The verifier checks citations, numbers, canonical entity names, URLs, and funding overlap.
7. The UI receives either a final JSON response or real-time SSE progress plus the same final response.
8. The full findings, SQL log, summary, and verification record stay persisted in `investigator.ship_*`.

## Start Here

For a developer integrating this into another project:

- Read [SERVICE_HANDOFF.md](./SERVICE_HANDOFF.md) first. It explains how to run this as a sidecar service, what to copy, what to configure, what is stable, and what is internal.
- Read [INTEGRATION.md](./INTEGRATION.md) next. It is the endpoint-by-endpoint client integration guide with JSON shapes and streaming examples.
- Read [AGENTS.md](./AGENTS.md) before asking another coding agent to modify this folder.
- Use [SHIP_LOG.md](./SHIP_LOG.md) for current proof notes, known caveats, and verification history.

## Service Entry Points

Run the HTTP service:

```bash
uv run uvicorn output.ship.server:app --host 127.0.0.1 --port 8765
```

Open API docs:

```text
http://127.0.0.1:8765/docs
```

Health check:

```bash
curl -s http://127.0.0.1:8765/healthz
```

Create a conversation and ask a question:

```bash
ID=$(curl -s -X POST http://127.0.0.1:8765/conversations | python -c 'import json,sys; print(json.load(sys.stdin)["conversation_id"])')

curl -s -X POST "http://127.0.0.1:8765/conversations/$ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"content":"Which charities had government funding above 70% and stopped filing?"}'
```

Stream progress for the same message route:

```bash
curl -N -X POST "http://127.0.0.1:8765/conversations/$ID/messages?stream=true" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding loops"}'
```

CLI smoke path:

```bash
uv run python -m output.ship.run "Which charities had government funding above 70% of revenue and stopped filing?"
```

Direct deterministic recipe smoke path:

```bash
uv run python -m output.ship.run "show funding loops" --recipe funding_loops --json
```

## Runtime Requirements

Required services:

- PostgreSQL with the loaded `general`, `cra`, `fed`, `ab`, and `investigator` schemas.
- Network access to OpenAI.

Required environment:

```bash
DATABASE_URL=postgresql+asyncpg://hackathon:hackathon@localhost:5432/hackathon
OPENAI_API_KEY=...
```

Optional environment:

```bash
CANLII_API_KEY=...
PRIMARY_MODEL=gpt-5.5
FAST_MODEL=gpt-5.5
```

`DATABASE_URL` can use either `postgresql+asyncpg://` or `postgresql://`. The SQL helper normalizes the SQLAlchemy-style URL to the plain `asyncpg` URL internally.

The service bootstraps these tables on startup if they are missing:

- `investigator.ship_conversations`
- `investigator.ship_messages`
- `investigator.ship_recipe_runs`
- `investigator.ship_conversation_memory`
- `investigator.ship_analytical_audit`

## API Shape

Stable endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/conversations` | Create a conversation. |
| `POST` | `/conversations/{conversation_id}/messages` | Send a user message and receive final JSON. |
| `POST` | `/conversations/{conversation_id}/messages?stream=true` | Send a user message and receive SSE progress plus `final_response`. |
| `GET` | `/conversations` | List active conversations. |
| `GET` | `/conversations/{conversation_id}` | Get messages and recipe-run metadata. |
| `GET` | `/recipe_runs/{run_id}` | Get full findings, SQL log, summary, and verification. |
| `POST` | `/conversations/{conversation_id}/runs/{run_id}/pin` | Keep a run in classifier memory. |
| `POST` | `/conversations/{conversation_id}/runs/{run_id}/unpin` | Release an explicit memory pin. |
| `POST` | `/conversations/{conversation_id}/runs/{run_id}/forget` | Hide a run from future classifier memory without deleting it. |
| `DELETE` | `/conversations/{conversation_id}` | Archive a conversation. |
| `GET` | `/catalog` | Get the recipe catalog for UI affordances. |
| `GET` | `/catalog/datasets` | Get the analytical-query dataset catalog with PII columns removed. |
| `GET` | `/catalog/concepts` | Get the curated concept lexicon available to analytical queries. |
| `GET` | `/healthz` | Confirm Postgres connectivity. |
| `GET` | `/docs` | FastAPI OpenAPI UI. |

Response types:

- `answer`
- `clarification_needed`
- `needs_new_conversation`
- `not_answerable`

Streaming events:

- Router: `router_started`, `router_decision`
- Work phases: `phase_started`, `primitive_started`, `primitive_completed`
- SQL: `sql_query_started`, `sql_query_completed`
- Web and CanLII: `web_search_started`, `web_search_completed`, `canlii_started`, `canlii_completed`
- Summary: `summarizer_started`, `summarizer_token`, `summarizer_completed`
- Verification: `verifier_started`, `verifier_check`, `verifier_completed`
- Iterative turns: `turn_classifier_started`, `turn_classifier_decision`, `memory_recall`, `refinement_started`, `refinement_completed`, `composition_started`, `composition_completed`, `diff_computed`
- Analytical query: `analytical_started`, `concept_extraction_started`, `concept_extraction_completed`, `plan_generation_started`, `plan_generation_completed`, `sql_compiled`, `sandbox_validation_started`, `sandbox_validation_completed`, `sandbox_execution_started`, `sandbox_execution_completed`, `analytical_completed`
- Control: `heartbeat`, `final_response`, `error`

The final streaming event is `final_response`. Its payload is the same discriminated-union response shape returned by the non-streaming endpoint.

## What Another Project Should Consume

Prefer HTTP integration:

- The consuming app owns the user-facing UI.
- This service owns conversation persistence, recipe execution, verification, and run provenance.
- The consuming app renders the four response types.
- For progress UI, consume SSE and render events as user-friendly status rows.
- For detail screens, call `GET /recipe_runs/{run_id}` only when needed.

Avoid importing internals:

- Do not import `recipes.*` or `primitives.*` into the consuming UI app.
- Do not treat recipe result columns as globally fixed. They vary by recipe.
- Do not bypass `/messages` and call recipes directly in production UI flows.
- Do not show unverified summaries as final answers without checking `verification.status`.

## Current Caveats

- This is a service-ready PoC, not a fully isolated Python package published to a package registry.
- It expects the hackathon database schema and data to exist.
- `adverse_media` performs live web and CanLII work and is quality-first, so it can run longer than SQL-only recipes.
- External URL verification can fail because an upstream source times out even when search discovery found it. Those failures are surfaced in `verification.failures`; they are not hidden.
- CORS is permissive for local integration. Put the service behind a reverse proxy or API gateway before production exposure.
- There is no built-in auth. Add auth at the reverse proxy/API gateway layer.

## Fast Confidence Checks

```bash
uv run python -m compileall output/ship
curl -s http://127.0.0.1:8765/healthz
curl -s http://127.0.0.1:8765/catalog
curl -s http://127.0.0.1:8765/openapi.json
```

To confirm no accidental investigation query is running:

```bash
node - <<'NODE'
const { Client } = require('./.local-db/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: 'postgresql://hackathon:hackathon@localhost:5432/hackathon' });
  await c.connect();
  const r = await c.query(`
    select pid, state, wait_event_type, wait_event, now()-query_start as age, left(query,160) as query
    from pg_stat_activity
    where datname='hackathon' and pid <> pg_backend_pid() and state <> 'idle'
    order by query_start
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})();
NODE
```
