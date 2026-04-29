# Ship Analyst Integration

`output/ship/` exposes the hybrid accountability analyst as a stateful HTTP service. A UI app creates a conversation, posts user messages, renders one of four response types, and fetches full recipe-run details only when the user opens a detail view.

## 1. Quickstart

Start the API:

```bash
uv run uvicorn output.ship.server:app --port 8765
```

Create a conversation:

```bash
curl -s -X POST http://localhost:8765/conversations
```

Example response:

```json
{"conversation_id":"00000000-0000-0000-0000-000000000000","created_at":"2026-04-29T12:00:00+00:00","title":null}
```

Ask a broad expensive question and render the clarification card:

```bash
curl -s -X POST http://localhost:8765/conversations/$ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Which orgs have adverse coverage?"}'
```

Example response:

```json
{
  "type": "clarification_needed",
  "message_id": "11111111-1111-1111-1111-111111111111",
  "headline": "This is broad enough to scan many funded entities. Narrow it for a precise answer.",
  "reason": "adverse_media without a named entity, top-N bound, time window, dimension restriction, or amount threshold",
  "suggested_narrowings": ["Name the organization, for example 'Hockey Canada'."],
  "example_refinements": ["Tell me about Hockey Canada's adverse coverage"],
  "proceed_phrase": "run the broad scan anyway"
}
```

Send a narrower question:

```bash
curl -s -X POST http://localhost:8765/conversations/$ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Tell me about Hockey Canada adverse coverage"}'
```

Example response:

```json
{
  "type": "answer",
  "message_id": "22222222-2222-2222-2222-222222222222",
  "summary": {"headline": "...", "paragraphs": [], "caveats": []},
  "findings_preview": [],
  "recipe_run_id": "33333333-3333-3333-3333-333333333333",
  "based_on_run_id": null,
  "verification": {"status": "pass", "failures": [], "latency_ms": 150, "checks": {}},
  "latency_ms": 56000
}
```

## 2. Conversation Lifecycle

```text
UI creates conversation
  -> user sends message
  -> service stores user message
  -> router decides execute/refine/clarify/needs_new_conversation/not_answerable
  -> recipe or cached-refinement path runs
  -> verifier checks the published answer
  -> service stores assistant message and recipe_run metadata
  -> UI renders response
```

Old conversations stay server-side in `investigator.ship_conversations`, `investigator.ship_messages`, and `investigator.ship_recipe_runs`. A `DELETE /conversations/{id}` call archives the conversation so it no longer appears in the default list; it does not physically delete the audit trail.

## 3. Endpoint Reference

### POST /conversations

Request body is optional:

```json
{"title":"optional title"}
```

Response:

```json
{"conversation_id":"uuid","created_at":"timestamp","title":"optional title"}
```

### POST /conversations/{conversation_id}/messages

Request:

```json
{"content":"Which charities had high government funding and stopped filing?"}
```

Response: one of `answer`, `clarification_needed`, `needs_new_conversation`, or `not_answerable`.

### GET /conversations

Response:

```json
{
  "conversations": [
    {"conversation_id":"uuid","title":"...","created_at":"...","updated_at":"...","message_count":4}
  ]
}
```

### GET /conversations/{conversation_id}

Returns message history plus recipe-run metadata. Full findings are intentionally omitted here so the thread view stays lightweight.

```json
{
  "conversation_id": "uuid",
  "title": "...",
  "messages": [{"message_id":"uuid","role":"user","content":{"text":"..."},"created_at":"..."}],
  "recipe_runs": [{"run_id":"uuid","recipe_id":"funding_loops","params":{},"latency_ms":18000,"created_at":"..."}]
}
```

### GET /recipe_runs/{run_id}

Returns the full stored result for a detail drawer or audit screen:

```json
{
  "run_id": "uuid",
  "recipe_id": "funding_loops",
  "params": {},
  "findings": [],
  "sql_log": [],
  "summary": {},
  "verification": {},
  "latency_ms": 18000
}
```

### DELETE /conversations/{conversation_id}

Soft-archives the conversation.

```json
{"conversation_id":"uuid","status":"archived"}
```

### GET /catalog

Returns the registered recipe catalog:

```json
{"recipes":[{"recipe_id":"adverse_media","description":"...","params":["top_n"],"examples":["..."],"requires_specificity":true}]}
```

### GET /healthz

Returns `{"status":"ok"}` when Postgres is reachable.

### GET /docs

FastAPI's built-in OpenAPI/Swagger UI.

## 4. Response Types

### answer

Render as an assistant answer with a summary, the first five findings, and a link/button that fetches `/recipe_runs/{recipe_run_id}` for details.

```json
{
  "type": "answer",
  "message_id": "uuid",
  "summary": {"headline":"...","paragraphs":[{"text":"...","citations":[{"finding_index":0}]}],"caveats":[]},
  "findings_preview": [{"canonical_name":"..."}],
  "recipe_run_id": "uuid",
  "based_on_run_id": null,
  "verification": {"status":"pass","failures":[],"latency_ms":120,"checks":{}},
  "latency_ms": 22000
}
```

If `based_on_run_id` is non-null, the answer is a cached refinement of an earlier result and did not run fresh source SQL or web search.

### clarification_needed

Render as a narrowing card with suggested chips and a text box.

```json
{
  "type": "clarification_needed",
  "message_id": "uuid",
  "headline": "...",
  "reason": "...",
  "suggested_narrowings": ["Name the organization"],
  "example_refinements": ["Tell me about Hockey Canada's adverse coverage"],
  "proceed_phrase": "run the broad scan anyway"
}
```

### needs_new_conversation

Render as a friendly boundary message with a "Start new conversation" action prefilled with `suggested_starter`.

```json
{
  "type": "needs_new_conversation",
  "message_id": "uuid",
  "reason": "Your follow-up asks about a different investigation surface.",
  "suggested_starter": "What charity funding loops exist?",
  "current_conversation_topic": "adverse-media funding overlap"
}
```

### not_answerable

Render as a normal assistant refusal for out-of-scope questions.

```json
{"type":"not_answerable","message_id":"uuid","message":"No deterministic recipe can answer this question yet."}
```

## 5. Recipe Catalog

Use `GET /catalog` to build an optional recipe picker, explain capability coverage, or decide whether to show a "broad scan may take longer" note. Expensive recipes currently set `requires_specificity=true`:

| Recipe | Requires Specificity | Typical Use |
| --- | --- | --- |
| `adverse_media` | true | Serious adverse signals plus funding overlap |
| `related_parties` | true | Director/governance overlap |
| `policy_misalignment` | true | Keyword/proxy policy coverage |
| SQL-only recipes | false | Fast bounded top-N answers |

## 6. Refinement Examples

After an `answer`, the next user message can refine the stored findings in memory:

```text
show only above $5M
sort by total funding
show external recipients only
tell me about finding 3
```

The response is another `answer` with `based_on_run_id` set. Its stored recipe run has an empty `sql_log`, which proves it filtered cached findings rather than re-querying the source datasets.

If the follow-up asks for fresh data, for example "now find charity loops" after an adverse-media run, the service returns `needs_new_conversation`.

## 7. Error Handling

Error body shape follows FastAPI defaults:

```json
{"detail":"conversation ... does not exist or is archived"}
```

Common statuses:

| Status | Meaning |
| ---: | --- |
| 200 | Request completed |
| 404 | Conversation or recipe run not found |
| 422 | Request body failed validation |
| 500 | Unexpected server/runtime failure |

Every published `answer` includes a verifier result. If verification fails, the API still returns the structured answer with `verification.status="failed"` and a non-empty `failures` list so the UI can block publishing, show a warning, or route to review.

## 8. Auth Note

There is no built-in authentication. For production, put this service behind a reverse proxy or API gateway that handles authentication, rate limits, audit logging, and hardened CORS.

## 9. Local Development

Environment:

```bash
DATABASE_URL=postgresql+asyncpg://hackathon:hackathon@localhost:5432/hackathon
OPENAI_API_KEY=...
CANLII_API_KEY=... # optional, improves adverse-media court lookups
```

Run:

```bash
uv run uvicorn output.ship.server:app --host 127.0.0.1 --port 8765 --reload
```

The server bootstraps the `investigator.ship_*` tables on startup. It enables permissive CORS for local integration; harden CORS at the reverse proxy before production exposure.

## 10. Python Client Snippet

```python
import requests

BASE = "http://localhost:8765"

conversation = requests.post(f"{BASE}/conversations", json={}).json()
conversation_id = conversation["conversation_id"]

response = requests.post(
    f"{BASE}/conversations/{conversation_id}/messages",
    json={"content": "Which charities had government funding above 70% and stopped filing?"},
    timeout=180,
).json()

if response["type"] == "answer":
    print(response["summary"]["headline"])
    run = requests.get(f"{BASE}/recipe_runs/{response['recipe_run_id']}").json()
    print(len(run["findings"]), "findings")
elif response["type"] == "clarification_needed":
    print(response["headline"])
    print(response["example_refinements"])
elif response["type"] == "needs_new_conversation":
    print(response["reason"])
else:
    print(response["message"])
```

## 11. TypeScript/JS Client Snippet

```ts
const BASE = "http://localhost:8765";

type AssistantResponse =
  | { type: "answer"; summary: { headline: string }; recipe_run_id: string; based_on_run_id: string | null; findings_preview: unknown[]; verification: { status: string; failures: string[] } }
  | { type: "clarification_needed"; headline: string; suggested_narrowings: string[]; example_refinements: string[]; proceed_phrase: string }
  | { type: "needs_new_conversation"; reason: string; suggested_starter: string; current_conversation_topic: string | null }
  | { type: "not_answerable"; message: string };

async function createConversation(): Promise<string> {
  const response = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await response.json();
  return body.conversation_id;
}

async function sendMessage(conversationId: string, content: string): Promise<AssistantResponse> {
  const response = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

const conversationId = await createConversation();
const answer = await sendMessage(conversationId, "Show me the largest charity funding loops");

if (answer.type === "answer") {
  console.log(answer.summary.headline);
  const detail = await fetch(`${BASE}/recipe_runs/${answer.recipe_run_id}`).then((r) => r.json());
  console.log(detail.findings);
} else if (answer.type === "clarification_needed") {
  console.log(answer.example_refinements);
}
```

## 12. Streaming Progress (SSE)

Use streaming when the UI should show live progress instead of waiting for the final JSON response. The same message endpoint supports it with `?stream=true`:

```bash
curl -N -X POST "http://localhost:8765/conversations/$ID/messages?stream=true" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding loops"}'
```

The server still persists the user message, assistant response, and recipe run exactly as the non-streaming endpoint does. If the browser tab or HTTP client disconnects, the stream to that client stops but the server-side run continues and can be recovered with `GET /conversations/{id}` and `GET /recipe_runs/{run_id}` after completion.

When to use streaming:

| Flow | Typical Duration | Recommendation |
| --- | ---: | --- |
| SQL recipes | 18-45s | Use streaming for a calmer progress UI. |
| `adverse_media` | 60-120s | Streaming is strongly recommended because web and CanLII work are visible. |
| Cached refinements | Usually under 10s | Optional; useful if the UI already consumes stream events. |
| Clarification / not answerable | Near-instant | Non-streaming is usually enough. |

SSE format:

```text
event: router_started
id: 1
data: {"event":"router_started","ts":"2026-04-29T12:30:00.000Z","data":{}}

```

The `event:` field is the SSE event name. The JSON body repeats the event name, includes an ISO timestamp, and puts the event-specific payload under `data`. The terminal event is always `final_response` when the run completes successfully; its nested `data` value is the same response shape returned by the non-streaming endpoint.

Event reference:

| Event | When It Fires | Payload |
| --- | --- | --- |
| `router_started` | The service begins routing or controller refinement detection. | `{}` |
| `router_decision` | Routing/refinement decision is known. | `{decision, recipe_id, reasoning_one_line}` |
| `phase_started` | A high-level phase begins. | `{phase}` where phase is `primitive`, `summarizer`, `verifier`, or `refinement_filter` |
| `primitive_started` | A primitive begins real work. | `{primitive_name, args_summary}` |
| `sql_query_started` | A bounded SQL query begins. | `{primitive_name, query_name}` |
| `sql_query_completed` | A SQL query returns. | `{primitive_name, query_name, row_count, timing_ms}` |
| `web_search_started` | A hosted web-search task begins. | `{primitive_name, query}` |
| `web_search_completed` | A web-search task returns. | `{primitive_name, query, result_count, timing_ms}` |
| `canlii_started` | A CanLII API lookup begins. | `{entity_name, query}` |
| `canlii_completed` | A CanLII API lookup returns. | `{entity_name, case_count, timing_ms}` |
| `primitive_completed` | A primitive returns its bounded result. | `{primitive_name, row_count, caveats, timing_ms}` |
| `summarizer_started` | The cited summary begins. | `{prompt_token_estimate}` |
| `summarizer_token` | Text arrives from the summarizer or cached-refinement renderer. | `{text}` |
| `summarizer_completed` | Summary generation finishes. | `{prompt_tokens, completion_tokens}` |
| `refinement_filter_applied` | Cached findings are filtered/sorted/detailed in memory. | `{filter, before_count, after_count}` |
| `verifier_started` | Deterministic verification begins. | `{}` |
| `verifier_check` | One verifier check finishes. | `{check, status, details}` |
| `verifier_completed` | Verification finishes. | `{status, failures, latency_ms}` |
| `heartbeat` | No other event was available for 10s during long work. | `{elapsed_ms}` |
| `final_response` | The response is ready and persisted. | One of `answer`, `clarification_needed`, `needs_new_conversation`, or `not_answerable` under nested `data` |
| `error` | An unexpected service boundary error occurred. | `{message, retryable}` |

### JavaScript Fetch Stream

Native `EventSource` only supports `GET`, so use `fetch` plus `ReadableStream` for this `POST` endpoint:

```ts
type StreamEvent = { event: string; ts: string | null; data: unknown };

async function sendStreamingMessage(conversationId: string, content: string) {
  const response = await fetch(`${BASE}/conversations/${conversationId}/messages?stream=true`, {
    method: "POST",
    headers: {
      "Accept": "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const lines = block.split("\n");
      const eventName = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const dataLine = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!eventName || !dataLine) continue;
      const event = JSON.parse(dataLine) as StreamEvent;
      handleProgressEvent(eventName, event.data);
      if (eventName === "final_response") return event.data;
    }
  }
}
```

### Python HTTPX Stream

```python
import json
import httpx

async def send_streaming_message(base: str, conversation_id: str, content: str):
    url = f"{base}/conversations/{conversation_id}/messages?stream=true"
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            url,
            headers={"Accept": "text/event-stream"},
            json={"content": content},
        ) as response:
            response.raise_for_status()
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                blocks = buffer.split("\n\n")
                buffer = blocks.pop() or ""
                for block in blocks:
                    lines = block.split("\n")
                    event_name = next((line[7:] for line in lines if line.startswith("event: ")), None)
                    data = next((line[6:] for line in lines if line.startswith("data: ")), None)
                    if not event_name or not data:
                        continue
                    payload = json.loads(data)
                    print(event_name, payload["data"])
                    if event_name == "final_response":
                        return payload["data"]
```

### Reverse Proxy Notes

Disable buffering for `text/event-stream`. For nginx:

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

Native `EventSource` cannot send custom headers, which complicates bearer-token auth. For authenticated integrations, prefer `fetch + ReadableStream` or place auth at the integrator's reverse-proxy/API-gateway layer.

## 13. Consuming This From Another Project

The recommended integration pattern is sidecar HTTP:

```text
Your application
  -> HTTP JSON or SSE
  -> Ship Analyst Service at http://host:8765
  -> hackathon Postgres + OpenAI + optional CanLII
```

In the consuming project, keep one environment variable for the service base URL:

```bash
SHIP_ANALYST_BASE_URL=http://127.0.0.1:8765
```

Then build the UI around these stable concepts:

- A conversation id created by `POST /conversations`.
- A message submit action that calls `POST /conversations/{id}/messages`.
- Four response renderers: `answer`, `clarification_needed`, `needs_new_conversation`, `not_answerable`.
- A progress renderer for `?stream=true`.
- A detail drawer that fetches `GET /recipe_runs/{recipe_run_id}`.

Do not copy recipe internals into the consuming app. Treat recipe ids as backend metadata and route all user questions through the service.

## 14. Frontend Rendering Checklist

A production-feeling UI should include:

- New conversation button: calls `POST /conversations`.
- Conversation list: calls `GET /conversations`.
- Conversation transcript: calls `GET /conversations/{id}`.
- Message composer: posts the user message and disables while in flight.
- Progress panel: subscribes to SSE and renders plain-language progress rows.
- Draft answer area: appends `summarizer_token` text during streaming.
- Final answer card: replaces draft text when `final_response` arrives.
- Verification badge: green for `pass`, warning for `failed`.
- Findings preview table: shows `findings_preview`.
- Evidence drawer: calls `GET /recipe_runs/{run_id}` and shows full findings, SQL log, caveats, and verification failures.
- Clarification card: shows `suggested_narrowings`, `example_refinements`, and a broad-scan action using `proceed_phrase`.
- New-conversation boundary: shows `suggested_starter` and offers to create a new conversation.

## 15. Response Handling Pseudocode

```ts
function renderAssistantResponse(response: AssistantResponse) {
  switch (response.type) {
    case "answer":
      renderSummary(response.summary);
      renderVerification(response.verification);
      renderFindingsPreview(response.findings_preview);
      showEvidenceButton(response.recipe_run_id);
      if (response.based_on_run_id) showCachedRefinementBadge();
      break;
    case "clarification_needed":
      renderClarificationCard(response.headline, response.suggested_narrowings, response.example_refinements);
      break;
    case "needs_new_conversation":
      renderNewConversationBoundary(response.reason, response.suggested_starter);
      break;
    case "not_answerable":
      renderAssistantNotice(response.message);
      break;
  }
}
```

## 16. Operational Boundary

This service owns:

- Routing and recipe selection.
- SQL/web/CanLII execution.
- Conversation persistence.
- Recipe-run persistence.
- Summarization.
- Verification.
- SSE progress events.

The consuming app owns:

- Login/auth.
- User/tenant ownership.
- Billing/rate-limit display.
- Final visual design.
- Conversation list placement.
- Evidence table rendering.
- Human review workflow for failed verification.

For deployment, read [SERVICE_HANDOFF.md](./SERVICE_HANDOFF.md). For future code changes inside this folder, read [AGENTS.md](./AGENTS.md).
