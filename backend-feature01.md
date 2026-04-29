# Backend Feature 01: Make the SSE Stream Feel Alive

## 0. The Goal in One Sentence

The frontend (see `frontend-feature01.md`) is being upgraded to render the analyst's work in real time — multi-agent activity feed, phase pipeline, and token-by-token answer streaming. None of that lands if the backend buffers tokens, silently runs phases, or skips heartbeats during long stretches. This brief makes the existing SSE stream **chatter at the right cadence** so the UI demo feels like ChatGPT/Gemini rather than a slow form submit.

Hackathon budget: ≤ 30 minutes of backend work. No new endpoints, no new event types, no schema changes. Just timing fixes and small instrumentation tweaks.

## 1. Scope and Constraints

- Stack: Python, FastAPI, asyncpg, Pydantic-AI. Codebase root `services/ship/output/ship/`.
- The SSE event union is **frozen** — do not add or rename events. The frontend already handles all 21 event types.
- Files in scope:
  - `services/ship/output/ship/server.py` — FastAPI streaming response setup.
  - `services/ship/output/ship/orchestrator.py` — turn driver; emits events.
  - `services/ship/output/ship/summarizer.py` — token-stream loop.
- Anything that requires schema migrations, new dependencies, or LLM-provider swaps is **out of scope**.

## 2. The Five Required Fixes

### 2.1 Stream tokens as they arrive (no buffering)

`summarizer.py` must emit one `summarizer_token` SSE event per token (or per ≤ 5-character chunk) as the LLM streams. Today's batching makes the answer prose appear in big lurches.

If using Anthropic's streaming API (Pydantic-AI `Agent.run_stream` or equivalent), the loop should look like:

```python
async with agent.run_stream(prompt, ...) as result:
    async for delta in result.stream_text(delta=True):
        if not delta:
            continue
        emit(Event("summarizer_token", {"text": delta}))
        # No artificial buffering. Yield to the event loop so the SSE
        # writer can flush before the next token arrives.
        await asyncio.sleep(0)
```

If using OpenAI-style chat streaming, the equivalent is `for chunk in stream: emit(...); await asyncio.sleep(0)`.

**Hard rule:** do not concatenate tokens server-side before emitting. The frontend throttles re-renders; the network and the LLM should drive the cadence.

### 2.2 SSE flush per event

Verify the `StreamingResponse` in `server.py` is configured for unbuffered output:

```python
from fastapi.responses import StreamingResponse

def _stream_message_response(...) -> StreamingResponse:
    async def event_stream():
        async for event in produce():
            yield event.encode_sse()  # 'event: name\ndata: {…}\n\n' as bytes

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",        # <-- nginx: don't buffer
            "Content-Encoding": "identity",   # <-- avoid gzip buffering proxies
        },
    )
```

Add the `X-Accel-Buffering: no` and `Content-Encoding: identity` headers if not already present. Without these, an nginx or Cloud Run sidecar will buffer ~4KB and the user will see big jumps every couple seconds rather than smooth token flow.

If `produce()` writes to a queue, ensure the queue is unbounded or large enough that producers never block on consumers (uvicorn writes are non-blocking already, but worth checking).

### 2.3 Heartbeats during long phases

The frontend's "Still working — Xs" caption only appears when no event has fired for 10s. Today's orchestrator is silent during long SQL queries (>5s) because the primitive runs in a single `await`. Wrap each long-running primitive in a heartbeat task:

```python
async def _with_heartbeats(emit, started_at, coro, *, interval: float = 5.0):
    """Run `coro` while emitting heartbeat events every `interval` seconds."""
    task = asyncio.create_task(coro)
    while not task.done():
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=interval)
        except asyncio.TimeoutError:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            emit(Event("heartbeat", {"elapsed_ms": elapsed_ms}))
    return await task
```

Wrap every `await primitive.run(...)`, `await sql_query.execute(...)`, `await web_search(...)`, and `await canlii(...)` call in `_with_heartbeats(...)`. The first heartbeat fires at +5s, the second at +10s, etc. Don't fire heartbeats around fast (<1s) calls — only around the slow ones. Easy filter: emit the heartbeat only if `elapsed > 3s` since the last meaningful event.

### 2.4 Phase transition events

The `phase_started` event is the anchor the UI uses to advance the pipeline strip from one phase to the next. Today some phase transitions are implicit (the orchestrator just starts running the next phase). Make every transition explicit:

```python
emit(Event("phase_started", {"phase": "route"}))
# … router work …
emit(Event("phase_started", {"phase": "retrieve"}))
# … primitive + sql work …
emit(Event("phase_started", {"phase": "synthesize"}))
emit(Event("summarizer_started", {"prompt_token_estimate": …}))
# … summarizer streaming …
emit(Event("phase_started", {"phase": "verify"}))
emit(Event("verifier_started", {}))
# … verifier work …
```

The frontend's `streamPhases.ts` already maps phase events to UI pills; this just makes the pipeline animate at the right moments.

### 2.5 Promptly emit `verifier_check` events

Whatever loop runs the grounding checks should emit one `verifier_check` per check (pass/fail) as it runs, not all at once at the end. The frontend renders each check as a sub-row and animates the pass/fail state — bunched-at-end emission breaks the demo.

```python
for check_name, check_fn in checks:
    status, details = await check_fn(...)
    emit(Event("verifier_check", {
        "check": check_name,
        "status": status,         # 'pass' | 'fail'
        "details": details,
    }))
    await asyncio.sleep(0)
```

## 3. Optional 5-Minute Wins

If time allows after the five required fixes:

### 3.1 `prompt_token_estimate` accuracy

`summarizer_started.data.prompt_token_estimate` is shown in the UI as `~9,400 input tokens`. If today's value is a placeholder (e.g. 0 or a hard-coded constant), spend 30 seconds wiring it to the actual prompt length:

```python
emit(Event("summarizer_started", {
    "prompt_token_estimate": len(prompt) // 4,  # 4 chars per token rule of thumb
}))
```

### 3.2 Recipe ID in router_decision

The UI shows `router_decision.data.recipe_id` as a small mono pill ("vendor_concentration"). Make sure the orchestrator passes the actual recipe ID into the event payload (not `null`) when a recipe was picked.

### 3.3 args_summary populated

The activity card renders `primitive_started.data.args_summary` as a small `key: value` row. If today's payload is an empty dict, drop the 2 most informative args (e.g. recipe params or the entity name).

## 4. Acceptance Criteria

Run the analyst against the schools question end-to-end and verify with `curl -N`:

```bash
curl -N -X POST http://localhost:8765/conversations/<id>/messages?stream=true \
  -H "Content-Type: application/json" \
  -d '{"content":"which schools received funding in 2024?"}' | head -200
```

You should observe (timestamps approximate):

1. **t=0s** — `event: turn_classifier_started` (if you've shipped `service-prompt.md`'s classifier; otherwise skip) followed immediately by `event: phase_started` with `phase=route` and `event: router_started`.
2. **t≈0.5s** — `event: router_decision` with a real `recipe_id` (not null), then `event: phase_started` with `phase=retrieve`.
3. **t≈0.7s** — `event: primitive_started` with non-empty `args_summary`, then `event: sql_query_started`.
4. **t≈1.5–4s** — `event: sql_query_completed` with the actual `row_count` and `timing_ms`.
5. **If retrieve > 5s** — at least one `event: heartbeat` fires before completion.
6. **t≈5s** — `event: phase_started` with `phase=synthesize`, then `event: summarizer_started` with a non-zero `prompt_token_estimate`.
7. **t≈5.1s onward** — a continuous stream of `event: summarizer_token` events, one per token (or per ≤ 5-char chunk), at roughly 20–60 events/sec. The chunks are *short*; you should see clearly individual tokens, not 200-char dumps every 2 seconds.
8. **t≈8s** — `event: summarizer_completed`, then `event: phase_started` with `phase=verify`, then `event: verifier_started`.
9. **t≈8–10s** — multiple `event: verifier_check` events, one per check, spaced apart in time (not all on the same tick).
10. **t≈10s** — `event: verifier_completed` then `event: final_response`.

Time the deltas between events with `ts` if needed (`apt install moreutils && curl -N … | ts '%H:%M:%.S'`); the visual cue is "stream looks alive in the terminal" rather than "long pauses + bursts".

In the browser:

11. The UI's `Synthesize` pill activates exactly when `phase_started{phase=synthesize}` arrives.
12. The answer prose region's caret pulses smoothly while text grows. The text grows in small chunks (single tokens or punctuation), not in 200-char batches.
13. During a long primitive (>5s), the activity card shows "Still working — 8s" beneath the running step. (This is the heartbeat path firing.)
14. Verifier checks appear as individual sub-rows with their pass/fail status one-by-one, not all at once.

## 5. Non-Goals

- Do not add new SSE event types.
- Do not change `AnswerResponse` or any other Pydantic model.
- Do not introduce websockets, gRPC, or any new transport.
- Do not add Redis/queues or async fan-out infrastructure.
- Do not change the LLM provider.
- Do not add SSE event compression.
- Do not throttle on the server side — the frontend handles re-render throttling.

## 6. Order of Operations (≤ 30-minute build)

1. (5 min) Patch `summarizer.py`: per-token emit + `await asyncio.sleep(0)`. Verify with `curl -N` that tokens arrive smoothly.
2. (5 min) Patch `server.py` headers: `X-Accel-Buffering: no` + `Content-Encoding: identity`. Verify behind any proxy in the deployment.
3. (10 min) Wrap long awaits in `_with_heartbeats(...)` in `orchestrator.py`. Confirm a heartbeat fires when an SQL query takes > 5s.
4. (5 min) Add explicit `phase_started` events for each of the 4 phase transitions in `orchestrator.py`.
5. (3 min) Wire `verifier_check` to emit per check rather than at the end.
6. (2 min) curl the schools question, eyeball the cadence, ship it.

If you only have 15 minutes, do steps 1–2. That alone unlocks 80% of the perceived "alive" effect.
