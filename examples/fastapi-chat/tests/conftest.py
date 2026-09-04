"""Fixtures: a real app whose gateway is faked by respx and whose model is the canned one.

No test opens a socket. The app is driven over httpx's ASGITransport, which respx does not
intercept, so the only requests respx sees are the ones the adgate client makes.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from adgate import AsyncAdgate

from app.api import create_app
from app.config import Settings
from app.mock_model import stream_mock_answer
from app.turn import ChatDeps

APP_ID = "app_01JQ0000000000000000000000"
API_KEY = "ak_test_key"
BASE_URL = "https://gateway.adgate.test"
AUDIT_ID = "aud_01JQ0000000000000000000000"
CREATIVE_ID = "cr_01JQ0000000000000000000000"

EVALUATE_URL = f"{BASE_URL}/v1/evaluate"
ATTEST_URL = f"{BASE_URL}/v1/attest"
EVENTS_URL = f"{BASE_URL}/v1/events"

DEVTOOLS_QUESTION = "which postgres hosting should I use for a side project"
HEALTH_QUESTION = "I have had a headache for three days, what should I do"

HEADLINE = "Managed Postgres with a free tier"

CLASSIFICATION: dict[str, Any] = {
    "commercial_intent": 0.84,
    "categories": ["software.devtools.database"],
    "sensitive": [],
    "confidence": 0.91,
    "method": "rules",
    "prompt_version": "sha256:" + "0123456789abcdef" * 4,
}

SERVE_BODY: dict[str, Any] = {
    "decision": "serve",
    "reason": None,
    "classification": CLASSIFICATION,
    "creative": {
        "id": CREATIVE_ID,
        "advertiser": "Example DB Cloud",
        "headline": HEADLINE,
        "body": "Spin up a database in 30 seconds.",
        "cta": "Try it free",
        "url": f"{BASE_URL}/c/{AUDIT_ID}",
        "source": "direct",
        "disclosure_label": "Sponsored",
    },
    "audit_id": AUDIT_ID,
    "latency_ms": 142,
}


def suppress_body(reason: str) -> dict[str, Any]:
    """A suppress response with the reason the gateway would have sent."""
    return {
        "decision": "suppress",
        "reason": reason,
        "classification": {
            **CLASSIFICATION,
            "categories": ["general"],
            "sensitive": ["health"] if reason == "sensitive_category:health" else [],
        },
        "creative": None,
        "audit_id": AUDIT_ID,
        "latency_ms": 37,
    }


def settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "app_id": APP_ID,
        "api_key": API_KEY,
        "base_url": BASE_URL,
        "chunk_delay_ms": 0,
    }
    return Settings(**{**base, **overrides})


def build_app(generate: Any = None, **overrides: Any) -> Any:
    """An app with the canned model, or with a generator a test supplies instead."""
    resolved = settings(**overrides)

    async def canned(question: str) -> AsyncIterator[str]:
        async for chunk in stream_mock_answer(question, resolved.chunk_delay_ms):
            yield chunk

    deps = ChatDeps(
        settings=resolved,
        client=AsyncAdgate(api_key=resolved.api_key, base_url=resolved.base_url),
        generate=canned if generate is None else generate,
    )
    return create_app(deps)


@asynccontextmanager
async def running(api: Any) -> AsyncIterator[httpx.AsyncClient]:
    """The app, over ASGITransport, with its lifespan entered (which closes the client)."""
    transport = httpx.ASGITransport(app=api)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://example.test") as http,
        api.router.lifespan_context(api),
    ):
        yield http


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """The default app: canned model, no delay, gateway at BASE_URL."""
    async with running(build_app()) as http:
        yield http


Event = tuple[str, Any]


def parse_sse(text: str) -> list[Event]:
    """(event name, parsed data) for every frame in an SSE body, in order."""
    events: list[Event] = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        name = "message"
        data: list[str] = []
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data.append(line[len("data:") :].strip())
        events.append((name, json.loads("\n".join(data)) if data else None))
    return events


def names(events: list[Event]) -> list[str]:
    return [name for name, _ in events]


def payloads(events: list[Event], wanted: str) -> list[Any]:
    return [data for name, data in events if name == wanted]


def answer_text(events: list[Event]) -> str:
    """The answer as the browser assembles it: the token events, concatenated."""
    return "".join(str(data["text"]) for data in payloads(events, "token"))
