"""LLM summarizer: deterministic result rows to cited prose."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, set_default_openai_key
from openai.types.shared import Reasoning
from pydantic import Field

from .primitives.base import StrictModel
from .primitives.base import EmitCallback
from .recipes.base import RecipeResult
from .runtime_config import settings


class Citation(StrictModel):
    finding_index: int | None = None
    sql_query_name: str | None = None
    url: str | None = None
    source_run_id: str | None = None


class Paragraph(StrictModel):
    text: str
    citations: list[Citation] = Field(default_factory=list)


class Summary(StrictModel):
    headline: str
    paragraphs: list[Paragraph] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


def _agent() -> Agent[Any]:
    set_default_openai_key(settings.openai_key_value())
    return Agent(
        name="Ship Summarizer",
        model="gpt-5.5",
        output_type=AgentOutputSchema(Summary, strict_json_schema=False),
        model_settings=ModelSettings(
            reasoning=Reasoning(effort="medium"),
            verbosity="medium",
            max_tokens=4096,
            include_usage=True,
            prompt_cache_retention="24h",
        ),
        instructions=(
            "Write a grounded 2-4 paragraph analytical summary for an investigative journalist or auditor. "
            "Every paragraph must include citations to finding_index and/or sql_query_name. "
            "When a cited finding row has source_url, include that exact source_url in citation.url. "
            "When summarizing across prior runs, set citation.source_run_id to the run that produced the cited finding. "
            "You may be summarizing across MULTIPLE recipe runs. Use the most recent run's findings as the primary subject unless the user explicitly asked about earlier runs. "
            "When summarizing a refinement, explicitly name what changed from the baseline. When summarizing a comparison, lead with the magnitude of the difference, not just row counts. "
            "When the mode is conversational, cite at least one finding for every numeric or named claim and introduce no new numbers that are absent from prior runs. "
            "When findings include both 'external_recipient' and 'public_system_oversight' buckets, present them in two clearly labeled sections; public delivery authorities belong in the public_system_oversight section and should not be conflated with external recipients whose record would concern a funder. "
            "Every numeric claim must cite a finding row that contains the same value, or a SQL query that returned that value. "
            "Name entities exactly as they appear in canonical_name fields. If a row has only source_legal_name or supplier_name, describe it as a source-record name and avoid treating it as a canonical entity. "
            "Do not convert ratios, shares, or HHI values to percent, basis points, or 0-10000 scales unless that exact converted number appears in the finding rows. "
            "Do not write derived count phrases such as 'the other two' unless that exact count appears in the findings or SQL log; use non-numeric wording such as 'the remaining returned records' instead. "
            "Do not invent numbers, entities, URLs, causal explanations, or legal conclusions. Surface honest caveats."
        ),
    )


def _compact_value(value: Any, *, depth: int = 0) -> Any:
    if depth >= 3:
        return "<nested>"
    if isinstance(value, dict):
        return {str(key): _compact_value(item, depth=depth + 1) for key, item in list(value.items())[:12]}
    if isinstance(value, list):
        return [_compact_value(item, depth=depth + 1) for item in value[:5]]
    if isinstance(value, str):
        return value if len(value) <= 700 else value[:697].rstrip() + "..."
    return value


def _payload(result: RecipeResult) -> dict[str, Any]:
    findings = [{**_compact_value(row), "_finding_index": index} for index, row in enumerate(result.findings[:15])]
    sql_log = [
        {
            "query_name": entry.query_name,
            "row_count": entry.row_count,
            "sample_rows": [_compact_value(row) for row in entry.rows[:3]],
        }
        for entry in result.sql_log
    ]
    return {
        "recipe_id": result.recipe_id,
        "question": result.question,
        "params": result.params,
        "findings": findings,
        "sql_log": sql_log,
        "caveats": result.caveats,
    }


async def summarize(result: RecipeResult) -> Summary:
    return await summarize_streaming(result, emit=None)


async def summarize_streaming(result: RecipeResult, *, emit: EmitCallback | None = None) -> Summary:
    payload = json.dumps(_payload(result), ensure_ascii=False)
    if emit:
        await emit("summarizer_started", {"prompt_token_estimate": max(1, len(payload) // 4)})
    stream = Runner.run_streamed(_agent(), payload, max_turns=1)
    text_streamer = _StructuredSummaryTextStreamer()
    async for event in stream.stream_events():
        delta = _event_delta(event)
        if delta and emit:
            for chunk in text_streamer.feed(delta):
                await emit("summarizer_token", {"text": chunk})
                await asyncio.sleep(0)
    summary = stream.final_output
    if emit:
        for chunk in text_streamer.flush():
            await emit("summarizer_token", {"text": chunk})
            await asyncio.sleep(0)
    if emit and not text_streamer.emitted_any:
        for token in _summary_chunks(summary):
            await emit("summarizer_token", {"text": token})
            await asyncio.sleep(0)
    if emit:
        prompt_tokens, completion_tokens = _usage_counts(stream)
        await emit("summarizer_completed", {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens})
    return summary


async def emit_cached_summary_tokens(summary: Summary, *, emit: EmitCallback | None = None) -> None:
    if not emit:
        return
    text = " ".join([summary.headline, *(paragraph.text for paragraph in summary.paragraphs)])
    await emit("summarizer_started", {"prompt_token_estimate": max(1, len(text) // 4)})
    for token in _chunk_text(text, max_chars=5):
        await emit("summarizer_token", {"text": token})
        await asyncio.sleep(0)
    await emit("summarizer_completed", {"prompt_tokens": 0, "completion_tokens": 0})


def _event_delta(event: Any) -> str | None:
    if getattr(event, "type", "") != "raw_response_event":
        return None
    data = getattr(event, "data", None)
    delta = getattr(data, "delta", None)
    if delta:
        return str(delta)
    raw_type = str(getattr(data, "type", "") or "")
    if raw_type.endswith(".delta"):
        text = getattr(data, "text", None) or getattr(data, "content", None)
        return str(text) if text else None
    return None


def _summary_chunks(summary: Summary) -> list[str]:
    text = " ".join([summary.headline, *(paragraph.text for paragraph in summary.paragraphs)])
    return _chunk_text(text, max_chars=5)


def _chunk_text(text: str, *, max_chars: int = 5) -> list[str]:
    if max_chars < 1:
        raise ValueError("max_chars must be at least 1")
    chunks = [text[index : index + max_chars] for index in range(0, len(text), max_chars)]
    return chunks or [""]


class _StructuredSummaryTextStreamer:
    """Extract human-readable prose from streamed structured-output JSON."""

    _TARGET_KEYS = {"headline", "text"}
    _ESCAPES = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    def __init__(self, *, max_chars: int = 5) -> None:
        self.max_chars = max_chars
        self.started = False
        self.raw_mode = False
        self.in_string = False
        self.escape = False
        self.unicode_escape: str | None = None
        self.streaming_target = False
        self.current_key: str | None = None
        self.last_string: str | None = None
        self.string_buffer: list[str] = []
        self.output_buffer = ""
        self.expecting_value = False
        self.emitted_any = False

    def feed(self, text: str) -> list[str]:
        chunks: list[str] = []
        index = 0
        if not self.started:
            while index < len(text) and text[index].isspace():
                index += 1
            if index >= len(text):
                return chunks
            self.started = True
            if text[index] not in "{[":
                self.raw_mode = True

        if self.raw_mode:
            return self._append_output(text[index:])

        for char in text[index:]:
            chunks.extend(self._consume_json_char(char))
        return chunks

    def flush(self) -> list[str]:
        if not self.output_buffer:
            return []
        chunk = self.output_buffer
        self.output_buffer = ""
        return [chunk]

    def _consume_json_char(self, char: str) -> list[str]:
        chunks: list[str] = []
        if self.in_string:
            if self.unicode_escape is not None:
                self.unicode_escape += char
                if len(self.unicode_escape) == 4:
                    try:
                        decoded = chr(int(self.unicode_escape, 16))
                    except ValueError:
                        decoded = f"\\u{self.unicode_escape}"
                    chunks.extend(self._string_char(decoded))
                    self.unicode_escape = None
                    self.escape = False
                return chunks
            if self.escape:
                if char == "u":
                    self.unicode_escape = ""
                    return chunks
                chunks.extend(self._string_char(self._ESCAPES.get(char, char)))
                self.escape = False
                return chunks
            if char == "\\":
                self.escape = True
                return chunks
            if char == '"':
                if self.streaming_target:
                    chunks.extend(self.flush())
                else:
                    self.last_string = "".join(self.string_buffer)
                self.in_string = False
                self.streaming_target = False
                self.string_buffer = []
                return chunks
            chunks.extend(self._string_char(char))
            return chunks

        if char == '"':
            self.in_string = True
            self.escape = False
            self.unicode_escape = None
            self.string_buffer = []
            self.streaming_target = self.expecting_value and self.current_key in self._TARGET_KEYS
            if self.streaming_target:
                if self.emitted_any:
                    chunks.extend(self._append_output("\n\n"))
                self.emitted_any = True
            return chunks
        if char == ":":
            self.current_key = self.last_string
            self.last_string = None
            self.expecting_value = True
            return chunks
        if char in ",}]":
            self.expecting_value = False
            self.current_key = None
            return chunks
        return chunks

    def _string_char(self, char: str) -> list[str]:
        if self.streaming_target:
            return self._append_output(char)
        self.string_buffer.append(char)
        return []

    def _append_output(self, text: str) -> list[str]:
        chunks: list[str] = []
        self.output_buffer += text
        while len(self.output_buffer) >= self.max_chars:
            chunks.append(self.output_buffer[: self.max_chars])
            self.output_buffer = self.output_buffer[self.max_chars :]
        return chunks


def _usage_counts(stream: Any) -> tuple[int, int]:
    usage = getattr(stream, "usage", None)
    if usage is None:
        usage = getattr(getattr(stream, "last_response", None), "usage", None)
    prompt = int(getattr(usage, "input_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0)
    completion = int(getattr(usage, "output_tokens", 0) or getattr(usage, "completion_tokens", 0) or 0)
    return prompt, completion
