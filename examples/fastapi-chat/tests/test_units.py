"""The pieces around the stream: the canned model, the provider switch, and the payloads."""

from __future__ import annotations

import pytest
from adgate import EvaluateResult

from app.config import (
    DEFAULT_CHUNK_DELAY_MS,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
    ConfigError,
    settings_from_env,
)
from app.mock_model import (
    DEVTOOLS_ANSWER,
    GENERIC_ANSWER,
    HEALTH_ANSWER,
    answer_for,
    chunks_of,
    stream_mock_answer,
)
from app.model import answer_stream, delta_of, model_name
from app.turn import (
    FALLBACK_DISCLOSURE_LABEL,
    Turn,
    decision_payload,
    evaluate_request,
    is_serve,
    sponsored_payload,
)

from .conftest import APP_ID, SERVE_BODY, settings, suppress_body

ENV = {"ADGATE_APP_ID": APP_ID, "ADGATE_API_KEY": "ak_x", "ADGATE_BASE_URL": "http://gw.test"}


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("which postgres hosting should I use for a side project", DEVTOOLS_ANSWER),
        ("where should I deploy this", DEVTOOLS_ANSWER),
        ("I have had a headache for three days", HEALTH_ANSWER),
        # Health wins over devtools: the demo never sells into a sensitive turn.
        ("can a database give me a headache", HEALTH_ANSWER),
        ("should I rewrite this in rust", GENERIC_ANSWER),
    ],
)
def test_the_canned_answer_is_picked_by_keyword(question, expected) -> None:
    assert answer_for(question) == expected


def test_the_chunks_rebuild_the_answer_exactly() -> None:
    assert "".join(chunks_of(DEVTOOLS_ANSWER)) == DEVTOOLS_ANSWER


async def test_the_mock_stream_yields_the_whole_answer() -> None:
    chunks = [chunk async for chunk in stream_mock_answer("postgres hosting", 0)]
    assert "".join(chunks) == DEVTOOLS_ANSWER
    assert len(chunks) > 1


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ('data: {"choices":[{"delta":{"content":"Hi"}}]}', "Hi"),
        ('data:{"choices":[{"delta":{"content":" there"}}]}', " there"),
        ("data: [DONE]", ""),
        ("data: ", ""),
        (": keep-alive", ""),
        ("", ""),
        ("data: {not json", ""),
        ('data: {"choices":[]}', ""),
        ('data: {"choices":[{"delta":{}}]}', ""),
        ('data: {"choices":[{"delta":{"content":null}}]}', ""),
    ],
)
def test_an_openai_stream_line_becomes_text_or_nothing(line, expected) -> None:
    assert delta_of(line) == expected


def test_the_offline_model_is_the_default_and_openai_the_opt_in() -> None:
    offline = settings_from_env(ENV)
    assert offline.openai is None
    assert offline.offline is True
    assert model_name(offline) == "offline-canned"
    assert answer_stream(offline).func is stream_mock_answer

    live = settings_from_env({**ENV, "OPENAI_API_KEY": "sk-test"})
    assert live.openai is not None
    assert live.openai.base_url == DEFAULT_OPENAI_BASE_URL
    assert live.openai.model == DEFAULT_OPENAI_MODEL
    assert live.offline is False
    assert model_name(live) == DEFAULT_OPENAI_MODEL

    custom = settings_from_env(
        {**ENV, "OPENAI_API_KEY": "sk-test", "OPENAI_BASE_URL": "http://ollama:11434/v1",
         "OPENAI_MODEL": "llama3.1"}
    )
    assert custom.openai is not None
    assert custom.openai.base_url == "http://ollama:11434/v1"
    assert custom.openai.model == "llama3.1"


def test_the_defaults_and_the_errors_of_the_environment() -> None:
    assert settings_from_env(ENV).chunk_delay_ms == DEFAULT_CHUNK_DELAY_MS
    assert settings_from_env({**ENV, "MOCK_CHUNK_DELAY_MS": "0"}).chunk_delay_ms == 0
    assert settings_from_env({"ADGATE_APP_ID": APP_ID, "ADGATE_API_KEY": "ak_x"}).base_url == (
        "http://localhost:8787"
    )

    with pytest.raises(ConfigError, match="ADGATE_APP_ID"):
        settings_from_env({"ADGATE_API_KEY": "ak_x"})
    with pytest.raises(ConfigError, match="ADGATE_API_KEY"):
        settings_from_env({"ADGATE_APP_ID": APP_ID, "ADGATE_API_KEY": "   "})
    with pytest.raises(ConfigError, match="whole number"):
        settings_from_env({**ENV, "MOCK_CHUNK_DELAY_MS": "fast"})
    with pytest.raises(ConfigError, match="negative"):
        settings_from_env({**ENV, "MOCK_CHUNK_DELAY_MS": "-1"})


def test_the_evaluate_request_carries_only_the_question() -> None:
    turn = Turn(message="hello", conversation_id="conv_1", turn_id="turn_1", tier="free")
    request = evaluate_request(settings().app_id, turn)

    assert request["messages"] == [{"role": "user", "content": "hello"}]
    assert request["surface"]["placement"] == "after_answer"
    assert "context_summary" not in request


def test_the_payloads_of_a_serve_and_a_suppress() -> None:
    serve = EvaluateResult.model_validate(SERVE_BODY)
    assert is_serve(serve) is True
    assert decision_payload(serve) == {
        "decision": "serve",
        "reason": None,
        "audit_id": SERVE_BODY["audit_id"],
        "latency_ms": SERVE_BODY["latency_ms"],
    }
    assert sponsored_payload(serve)["creative"] == SERVE_BODY["creative"]

    suppressed = EvaluateResult.model_validate(suppress_body("paid_user"))
    assert is_serve(suppressed) is False
    assert decision_payload(suppressed)["reason"] == "paid_user"


def test_a_blank_disclosure_label_falls_back_to_a_constant() -> None:
    """A creative must never render without a label, whatever a future policy sends."""
    body = {**SERVE_BODY, "creative": {**SERVE_BODY["creative"], "disclosure_label": "   "}}
    payload = sponsored_payload(EvaluateResult.model_validate(body))
    assert payload["disclosure_label"] == FALLBACK_DISCLOSURE_LABEL
