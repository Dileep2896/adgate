"""The wire: one JSON POST with a bearer key and a hard deadline, and how to read it back.

Transport-free on purpose. httpx.Client and httpx.AsyncClient differ only in the await, so
everything that decides what to send and what an answer means lives here and both clients
in client.py share it.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from ._hash import hash_model_output
from .errors import ClientError, ClientErrorKind
from .models import EvaluateResponse
from .results import EvaluateResult, PostResult, fail_closed_evaluate

#: Per-call deadline in SECONDS (httpx's unit). 0.8 s, the TypeScript SDK's 800 ms:
#: evaluate must never hold up the answer the user is waiting for.
DEFAULT_TIMEOUT = 0.8

EVALUATE_PATH = "/v1/evaluate"
ATTEST_PATH = "/v1/attest"
EVENTS_PATH = "/v1/events"

#: Anything the caller may hand to evaluate: a generated model, or the request as a dict.
RequestLike = BaseModel | Mapping[str, Any]


@dataclass(frozen=True)
class Answer:
    """The gateway answered, with any status. The body is read as text, never assumed JSON."""

    status: int
    text: str


@dataclass(frozen=True)
class Failure:
    """No usable answer arrived."""

    kind: ClientErrorKind


Outcome = Answer | Failure


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def is_success_status(status: int) -> bool:
    return 200 <= status < 300


def auth_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def now_iso() -> str:
    """Now as an IsoTimestamp: UTC, milliseconds, Z suffix (2026-09-02T18:04:11.123Z)."""
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return stamp.replace("+00:00", "Z")


def request_payload(request: RequestLike) -> Any:
    """A model becomes its JSON form (nulls dropped); a dict is posted exactly as given."""
    if isinstance(request, BaseModel):
        return request.model_dump(mode="json", exclude_none=True)
    return request


def attest_payload(audit_id: str, model_output_text: str, rendered: bool) -> dict[str, Any]:
    """An AttestRequest. ONLY the hash of the answer is in it; the text stays in the process."""
    return {
        "audit_id": audit_id,
        "model_output_hash": hash_model_output(model_output_text),
        "rendered": rendered,
    }


def event_payload(
    audit_id: str,
    event_type: str,
    ts: str | None,
    meta: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """An EventRequest. meta is sent only when the caller gave one, as the TS SDK does."""
    payload: dict[str, Any] = {"audit_id": audit_id, "type": event_type, "ts": ts or now_iso()}
    if meta is not None:
        payload["meta"] = dict(meta)
    return payload


def failure_of(exception: BaseException) -> Failure:
    """Any transport problem is a Failure: a deadline is a timeout, everything else network."""
    if isinstance(exception, httpx.TimeoutException):
        return Failure("timeout")
    return Failure("network")


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


def evaluate_result(outcome: Outcome, latency_ms: int) -> EvaluateResult:
    """Read an /v1/evaluate outcome. Never raises: anything unusable fails closed to suppress.

    A 2xx body must parse as JSON and satisfy the EvaluateResponse contract, so a proxy, a
    captive portal or a wrong base_url answering in the gateway's place suppresses instead
    of rendering an ad nobody audited.
    """
    if isinstance(outcome, Failure):
        return fail_closed_evaluate(ClientError(kind=outcome.kind), latency_ms)
    if not is_success_status(outcome.status):
        return fail_closed_evaluate(
            ClientError(kind="http", status=outcome.status), latency_ms
        )
    body = _parse_json(outcome.text)
    if body is None:
        return fail_closed_evaluate(
            ClientError(kind="invalid_response", status=outcome.status), latency_ms
        )
    try:
        response = EvaluateResponse.model_validate(body)
    except ValidationError:
        return fail_closed_evaluate(
            ClientError(kind="invalid_response", status=outcome.status), latency_ms
        )
    return EvaluateResult.model_validate(response.model_dump())


def post_result(outcome: Outcome) -> PostResult:
    """Read an /v1/attest or /v1/events outcome. 404 and 409 are reported, never raised."""
    if isinstance(outcome, Failure):
        return PostResult(ok=False, error=outcome.kind)
    if is_success_status(outcome.status):
        return PostResult(ok=True, status=outcome.status)
    return PostResult(ok=False, status=outcome.status, error="http")


__all__ = [
    "ATTEST_PATH",
    "DEFAULT_TIMEOUT",
    "EVALUATE_PATH",
    "EVENTS_PATH",
    "Answer",
    "Failure",
    "Outcome",
    "RequestLike",
    "attest_payload",
    "auth_headers",
    "evaluate_result",
    "event_payload",
    "failure_of",
    "is_success_status",
    "join_url",
    "now_iso",
    "post_result",
    "request_payload",
]
