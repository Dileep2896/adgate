"""evaluate: the answer when the gateway works, and the suppress it falls closed to when not.

Every test runs against BOTH clients (the `adgate` fixture is parametrised), because the two
are only worth having if they are indistinguishable.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from adgate import CLIENT_FAILURE_PROMPT_VERSION
from adgate.models import Decision, SuppressReason

from .conftest import API_KEY, EVALUATE_URL, REQUEST, SERVE_BODY, SUPPRESS_BODY


@respx.mock
async def test_serve_is_returned_as_sent(adgate) -> None:
    route = respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))

    result = await adgate.evaluate(REQUEST)

    assert result.decision == Decision.serve
    assert result.reason is None
    assert result.audit_id == SERVE_BODY["audit_id"]
    assert result.creative is not None
    assert result.creative.disclosure_label == "Sponsored"
    assert result.latency_ms == SERVE_BODY["latency_ms"]
    assert result.error is None
    assert result.model_dump(mode="json", exclude={"error"}) == SERVE_BODY
    request = route.calls.last.request
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    assert request.headers["content-type"] == "application/json"
    assert json.loads(request.content) == REQUEST


@respx.mock
async def test_suppress_is_returned_as_sent(adgate) -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SUPPRESS_BODY))

    result = await adgate.evaluate(REQUEST)

    assert result.decision == Decision.suppress
    assert result.reason == SuppressReason.no_fill
    assert result.creative is None
    assert result.audit_id == SUPPRESS_BODY["audit_id"]
    assert result.error is None


FAILURES = [
    ("connection error", httpx.Response(200), httpx.ConnectError("no route to host"), "network"),
    ("timeout", httpx.Response(200), httpx.ReadTimeout("deadline"), "timeout"),
    ("malformed json", httpx.Response(200, text="{not json"), None, "invalid_response"),
    ("off-contract", httpx.Response(200, json={"decision": "serve"}), None, "invalid_response"),
    ("empty body", httpx.Response(200, text=""), None, "invalid_response"),
    ("unauthorized", httpx.Response(401, json={"error": {"code": "unauthorized"}}), None, "http"),
    ("rate limited", httpx.Response(429, json={"error": {"code": "rate_limited"}}), None, "http"),
    ("gateway error", httpx.Response(502, text="bad gateway"), None, "http"),
]


@pytest.mark.parametrize(
    ("name", "response", "side_effect", "kind"), FAILURES, ids=[f[0] for f in FAILURES]
)
@respx.mock
async def test_failures_suppress(adgate, name, response, side_effect, kind) -> None:
    """No failure ever reaches the caller: it becomes a suppress decision with reason error."""
    if side_effect is not None:
        respx.post(EVALUATE_URL).mock(side_effect=side_effect)
    else:
        respx.post(EVALUATE_URL).mock(return_value=response)

    result = await adgate.evaluate(REQUEST)

    assert result.decision == Decision.suppress
    assert result.reason == SuppressReason.error
    assert result.creative is None
    assert result.audit_id is None, "there is no audit record to attest or track against"
    assert result.error is not None
    assert result.error.kind == kind
    assert result.error.status == (response.status_code if side_effect is None else None)
    assert result.classification.prompt_version == CLIENT_FAILURE_PROMPT_VERSION
    assert result.classification.commercial_intent == 0
    assert result.latency_ms >= 0


@respx.mock
async def test_a_model_request_is_serialised_without_nulls(adgate) -> None:
    from adgate import EvaluateRequest

    route = respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))

    await adgate.evaluate(EvaluateRequest.model_validate(REQUEST))

    assert json.loads(route.calls.last.request.content) == REQUEST


@respx.mock
async def test_a_logger_sees_one_warning_per_failure() -> None:
    from adgate import Adgate

    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(429))
    lines: list[tuple[str, tuple[object, ...]]] = []

    class Recorder:
        def warning(self, msg: str, *args: object, **kwargs: object) -> None:
            lines.append((msg, args))

    with Adgate(API_KEY, "https://gateway.adgate.test/", logger=Recorder()) as client:
        client.evaluate(REQUEST)

    assert len(lines) == 1
    message, data = lines[0]
    assert data[0] == "adgate evaluate failed"
    assert data[1] == {"kind": "http", "status": 429}
    assert "which postgres" not in (message % data)


@respx.mock
async def test_a_throwing_logger_cannot_break_a_call() -> None:
    from adgate import Adgate

    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(500))

    class Exploding:
        def warning(self, msg: str, *args: object, **kwargs: object) -> None:
            raise RuntimeError("logger is the caller's bug, not adgate's")

    with Adgate(API_KEY, "https://gateway.adgate.test", logger=Exploding()) as client:
        assert client.evaluate(REQUEST).reason == SuppressReason.error
