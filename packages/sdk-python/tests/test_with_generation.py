"""with_generation: evaluate and generate together, then exactly one attest.

The helper is the whole turn in one call. The only error it ever lets through is the
caller's own generate(), and then nothing is attested: there is no answer to attest.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import respx

from adgate import Adgate, AsyncAdgate
from adgate.models import Decision, SuppressReason

from .conftest import (
    ANSWER,
    API_KEY,
    ATTEST_URL,
    AUDIT_ID,
    BASE_URL,
    EVALUATE_URL,
    REQUEST,
    SERVE_BODY,
    SUPPRESS_BODY,
)


class GenerationError(RuntimeError):
    """The caller's own generation failure."""


@respx.mock
async def test_async_attests_the_answer_once() -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate() -> str:
        await asyncio.sleep(0)
        return ANSWER

    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        turn = await adgate.with_generation(REQUEST, generate)

    assert turn.answer == ANSWER
    assert turn.decision.decision == Decision.serve
    assert turn.attest is not None and turn.attest.ok
    assert attest.call_count == 1
    body = json.loads(attest.calls.last.request.content)
    assert body["audit_id"] == AUDIT_ID
    assert body["rendered"] is True
    assert ANSWER not in attest.calls.last.request.content.decode()


@respx.mock
def test_sync_attests_the_answer_once() -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    with Adgate(API_KEY, BASE_URL) as adgate:
        turn = adgate.with_generation(REQUEST, lambda: ANSWER)

    assert turn.answer == ANSWER
    assert attest.call_count == 1
    assert json.loads(attest.calls.last.request.content)["rendered"] is True


@respx.mock
async def test_async_propagates_a_generation_failure_without_attesting() -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate() -> str:
        raise GenerationError("model refused")

    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        with pytest.raises(GenerationError, match="model refused"):
            await adgate.with_generation(REQUEST, generate)

    assert attest.call_count == 0


@respx.mock
def test_sync_propagates_a_generation_failure_without_attesting() -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    def generate() -> str:
        raise GenerationError("model refused")

    with Adgate(API_KEY, BASE_URL) as adgate, pytest.raises(GenerationError, match="model refused"):
        adgate.with_generation(REQUEST, generate)

    assert attest.call_count == 0


@respx.mock
async def test_a_failed_evaluate_still_returns_the_answer_and_attests_nothing() -> None:
    respx.post(EVALUATE_URL).mock(side_effect=httpx.ConnectError("down"))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate() -> str:
        return ANSWER

    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        turn = await adgate.with_generation(REQUEST, generate)

    assert turn.answer == ANSWER
    assert turn.decision.reason == SuppressReason.error
    assert turn.attest is None, "no audit record was created, so there is nothing to attest"
    assert attest.call_count == 0


@respx.mock
async def test_rendered_defaults_to_the_decision_and_accepts_an_override() -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SUPPRESS_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate() -> str:
        return ANSWER

    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        suppressed = await adgate.with_generation(REQUEST, generate)
        forced = await adgate.with_generation(REQUEST, generate, rendered=True)
        by_predicate = await adgate.with_generation(
            REQUEST, generate, rendered=lambda decision: decision.audit_id == AUDIT_ID
        )

    assert suppressed.attest is not None and forced.attest is not None
    assert by_predicate.attest is not None
    rendered_flags = [json.loads(call.request.content)["rendered"] for call in attest.calls]
    assert rendered_flags == [False, True, True]


@respx.mock
async def test_evaluate_and_generate_run_concurrently() -> None:
    """The evaluate call is in flight before generate finishes: adgate adds no latency."""
    started = asyncio.Event()

    async def evaluate_slowly(request: httpx.Request) -> httpx.Response:
        started.set()
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=SERVE_BODY)

    respx.post(EVALUATE_URL).mock(side_effect=evaluate_slowly)
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate() -> str:
        await asyncio.wait_for(started.wait(), timeout=1)
        return ANSWER

    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        turn = await adgate.with_generation(REQUEST, generate)

    assert turn.answer == ANSWER
    assert turn.decision.decision == Decision.serve
