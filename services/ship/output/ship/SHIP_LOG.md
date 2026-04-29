# Ship Log

| Recipe | Status | Last Run | Verification | Notes |
| --- | --- | --- | --- | --- |
| funding_loops | shipped | 2026-04-29 direct CLI recipe run, 15.853s | pass | Pre-computed CRA `johnson_cycles`/participants path; 3 cited findings, 14 numeric claims verified, 12 canonical entities verified. |
| zombie_recipients | shipped | 2026-04-29 direct recipe sweep, 19.739s | pass | CRA government-funding-then-silent path returned grounded filing/funding rows after recursive numeric extraction fix. |
| ghost_capacity | shipped | 2026-04-29 direct recipe sweep, 14.445s | pass | CRA overhead plus compensation signal returned grounded rows inside the SQL-only 30s target. |
| duplicative_funding | shipped | 2026-04-29 direct recipe sweep, 21.562s | pass | `general.vw_entity_funding` multi-source funding screen returned grounded canonical-entity rows. |
| vendor_concentration | shipped | 2026-04-29 direct recipe sweep, 19.759s | pass | AB/federal concentration and HHI findings verified after explicit `hhi_10000` grounding. |
| sole_source_amendment | shipped | 2026-04-29 direct recipe sweep, 22.192s | pass | AB sole-source concentration/trend path verified with source-record supplier caveats. |
| contract_intelligence | shipped | 2026-04-29 direct recipe sweep, 18.127s | pass | Contract trend/concentration path verified after HHI-scale numeric grounding. |
| related_parties | shipped | 2026-04-29 direct recipe sweep, 29.544s | pass | CRA director overlap path ships under the SQL-only 30s target with governance caveats. |
| policy_misalignment | shipped | 2026-04-29 direct recipe sweep, 22.161s | pass | Coverage-audit plus keyword-spending path verified; outputs data-availability caveats instead of overclaiming policy fit. |
| adverse_media | shipped | 2026-04-29 direct CLI recipe run, 49.452s | pass | Quality-first web corroboration: 3 live OIPC/OAG URLs checked with PDF text extraction and a 120s web-answer budget. |

## Verification Notes

- `output/ship.run` now supports stateful conversations through the same orchestration layer as the HTTP service. The original recipe rows above remain direct CLI/sweep evidence for recipe correctness.
- SQL-only recipes keep the 30-second latency target. URL-cited adverse-media answers use a 120-second verification budget because live official-source web corroboration is quality-first.
- `adverse_media` filters CanLII URLs because they returned HTTP 403 to the verifier in this environment; direct official regulator, auditor, court, or government pages are preferred.

## Manual Database Audit

- 2026-04-29: independent manual DB audit passed all 10 recipes. The audit reran each recipe, then used separate source-table/view SQL checks to compare the leading IDs, canonical names, totals, counts, periods, concentration metrics, trend values, and URL liveness where applicable.
- Detailed report: `output/ship/MANUAL_DB_AUDIT.md`
- Machine-readable result: `output/ship/manual_db_audit_results.json`

## Conversational Service Layer Shipped

- 2026-04-29: `output/ship/server.py` exposes the integrator API: `POST /conversations`, `POST /conversations/{conversation_id}/messages`, `GET /conversations`, `GET /conversations/{conversation_id}`, `GET /recipe_runs/{run_id}`, `DELETE /conversations/{conversation_id}`, `GET /catalog`, `GET /healthz`, and FastAPI `/docs`.
- Persistence is in `investigator.ship_conversations`, `investigator.ship_messages`, and `investigator.ship_recipe_runs`; server startup bootstraps the tables if missing.
- Response types are `answer`, `clarification_needed`, `needs_new_conversation`, and `not_answerable`. Router internal decisions are `execute`, `refine`, `clarify`, `needs_new_conversation`, and `not_answerable`.
- Smoke evidence: broad expensive question `Which orgs have adverse coverage?` returned `clarification_needed`; final clean funding-loops conversation `49c5e614-d01f-43c0-9c2f-67761909fb92` produced answer run `60b3df40-28d3-4adf-b7e3-28cd85bbb2f5` with verifier pass; cached refinement run `cdd0330d-2bab-459f-9b23-1622fd5c3d6a` had `based_on_run_id=60b3df40-28d3-4adf-b7e3-28cd85bbb2f5`, `sql_log=[]`, verifier pass, and 9ms latency; different-scenario follow-up returned `needs_new_conversation`.
- Restart persistence check passed: after restarting uvicorn, `GET /conversations/fd68cdab-918b-40d3-9f27-3f79a6e6766a` returned the stored title, 8 messages, and 3 recipe-run metadata rows.
- Integrator documentation: `output/ship/INTEGRATION.md`.

## Streaming Progress Shipped

- 2026-04-29: `POST /conversations/{conversation_id}/messages?stream=true` now returns `text/event-stream` while the original non-streaming `POST /conversations/{conversation_id}/messages` still returns the final JSON response.
- Event coverage includes router decisions, phase starts, primitive starts/completions, SQL lifecycle, web search lifecycle, CanLII lifecycle, summarizer token deltas, cached refinement filters, verifier checks, heartbeat, and terminal `final_response`.
- Disconnect behavior follows the final ship instruction: a closed browser/client stops receiving the SSE stream, but the server-side conversation run is not cancelled and continues to persist the assistant message and recipe run for recovery through `GET /conversations/{id}` and `GET /recipe_runs/{run_id}`.
- Integrator documentation was extended in `output/ship/INTEGRATION.md` with the SSE event table, `fetch + ReadableStream` example, Python `httpx` stream example, and nginx buffering guidance.

## Portable Service Handoff Prepared

- 2026-04-29: `output/ship` now has a local `AGENTS.md` that defines the service contract, stable files, architecture rules, docs rules, verification expectations, and environment requirements for future agents working inside the service package.
- `output/ship/SERVICE_HANDOFF.md` is the detailed operator/integrator manual for using the PoC as a sidecar service from another project. It covers runtime requirements, sidecar topology, product flow, endpoint contract, response rendering, SSE UX, persistence, stable-vs-internal boundaries, extraction steps, reverse proxy notes, security, troubleshooting, and verification commands.
- `output/ship/README.md` was rewritten as the quick entry point for service consumers, pointing to the handoff, integration guide, local agent rules, and proof log.
- `output/ship/INTEGRATION.md` was extended with consuming-app guidance, frontend rendering checklist, response handling pseudocode, and the operational boundary between the consuming app and the ship service.
- Portability hardening: ship-only LLM/web configuration now lives in `output.ship.runtime_config`, and ship package code no longer imports the parent app's `src.core.config`. The service still expects the loaded hackathon database schemas and should be consumed over HTTP unless it is intentionally lifted with its dependencies.
