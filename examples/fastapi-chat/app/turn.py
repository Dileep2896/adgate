"""One chat turn: evaluate WHILE the model generates, then attest the finished answer.

This is the whole adgate integration for a streaming server. The shape is the same one
``AsyncAdgate.with_generation`` implements for non-streaming apps, opened up so the tokens can
leave the process as they arrive:

    evaluation = asyncio.ensure_future(client.evaluate(...))   # starts first, costs no latency
    async for token in generate(...):  yield token             # the user waits only for this
    decision = await evaluation                                # already resolved, in practice
    ... emit the decision, and the creative when it is a serve ...
    await client.attest(audit_id, answer, rendered)            # the sha256, never the text

The ad is never a token. It travels on its own SSE event, after the last one, which is what
lets the audit record claim the two were separate.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from adgate import AsyncAdgate, EvaluateResult
from adgate.models import Decision

from .config import Settings
from .model import AnswerStream
from .sse import DECISION, DONE, ERROR, SPONSORED, TOKEN, sse

#: docs/api.md: placement is always after_answer in v1, and this example shows one creative.
SURFACE: dict[str, Any] = {"type": "chat", "placement": "after_answer", "max_creatives": 1}

#: A creative must never render without a label. The gateway always sends one; if a future
#: policy ever leaves it blank, this is what the block says instead of nothing.
FALLBACK_DISCLOSURE_LABEL = "Sponsored"

GENERATION_FAILED = "The model call failed."


@dataclass(frozen=True)
class Turn:
    """One question, with the identity the gateway needs to apply frequency caps."""

    message: str
    conversation_id: str
    turn_id: str
    tier: str


@dataclass(frozen=True)
class ChatDeps:
    """What a turn needs. Built once in app/main.py; the tests build their own."""

    settings: Settings
    client: AsyncAdgate
    generate: AnswerStream


def evaluate_request(app_id: str, turn: Turn) -> dict[str, Any]:
    """The POST /v1/evaluate body (docs/api.md).

    Only the user's question is sent - not the system prompt, and not the answer, which does
    not exist yet. ``user.tier`` is what the free/paid toggle changes: the gateway suppresses a
    paid turn unless the app's policy sets allow_paid_tiers.
    """
    return {
        "app_id": app_id,
        "conversation_id": turn.conversation_id,
        "turn_id": turn.turn_id,
        "user": {"tier": turn.tier, "region": "US", "locale": "en-US"},
        "messages": [{"role": "user", "content": turn.message}],
        "surface": dict(SURFACE),
    }


def decision_payload(decision: EvaluateResult) -> dict[str, Any]:
    """The `decision` event: the outcome of the turn, served or not."""
    body = decision.model_dump(mode="json")
    return {
        "decision": body["decision"],
        "reason": body["reason"],
        "audit_id": body["audit_id"],
        "latency_ms": body["latency_ms"],
    }


def sponsored_payload(decision: EvaluateResult) -> dict[str, Any]:
    """The `sponsored` event: the creative to render, its label, and the record proving it."""
    body = decision.model_dump(mode="json")
    creative: dict[str, Any] = body["creative"]
    label = str(creative.get("disclosure_label") or "").strip() or FALLBACK_DISCLOSURE_LABEL
    return {
        "audit_id": body["audit_id"],
        "disclosure_label": label,
        "creative": creative,
    }


def is_serve(decision: EvaluateResult) -> bool:
    """A creative may be rendered only for a serve decision that actually carries one."""
    return decision.decision == Decision.serve and decision.creative is not None


async def stream_turn(deps: ChatDeps, turn: Turn) -> AsyncIterator[str]:
    """The SSE body: token* -> decision -> sponsored? -> done."""
    evaluation = asyncio.ensure_future(
        deps.client.evaluate(evaluate_request(deps.settings.app_id, turn))
    )
    try:
        parts: list[str] = []
        try:
            async for token in deps.generate(turn.message):
                parts.append(token)
                yield sse(TOKEN, {"text": token})
        except Exception:  # noqa: BLE001 - a broken model ends the turn, it never serves an ad
            yield sse(ERROR, {"message": GENERATION_FAILED})
            yield sse(DONE, {"audit_id": None, "chars": 0})
            return

        answer = "".join(parts)
        # evaluate has had the whole generation to finish and never raises: on any failure it
        # returns a suppress decision, so this await cannot break the response either.
        decision = await evaluation
        yield sse(DECISION, decision_payload(decision))
        served = is_serve(decision)
        if served:
            yield sse(SPONSORED, sponsored_payload(decision))

        if decision.audit_id:
            # Only the sha256 of the answer leaves the process, never the answer. Awaited
            # before `done` so that the record is complete the moment the client sees the
            # turn end - the audit id in the `done` event is immediately verifiable.
            await deps.client.attest(decision.audit_id, answer, rendered=served)
        yield sse(DONE, {"audit_id": decision.audit_id, "chars": len(answer)})
    finally:
        # A client that hangs up mid-answer leaves an evaluate in flight. Cancelling a task
        # that has already finished is a no-op, so this is only ever the disconnect case.
        evaluation.cancel()


__all__ = [
    "FALLBACK_DISCLOSURE_LABEL",
    "GENERATION_FAILED",
    "SURFACE",
    "ChatDeps",
    "Turn",
    "decision_payload",
    "evaluate_request",
    "is_serve",
    "sponsored_payload",
    "stream_turn",
]
