"""What both clients share: configuration, URLs, silence by default, and result reading.

Kept apart from client.py so the two client classes there are only their transport: what a
failure MEANS is decided once, in one place, for the sync and the async client alike.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from contextlib import suppress
from enum import Enum
from typing import Any, Protocol

from ._http import (
    DEFAULT_TIMEOUT,
    Outcome,
    auth_headers,
    evaluate_result,
    join_url,
    post_result,
)
from .errors import AdgateConfigError
from .models import Decision, EventType
from .results import EvaluateResult, PostResult

#: Whether the sponsored block was actually shown, for the attest call with_generation makes
#: on the caller's behalf. A predicate is given the decision, so an app that renders
#: conditionally can answer once the decision is known. Default: True for serve, False for
#: suppress.
Rendered = bool | Callable[[EvaluateResult], bool] | None


class Logger(Protocol):
    """Anything with logging.Logger's warning(). A library stays silent unless given one."""

    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None: ...


def resolve_rendered(rendered: Rendered, decision: EvaluateResult) -> bool:
    if isinstance(rendered, bool):
        return rendered
    if callable(rendered):
        # A throwing predicate is a caller bug, not a reason to break the turn: the default
        # below then applies, and the audit record says what the decision said.
        with suppress(Exception):
            return bool(rendered(decision))
    return decision.decision == Decision.serve


def event_name(event_type: EventType | str) -> str:
    return event_type.value if isinstance(event_type, Enum) else event_type


def elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1000))


class BaseAdgate:
    """Everything both clients share: configuration, URLs, logging, result interpretation."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = DEFAULT_TIMEOUT,
        logger: Logger | None = None,
    ) -> None:
        if not isinstance(api_key, str) or not api_key:
            raise AdgateConfigError("api_key must be a non-empty string")
        if not isinstance(base_url, str) or not base_url:
            raise AdgateConfigError("base_url must be a non-empty string")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
            raise AdgateConfigError("timeout must be a positive number of seconds")
        self._api_key = api_key
        self._base_url = base_url
        self._timeout = float(timeout)
        self._logger = logger

    def _url(self, path: str) -> str:
        return join_url(self._base_url, path)

    def _headers(self) -> dict[str, str]:
        return auth_headers(self._api_key)

    def _warn(self, message: str, **data: Any) -> None:
        """One warn per failure, with kinds and ids only - never the request or any text."""
        if self._logger is None:
            return
        with suppress(Exception):  # a throwing logger must not break the call
            self._logger.warning("%s %s", message, data)

    def _evaluated(self, outcome: Outcome, started: float) -> EvaluateResult:
        result = evaluate_result(outcome, elapsed_ms(started))
        if result.error is not None:
            self._warn(
                "adgate evaluate failed",
                kind=result.error.kind,
                status=result.error.status,
            )
        return result

    def _settled(self, what: str, audit_id: str, outcome: Outcome) -> PostResult:
        result = post_result(outcome)
        if not result.ok:
            # 404 (the gateway could not persist the record, see docs/api.md error behavior)
            # and 409 (already attested) land here too: reported, never raised.
            self._warn(
                f"adgate {what} failed",
                audit_id=audit_id,
                status=result.status,
                error=result.error,
            )
        return result


__all__ = [
    "BaseAdgate",
    "Logger",
    "Rendered",
    "event_name",
    "resolve_rendered",
]
