"""What the client methods hand back. Every one of them is a value, never an exception."""

from __future__ import annotations

from pydantic import BaseModel

from ._hash import CLIENT_FAILURE_PROMPT_VERSION
from .errors import ClientError, ClientErrorKind
from .models import (
    Classification,
    ClassificationMethod,
    ContentCategory,
    Decision,
    EvaluateResponse,
    SuppressReason,
)


class EvaluateResult(EvaluateResponse):
    """The gateway's EvaluateResponse, or the suppress decision the client failed closed to.

    On success it is exactly what the gateway sent (docs/api.md). On any failure it is a
    suppress decision with reason ``error``, ``audit_id`` None - the gateway never answered,
    or answered with something unusable, so there is no record to attest or track against -
    and ``error`` describing what happened.

    ``audit_id`` drops the AuditId pattern its parent carries because None is a value it
    must be able to hold; a non-None one has already been validated as an AuditId by
    EvaluateResponse before it is copied here.
    """

    # The widening is deliberate and pydantic honours it; mypy sees only the Liskov break.
    audit_id: str | None = None  # type: ignore[assignment]
    error: ClientError | None = None


class PostResult(BaseModel):
    """Outcome of attest and track. ``status`` is the HTTP status when one arrived."""

    ok: bool
    status: int | None = None
    error: ClientErrorKind | None = None


class TurnResult(BaseModel):
    """What with_generation covers: the answer, the decision, and the attestation of both."""

    answer: str
    """Exactly what generate() returned; the helper never rewrites the answer."""
    decision: EvaluateResult
    attest: PostResult | None = None
    """None when there was nothing to attest (the decision carries no audit_id)."""


def fail_closed_evaluate(error: ClientError, latency_ms: int) -> EvaluateResult:
    """The result evaluate returns when the gateway never gave a usable answer."""
    return EvaluateResult(
        decision=Decision.suppress,
        reason=SuppressReason.error,
        classification=Classification(
            commercial_intent=0,
            categories=[ContentCategory.general],
            sensitive=[],
            confidence=0,
            method=ClassificationMethod.rules,
            prompt_version=CLIENT_FAILURE_PROMPT_VERSION,
        ),
        creative=None,
        audit_id=None,
        latency_ms=latency_ms,
        error=error,
    )


__all__ = ["EvaluateResult", "PostResult", "TurnResult", "fail_closed_evaluate"]
