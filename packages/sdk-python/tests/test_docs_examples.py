"""Every JSON example in docs/api.md, through the generated models and back out unchanged.

The bodies below are copies of the ```json blocks of docs/api.md, in document order, with the
elided values (`sha256:...`) filled in the way packages/schemas' own doc-examples fixture fills
them: 64 lowercase hex digits. The copies are checked against the doc itself in
test_examples_still_match_the_doc, which skips when the doc is not on disk (an installed
sdist), so the round trip below can run anywhere while the copies cannot drift in the repo.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from adgate.models import (
    AttestRequest,
    ErrorResponse,
    EvaluateRequest,
    EvaluateResponse,
    EventRequest,
    HealthResponse,
    VerifyResponse,
)

EXAMPLE_SHA256 = "sha256:" + "0123456789abcdef" * 4

# ## POST /v1/evaluate, request
EVALUATE_REQUEST: dict[str, Any] = {
    "app_id": "app_01J...",
    "conversation_id": "conv_abc",
    "turn_id": "turn_7",
    "user": {
        "tier": "free",
        "region": "US",
        "locale": "en-US",
        "user_hash": "optional sha256",
    },
    "messages": [
        {
            "role": "user",
            "content": "which postgres hosting should I use for a side project",
        }
    ],
    "context_summary": "optional alternative to raw messages",
    "surface": {"type": "chat", "placement": "after_answer", "max_creatives": 1},
    "policy_overrides": {},
}

# ## POST /v1/evaluate, response
EVALUATE_RESPONSE: dict[str, Any] = {
    "decision": "serve",
    "reason": None,
    "classification": {
        "commercial_intent": 0.84,
        "categories": ["software.devtools.database"],
        "sensitive": [],
        "confidence": 0.91,
        "method": "llm",
        "prompt_version": EXAMPLE_SHA256,
    },
    "creative": {
        "id": "cr_01J...",
        "advertiser": "Example DB Cloud",
        "headline": "Managed Postgres with a free tier",
        "body": "Spin up a database in 30 seconds.",
        "cta": "Try it free",
        "url": "https://<gateway>/c/aud_01J...",
        "source": "direct",
        "disclosure_label": "Sponsored",
    },
    "audit_id": "aud_01J...",
    "latency_ms": 142,
}

# ## POST /v1/attest
ATTEST_REQUEST: dict[str, Any] = {
    "audit_id": "aud_01J...",
    "model_output_hash": EXAMPLE_SHA256,
    "rendered": True,
}

# ## POST /v1/events
EVENT_REQUEST: dict[str, Any] = {
    "audit_id": "aud_01J...",
    "type": "impression",
    "ts": "2026-09-02T18:04:11Z",
    "meta": {},
}

# ## GET /v1/verify/:id
VERIFY_RESPONSE: dict[str, Any] = {
    "valid": True,
    "checks": [
        {"name": "schema", "ok": True},
        {"name": "record_hash", "ok": True},
        {"name": "chain", "ok": True},
        {"name": "signature", "ok": True, "detail": "key_id=k_2026_09"},
        {"name": "creative_hash", "ok": True},
        {"name": "disclosure_present", "ok": True},
        {"name": "separation_attested", "ok": True},
    ],
}

# ## GET /healthz and ## Error behavior, both inline in the prose
HEALTH_RESPONSE: dict[str, Any] = {"ok": True}
ERROR_RESPONSE: dict[str, Any] = {"error": {"code": "...", "message": "..."}}

EXAMPLES: list[tuple[str, type[BaseModel], dict[str, Any]]] = [
    ("POST /v1/evaluate request", EvaluateRequest, EVALUATE_REQUEST),
    ("POST /v1/evaluate response", EvaluateResponse, EVALUATE_RESPONSE),
    ("POST /v1/attest", AttestRequest, ATTEST_REQUEST),
    ("POST /v1/events", EventRequest, EVENT_REQUEST),
    ("GET /v1/verify/:id", VerifyResponse, VERIFY_RESPONSE),
    ("GET /healthz", HealthResponse, HEALTH_RESPONSE),
    ("Error behavior", ErrorResponse, ERROR_RESPONSE),
]

DOC = Path(__file__).resolve().parents[3] / "docs" / "api.md"


@pytest.mark.parametrize(("name", "model", "example"), EXAMPLES, ids=[e[0] for e in EXAMPLES])
def test_example_round_trips(name: str, model: type[BaseModel], example: dict[str, Any]) -> None:
    """Validate the documented body, dump it back, get the same JSON."""
    parsed = model.model_validate(example)
    assert parsed.model_dump(mode="json", exclude_unset=True) == example


def test_suppression_round_trips() -> None:
    """The suppress shape docs/api.md describes in prose: null creative, a reason, an audit_id."""
    suppressed = dict(EVALUATE_RESPONSE, decision="suppress", reason="no_fill", creative=None)
    parsed = EvaluateResponse.model_validate(suppressed)
    assert parsed.model_dump(mode="json", exclude_unset=True) == suppressed


def _doc_json_blocks() -> list[Any]:
    filled = re.sub(r'"sha256:\.\.\.(?: or null)?"', json.dumps(EXAMPLE_SHA256), DOC.read_text())
    return [json.loads(block) for block in re.findall(r"```json\n(.*?)```", filled, re.S)]


@pytest.mark.skipif(not DOC.exists(), reason="docs/api.md is not part of an installed package")
def test_examples_still_match_the_doc() -> None:
    """The copies above are the doc's own blocks, in the doc's own order."""
    assert _doc_json_blocks() == [
        EVALUATE_REQUEST,
        EVALUATE_RESPONSE,
        ATTEST_REQUEST,
        EVENT_REQUEST,
        VERIFY_RESPONSE,
    ]
