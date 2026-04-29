# Agent Instructions for `output/ship`

This folder is the portable service surface for the ship-mode accountability analyst. Treat it as an HTTP backend that another application consumes, not as a throwaway CLI demo.

## Product Contract

`output/ship` accepts natural-language questions about the loaded Canadian public-accountability database and returns one of four response types:

- `answer`: a verified analytical answer with cited summary text, a bounded findings preview, a `recipe_run_id`, and verification details.
- `clarification_needed`: a narrowing card for broad expensive investigations.
- `needs_new_conversation`: a boundary response when a follow-up requires fresh SQL, web search, CanLII, or a different recipe.
- `not_answerable`: a structured out-of-scope response.

The stable integration surface is the FastAPI service in `server.py`. A separate UI should consume the HTTP API, not import recipe or primitive internals.

## Stable Files

- `server.py`: FastAPI app, route definitions, CORS, lifecycle, streaming response transport.
- `orchestrator.py`: conversation persistence, router branching, execute/refine handling, SSE event generator.
- `bootstrap_schema.py`: owns the `investigator.ship_*` tables.
- `router.py`: LLM router for execute/refine/clarify/needs-new-conversation/not-answerable.
- `summarizer.py`: cited summary generation and token streaming.
- `verify.py`: deterministic answer verification.
- `runtime_config.py`: local environment-backed service config. Do not reintroduce imports from the parent `src` package.
- `recipes/`: deterministic recipe orchestration.
- `primitives/`: deterministic SQL/web/CanLII analytical building blocks.
- `INTEGRATION.md`: API and client integration guide.
- `SERVICE_HANDOFF.md`: operator and extraction handoff for using this service from another project.

## Architecture Rules

1. Keep this package sidecar-friendly. New ship-service code should import from `output.ship.*`, Python standard library, declared project dependencies, or environment variables. Do not add new imports from the parent app's `src.*` tree.
2. Preserve the HTTP contract. If a response shape changes, update `INTEGRATION.md`, `SERVICE_HANDOFF.md`, and any client snippets in the same pass.
3. Preserve non-streaming behavior when changing streaming. `POST /conversations/{id}/messages` without `stream=true` must keep returning the final JSON payload directly.
4. Streaming is opt-in. `POST /conversations/{id}/messages?stream=true` must emit SSE progress and finish with `final_response` whose nested payload matches the non-streaming response shape.
5. If a streaming client disconnects, do not cancel the underlying conversation run. The server-side run should continue and persist so the UI can recover through `GET /conversations/{id}` and `GET /recipe_runs/{run_id}`.
6. Keep follow-ups cheap. If a follow-up can be answered from cached findings, refine in memory and persist a run with `based_on_run_id`. If it needs fresh SQL/web/CanLII or a different recipe, return `needs_new_conversation`.
7. Keep the verifier in the publish path. Do not return `answer` from the service without verification metadata.
8. Do not hardcode scenario-specific entities, URLs, ministries, or expected rows. Recipes can be parameterized; primitives must stay reusable.
9. Bound outputs and expensive work. SQL result rows, web searches, CanLII calls, and summarizer payloads must stay bounded and documented.
10. Keep `investigator.ship_*` as the service-owned persistence surface. New service tables should remain under the `investigator` schema.

## Documentation Rules

When you modify service behavior, update the docs in the same change:

- `README.md` for the high-level operator/integrator entry point.
- `INTEGRATION.md` for endpoint, response, and streaming details.
- `SERVICE_HANDOFF.md` for deployment, extraction, operational caveats, and consumer guidance.
- `SHIP_LOG.md` for proof, caveats, or known runtime observations.

## Verification Expectations

Use the lightest verification that proves the change:

- Import/config/doc-only changes: `uv run python -m compileall output/ship` plus route/import sanity checks.
- API route changes: `GET /healthz`, `GET /catalog`, OpenAPI shape, and one non-heavy message-path smoke.
- Streaming changes: one SQL-recipe stream and one cached-refinement stream when the user has not asked to stop test runs.
- Adverse-media changes: do not run broad web scans casually. They are slower, can hit external-source timeouts, and should be run only when the task explicitly requires it.

Before finishing, confirm there are no accidental long-running test clients and no active investigation SQL queries unless the user explicitly asked to leave one running.

## Environment

Required:

- `DATABASE_URL`: accepts either `postgresql://...` or `postgresql+asyncpg://...`; the service normalizes it for `asyncpg`.
- `OPENAI_API_KEY`: required for router, summarizer, web extraction, and adverse-signal classification.

Optional:

- `CANLII_API_KEY`: improves adverse-media court-record lookup and CanLII URL verification.
- `PRIMARY_MODEL`: defaults to `gpt-5.5`.
- `FAST_MODEL`: defaults to `gpt-5.5`.

Do not commit real secret values.
