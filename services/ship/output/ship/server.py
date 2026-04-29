"""FastAPI service for the ship-mode analyst."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .bootstrap_schema import bootstrap_schema
from .orchestrator import (
    archive_conversation,
    create_conversation,
    get_conversation,
    get_recipe_run,
    handle_user_message,
    list_conversations,
    stream_user_message,
)
from .memory import forget_run, pin_run, unpin_run
from .primitives.base import create_pool
from .recipes.catalog import catalog_for_prompt
from .schema_catalog import get_catalog
from .lexicon import get_lexicon


class ConversationCreate(BaseModel):
    title: str | None = None


class MessageCreate(BaseModel):
    content: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool()
    await bootstrap_schema(pool)
    app.state.pool = pool
    yield
    await pool.close()


app = FastAPI(title="Ship Analyst Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _pool() -> asyncpg.Pool:
    return app.state.pool


@app.post("/conversations")
async def create_conversation_endpoint(request: ConversationCreate | None = None) -> dict[str, Any]:
    payload = await create_conversation(_pool(), title=request.title if request else None)
    return {
        "conversation_id": payload["conversation_id"],
        "created_at": payload["created_at"],
        "title": payload.get("title"),
    }


@app.post(
    "/conversations/{conversation_id}/messages",
    responses={
        200: {
            "content": {
                "application/json": {},
                "text/event-stream": {},
            },
            "description": "JSON assistant response, or SSE events when stream=true.",
        }
    },
)
async def post_message_endpoint(conversation_id: UUID, body: MessageCreate, request: Request, stream: bool = False) -> Any:
    if stream:
        return _stream_message_response(conversation_id, body, request)
    try:
        response = await handle_user_message(conversation_id=conversation_id, content=body.content, pool=_pool())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return response.model_dump(mode="json")


def _stream_message_response(conversation_id: UUID, body: MessageCreate, request: Request) -> StreamingResponse:
    queue: asyncio.Queue[Any] = asyncio.Queue()

    async def produce() -> None:
        try:
            async for event in stream_user_message(conversation_id=conversation_id, content=body.content, pool=_pool()):
                await queue.put(event)
        except ValueError as exc:
            await queue.put(_ErrorEvent(str(exc), retryable=False))
        except Exception as exc:
            await queue.put(_ErrorEvent(f"{exc.__class__.__name__}: {exc}", retryable=True))
        finally:
            await queue.put(None)

    asyncio.create_task(produce())

    async def event_stream():
        counter = 0
        while True:
            if await request.is_disconnected():
                return
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if event is None:
                return
            counter += 1
            name = getattr(event, "name", "error")
            envelope = event.envelope() if hasattr(event, "envelope") else {"event": "error", "ts": None, "data": event.data}
            message = f"event: {name}\nid: {counter}\ndata: {json.dumps(envelope, ensure_ascii=False)}\n\n"
            yield message.encode("utf-8")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "Content-Encoding": "identity",
        },
    )


class _ErrorEvent:
    name = "error"

    def __init__(self, message: str, *, retryable: bool) -> None:
        self.data = {"message": message, "retryable": retryable}

    def envelope(self) -> dict[str, Any]:
        return {"event": self.name, "ts": None, "data": self.data}


@app.get("/conversations")
async def list_conversations_endpoint() -> dict[str, Any]:
    return {"conversations": await list_conversations(_pool())}


@app.get("/conversations/{conversation_id}")
async def get_conversation_endpoint(conversation_id: UUID) -> dict[str, Any]:
    payload = await get_conversation(_pool(), conversation_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"conversation {conversation_id} not found")
    return payload


@app.get("/recipe_runs/{run_id}")
async def get_recipe_run_endpoint(run_id: UUID) -> dict[str, Any]:
    payload = await get_recipe_run(_pool(), run_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"recipe_run {run_id} not found")
    return payload


@app.post("/conversations/{conversation_id}/runs/{run_id}/pin")
async def pin_run_endpoint(conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    try:
        return await pin_run(_pool(), conversation_id, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/conversations/{conversation_id}/runs/{run_id}/unpin")
async def unpin_run_endpoint(conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    try:
        return await unpin_run(_pool(), conversation_id, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/conversations/{conversation_id}/runs/{run_id}/forget")
async def forget_run_endpoint(conversation_id: UUID, run_id: UUID) -> dict[str, Any]:
    try:
        return await forget_run(_pool(), conversation_id, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/conversations/{conversation_id}")
async def archive_conversation_endpoint(conversation_id: UUID) -> dict[str, Any]:
    archived = await archive_conversation(_pool(), conversation_id)
    if not archived:
        raise HTTPException(status_code=404, detail=f"active conversation {conversation_id} not found")
    return {"conversation_id": str(conversation_id), "status": "archived"}


@app.get("/catalog")
async def catalog_endpoint() -> dict[str, Any]:
    return {"recipes": catalog_for_prompt()}


@app.get("/catalog/datasets")
async def datasets_endpoint() -> dict[str, Any]:
    return get_catalog().public_payload()


@app.get("/catalog/concepts")
async def concepts_endpoint() -> dict[str, Any]:
    return get_lexicon().public_payload()


@app.get("/healthz")
async def healthz_endpoint() -> dict[str, str]:
    await _pool().fetchval("SELECT 1")
    return {"status": "ok"}
