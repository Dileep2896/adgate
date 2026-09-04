"""Shared fixtures. No test in this suite touches the network: respx answers every request."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

import pytest

from adgate import Adgate, AsyncAdgate
from adgate.client import Rendered
from adgate.models import EventType
from adgate.results import EvaluateResult, PostResult

API_KEY = "ak_test_key"
BASE_URL = "https://gateway.adgate.test"
AUDIT_ID = "aud_01JQ0000000000000000000000"
CREATIVE_ID = "cr_01JQ0000000000000000000000"
ANSWER = "Managed Postgres is the shortest path for a side project."

EVALUATE_URL = f"{BASE_URL}/v1/evaluate"
ATTEST_URL = f"{BASE_URL}/v1/attest"
EVENTS_URL = f"{BASE_URL}/v1/events"

REQUEST: dict[str, Any] = {
    "app_id": "app_01JQ0000000000000000000000",
    "conversation_id": "conv_abc",
    "turn_id": "turn_7",
    "user": {"tier": "free", "region": "US"},
    "messages": [{"role": "user", "content": "which postgres hosting for a side project"}],
    "surface": {"type": "chat", "placement": "after_answer"},
}

CLASSIFICATION: dict[str, Any] = {
    "commercial_intent": 0.84,
    "categories": ["software.devtools.database"],
    "sensitive": [],
    "confidence": 0.91,
    "method": "llm",
    "prompt_version": "sha256:" + "0123456789abcdef" * 4,
}

SERVE_BODY: dict[str, Any] = {
    "decision": "serve",
    "reason": None,
    "classification": CLASSIFICATION,
    "creative": {
        "id": CREATIVE_ID,
        "advertiser": "Example DB Cloud",
        "headline": "Managed Postgres with a free tier",
        "body": "Spin up a database in 30 seconds.",
        "cta": "Try it free",
        "url": f"{BASE_URL}/c/{AUDIT_ID}",
        "source": "direct",
        "disclosure_label": "Sponsored",
    },
    "audit_id": AUDIT_ID,
    "latency_ms": 142,
}

SUPPRESS_BODY: dict[str, Any] = {
    "decision": "suppress",
    "reason": "no_fill",
    "classification": CLASSIFICATION,
    "creative": None,
    "audit_id": AUDIT_ID,
    "latency_ms": 37,
}


class SyncFacade:
    """Adgate behind AsyncAdgate's signatures, so one test can pin both clients at once."""

    def __init__(self, client: Adgate) -> None:
        self.client = client

    async def evaluate(self, request: Any) -> EvaluateResult:
        return self.client.evaluate(request)

    async def attest(
        self, audit_id: str, model_output_text: str, rendered: bool = True
    ) -> PostResult:
        return self.client.attest(audit_id, model_output_text, rendered)

    async def track(
        self,
        audit_id: str,
        event_type: EventType | str,
        ts: str | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> PostResult:
        return self.client.track(audit_id, event_type, ts, meta)

    async def with_generation(
        self, request: Any, generate: Any, rendered: Rendered = None
    ) -> Any:
        return self.client.with_generation(request, generate, rendered)


@pytest.fixture(params=["sync", "async"])
async def adgate(request: pytest.FixtureRequest) -> AsyncIterator[SyncFacade | AsyncAdgate]:
    """Both clients, one test body: their behaviour is meant to be indistinguishable."""
    if request.param == "sync":
        with Adgate(API_KEY, BASE_URL) as client:
            yield SyncFacade(client)
    else:
        async with AsyncAdgate(API_KEY, BASE_URL) as client:
            yield client
