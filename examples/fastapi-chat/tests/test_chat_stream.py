"""POST /chat: what goes over the wire, in what order, and what reaches the gateway.

The acceptance criteria of the story are here: a devtools question streams the answer and then
exactly one `sponsored` event; a sensitive question streams the answer and NO `sponsored` event
at all; the answer never contains the creative; the finished answer is attested once, as a
sha256 and nothing else.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

import httpx
import pytest
import respx

from app.mock_model import DEVTOOLS_ANSWER, HEALTH_ANSWER

from .conftest import (
    APP_ID,
    ATTEST_URL,
    AUDIT_ID,
    DEVTOOLS_QUESTION,
    EVALUATE_URL,
    HEADLINE,
    HEALTH_QUESTION,
    SERVE_BODY,
    answer_text,
    build_app,
    names,
    parse_sse,
    payloads,
    running,
    suppress_body,
)


def sha256_of(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


async def ask(client: httpx.AsyncClient, message: str, **body: object) -> list[tuple[str, object]]:
    response = await client.post("/chat", json={"message": message, **body})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return parse_sse(response.text)


@respx.mock
async def test_devtools_question_streams_the_answer_then_one_sponsored_event(client) -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION)
    order = names(events)

    assert order[0] == "token"
    assert order.count("sponsored") == 1
    assert order[-1] == "done"
    # tokens first, the ad decision only after the answer is complete.
    assert order.index("sponsored") > max(i for i, name in enumerate(order) if name == "token")
    assert order[order.index("sponsored") + 1] == "done"
    assert attest.call_count == 1


@respx.mock
async def test_the_sponsored_event_carries_the_creative_its_label_and_the_audit_id(
    client,
) -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION)
    sponsored = payloads(events, "sponsored")[0]

    assert sponsored["audit_id"] == AUDIT_ID
    assert sponsored["disclosure_label"] == "Sponsored"
    assert sponsored["creative"] == SERVE_BODY["creative"]


@respx.mock
async def test_the_answer_never_contains_the_creative(client) -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION)

    answer = answer_text(events)
    assert answer == DEVTOOLS_ANSWER
    assert HEADLINE not in answer
    assert "Example DB Cloud" not in answer
    for token in payloads(events, "token"):
        assert HEADLINE not in token["text"]


@respx.mock
async def test_the_finished_answer_is_attested_once_as_a_hash(client) -> None:
    respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION)

    assert attest.call_count == 1
    body = json.loads(attest.calls.last.request.content)
    assert body == {
        "audit_id": AUDIT_ID,
        "model_output_hash": sha256_of(DEVTOOLS_ANSWER),
        "rendered": True,
    }
    # The answer text itself never leaves the process.
    assert DEVTOOLS_ANSWER not in attest.calls.last.request.content.decode()
    assert payloads(events, "done")[0]["audit_id"] == AUDIT_ID


@respx.mock
async def test_a_sensitive_question_yields_no_sponsored_event(client) -> None:
    respx.post(EVALUATE_URL).mock(
        return_value=httpx.Response(200, json=suppress_body("sensitive_category:health"))
    )
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, HEALTH_QUESTION)
    order = names(events)

    assert "sponsored" not in order
    assert order[-1] == "done"
    assert answer_text(events) == HEALTH_ANSWER
    decision = payloads(events, "decision")[0]
    assert decision["decision"] == "suppress"
    assert decision["reason"] == "sensitive_category:health"
    assert decision["audit_id"] == AUDIT_ID
    # Suppressed turns are attested too: the record proves nothing was rendered.
    assert json.loads(attest.calls.last.request.content)["rendered"] is False


@respx.mock
async def test_a_paid_turn_sends_the_tier_and_renders_nothing(client) -> None:
    evaluate = respx.post(EVALUATE_URL).mock(
        return_value=httpx.Response(200, json=suppress_body("paid_user"))
    )
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION, tier="paid")

    request = json.loads(evaluate.calls.last.request.content)
    assert request["user"]["tier"] == "paid"
    assert "sponsored" not in names(events)
    assert payloads(events, "decision")[0]["reason"] == "paid_user"


@respx.mock
async def test_the_evaluate_request_is_the_documented_shape(client) -> None:
    evaluate = respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    await ask(client, DEVTOOLS_QUESTION, conversation_id="conv_demo", turn_id="turn_3")

    request = json.loads(evaluate.calls.last.request.content)
    assert request == {
        "app_id": APP_ID,
        "conversation_id": "conv_demo",
        "turn_id": "turn_3",
        "user": {"tier": "free", "region": "US", "locale": "en-US"},
        "messages": [{"role": "user", "content": DEVTOOLS_QUESTION}],
        "surface": {"type": "chat", "placement": "after_answer", "max_creatives": 1},
    }
    assert evaluate.calls.last.request.headers["authorization"].startswith("Bearer ")


@respx.mock
async def test_a_gateway_that_is_down_still_answers_and_serves_nothing(client) -> None:
    respx.post(EVALUATE_URL).mock(side_effect=httpx.ConnectError("no route to host"))
    attest = respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    events = await ask(client, DEVTOOLS_QUESTION)

    assert answer_text(events) == DEVTOOLS_ANSWER
    assert "sponsored" not in names(events)
    decision = payloads(events, "decision")[0]
    assert decision["decision"] == "suppress"
    assert decision["reason"] == "error"
    assert decision["audit_id"] is None
    # No audit record exists, so there is nothing to attest against.
    assert attest.call_count == 0
    assert names(events)[-1] == "done"


@respx.mock
async def test_evaluate_runs_while_the_model_generates() -> None:
    """The evaluate call is in flight before the answer is finished.

    The faked gateway refuses to answer until the app has emitted a token. If evaluate were
    awaited before generation, this would deadlock rather than fail an assertion, so the whole
    request is bounded by a timeout.
    """
    first_token = asyncio.Event()
    seen: list[str] = []

    async def gated_evaluate(request: httpx.Request) -> httpx.Response:
        seen.append("evaluate")
        await first_token.wait()
        return httpx.Response(200, json=SERVE_BODY)

    respx.post(EVALUATE_URL).mock(side_effect=gated_evaluate)
    respx.post(ATTEST_URL).mock(return_value=httpx.Response(204))

    async def generate(question: str):
        for index, chunk in enumerate(["one ", "two ", "three"]):
            await asyncio.sleep(0)
            seen.append(f"token:{index}")
            first_token.set()
            yield chunk

    async with running(build_app(generate=generate)) as http:
        response = await asyncio.wait_for(
            http.post("/chat", json={"message": DEVTOOLS_QUESTION}), timeout=5
        )

    events = parse_sse(response.text)
    assert answer_text(events) == "one two three"
    assert names(events).count("sponsored") == 1
    # The gateway was called before the last token was produced: the two overlapped.
    assert seen.index("evaluate") < seen.index("token:2")


@pytest.mark.parametrize("body", [{}, {"message": ""}])
async def test_an_empty_question_is_rejected(client, body) -> None:
    response = await client.post("/chat", json=body)
    assert response.status_code == 422
