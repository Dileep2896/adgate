"""Which model generates the answer: the offline canned one, or a real OpenAI-compatible one.

The adgate wiring in app/turn.py is identical either way - it only ever consumes an
``AsyncIterator[str]`` of tokens - which is the point of having both.

The OpenAI-compatible client is 40 lines of httpx (already a dependency) rather than the
``openai`` package: the example needs one streaming POST, and adding an SDK to show one POST
would be noise.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from functools import partial
from typing import Any

import httpx

from .config import OpenAIConfig, Settings
from .mock_model import stream_mock_answer

SYSTEM_PROMPT = "You are a concise engineering assistant. Answer in at most four sentences."

#: Generous: this is the user-visible answer, not the ad decision (which has its own 800 ms).
OPENAI_TIMEOUT_SECONDS = 60.0

#: A function that turns a question into a stream of answer tokens.
AnswerStream = Callable[[str], AsyncIterator[str]]


def delta_of(line: str) -> str:
    """The text of one `data:` line of an OpenAI chat completions stream, or ''.

    Anything unexpected - a comment, a keep-alive, `[DONE]`, a chunk with no text - is ''. A
    provider that streams something this example does not understand loses tokens, never the
    turn.
    """
    if not line.startswith("data:"):
        return ""
    data = line[len("data:") :].strip()
    if not data or data == "[DONE]":
        return ""
    try:
        body: Any = json.loads(data)
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    delta = first.get("delta") if isinstance(first, dict) else None
    content = delta.get("content") if isinstance(delta, dict) else None
    return content if isinstance(content, str) else ""


async def stream_openai_answer(question: str, config: OpenAIConfig) -> AsyncIterator[str]:
    """Stream an answer from any endpoint that speaks OpenAI chat completions."""
    url = config.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": config.model,
        "stream": True,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
    }
    headers = {"Authorization": f"Bearer {config.api_key}"}
    async with (
        httpx.AsyncClient(timeout=OPENAI_TIMEOUT_SECONDS) as client,
        client.stream("POST", url, json=payload, headers=headers) as response,
    ):
        response.raise_for_status()
        async for line in response.aiter_lines():
            delta = delta_of(line)
            if delta:
                yield delta


def answer_stream(settings: Settings) -> AnswerStream:
    """The generator app/turn.py will consume. Offline unless OPENAI_API_KEY is set."""
    if settings.openai is None:
        return partial(stream_mock_answer, chunk_delay_ms=settings.chunk_delay_ms)
    return partial(stream_openai_answer, config=settings.openai)


def model_name(settings: Settings) -> str:
    """What the /healthz payload and the page footer say is generating the answers."""
    return "offline-canned" if settings.openai is None else settings.openai.model


__all__ = [
    "OPENAI_TIMEOUT_SECONDS",
    "SYSTEM_PROMPT",
    "AnswerStream",
    "answer_stream",
    "delta_of",
    "model_name",
    "stream_openai_answer",
]
