"""attest sends the hash and nothing else; track sends the documented event body."""

from __future__ import annotations

import hashlib
import json
import re

import httpx
import pytest
import respx

from adgate import hash_model_output
from adgate.models import EventType

from .conftest import ANSWER, ATTEST_URL, AUDIT_ID, EVENTS_URL


@respx.mock
async def test_attest_sends_only_the_hash(adgate) -> None:
    route = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    result = await adgate.attest(AUDIT_ID, ANSWER)

    assert result.ok is True
    assert result.status == 204
    body = route.calls.last.request.content.decode()
    assert json.loads(body) == {
        "audit_id": AUDIT_ID,
        "model_output_hash": "sha256:" + hashlib.sha256(ANSWER.encode()).hexdigest(),
        "rendered": True,
    }
    assert ANSWER not in body, "the model's answer must never leave the process"
    assert "Managed Postgres" not in body


@respx.mock
async def test_attest_passes_rendered_through(adgate) -> None:
    route = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    await adgate.attest(AUDIT_ID, ANSWER, False)

    assert json.loads(route.calls.last.request.content)["rendered"] is False


ATTEST_FAILURES = [
    ("not found", httpx.Response(404), None, 404, "http"),
    ("already attested", httpx.Response(409), None, 409, "http"),
    ("unauthorized", httpx.Response(401), None, 401, "http"),
    ("connection error", None, httpx.ConnectError("down"), None, "network"),
    ("timeout", None, httpx.ReadTimeout("deadline"), None, "timeout"),
]


@pytest.mark.parametrize(
    ("name", "response", "side_effect", "status", "error"),
    ATTEST_FAILURES,
    ids=[f[0] for f in ATTEST_FAILURES],
)
@respx.mock
async def test_attest_reports_failures_instead_of_raising(
    adgate, name, response, side_effect, status, error
) -> None:
    route = respx.post(ATTEST_URL)
    if side_effect is not None:
        route.mock(side_effect=side_effect)
    else:
        route.mock(return_value=response)

    result = await adgate.attest(AUDIT_ID, ANSWER)

    assert result.ok is False
    assert result.status == status
    assert result.error == error


@respx.mock
async def test_track_posts_the_documented_body(adgate) -> None:
    route = respx.post(EVENTS_URL).mock(return_value=httpx.Response(204))

    result = await adgate.track(AUDIT_ID, "impression")

    assert result.ok is True
    body = json.loads(route.calls.last.request.content)
    assert body["audit_id"] == AUDIT_ID
    assert body["type"] == "impression"
    assert "meta" not in body, "meta is sent only when the caller gives one"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", body["ts"])


@respx.mock
async def test_track_takes_an_enum_a_timestamp_and_meta(adgate) -> None:
    route = respx.post(EVENTS_URL).mock(return_value=httpx.Response(204))

    await adgate.track(AUDIT_ID, EventType.click, "2026-09-02T18:04:11Z", {"position": 1})

    assert json.loads(route.calls.last.request.content) == {
        "audit_id": AUDIT_ID,
        "type": "click",
        "ts": "2026-09-02T18:04:11Z",
        "meta": {"position": 1},
    }


@respx.mock
async def test_track_reports_a_rejected_event(adgate) -> None:
    respx.post(EVENTS_URL).mock(return_value=httpx.Response(404))

    result = await adgate.track(AUDIT_ID, "click")

    assert result.ok is False
    assert result.status == 404
    assert result.error == "http"


def test_hash_matches_the_typescript_sdk_and_core() -> None:
    """Same digest as @adgate/core's sha256Prefixed over the same UTF-8 bytes."""
    from adgate import CLIENT_FAILURE_PROMPT_SEED, CLIENT_FAILURE_PROMPT_VERSION

    assert hash_model_output("") == "sha256:" + hashlib.sha256(b"").hexdigest()
    assert hash_model_output("héllo") == "sha256:" + hashlib.sha256("héllo".encode()).hexdigest()
    assert hash_model_output(CLIENT_FAILURE_PROMPT_SEED) == CLIENT_FAILURE_PROMPT_VERSION
