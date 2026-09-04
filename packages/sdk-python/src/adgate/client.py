"""The adgate clients: Adgate (httpx.Client) and AsyncAdgate (httpx.AsyncClient).

Same methods, same meaning, same failure behaviour - only the awaits differ. No call ever
raises: evaluate fails closed to a suppress decision, attest and track answer
PostResult(ok=False). The only exception is AdgateConfigError while constructing a client.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from types import TracebackType
from typing import Any

import httpx

from ._base import BaseAdgate, Logger, Rendered, event_name, resolve_rendered
from ._http import (
    ATTEST_PATH,
    DEFAULT_TIMEOUT,
    EVALUATE_PATH,
    EVENTS_PATH,
    Answer,
    Outcome,
    RequestLike,
    attest_payload,
    event_payload,
    failure_of,
    request_payload,
)
from .models import EventType
from .results import EvaluateResult, PostResult, TurnResult


class Adgate(BaseAdgate):
    """Synchronous client. Use it as a context manager to close the httpx client."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = DEFAULT_TIMEOUT,
        transport: httpx.BaseTransport | None = None,
        logger: Logger | None = None,
    ) -> None:
        super().__init__(api_key, base_url, timeout, logger)
        self._client = httpx.Client(transport=transport, timeout=self._timeout)

    def __enter__(self) -> Adgate:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _post(self, path: str, payload: Any) -> Outcome:
        try:
            response = self._client.post(
                self._url(path), json=payload, headers=self._headers(), timeout=self._timeout
            )
            return Answer(status=response.status_code, text=response.text)
        except Exception as exception:  # noqa: BLE001 - every transport problem is an Outcome
            return failure_of(exception)

    def evaluate(self, request: RequestLike) -> EvaluateResult:
        """Ask the gateway whether a sponsored slot may follow this turn. Never raises."""
        started = time.monotonic()
        return self._evaluated(self._post(EVALUATE_PATH, request_payload(request)), started)

    def attest(self, audit_id: str, model_output_text: str, rendered: bool = True) -> PostResult:
        """Hash the complete answer locally and send ONLY the hash. Never raises."""
        try:
            payload = attest_payload(audit_id, model_output_text, rendered)
        except Exception as exception:  # noqa: BLE001 - e.g. text that is not encodable
            return self._settled("attest", audit_id, failure_of(exception))
        return self._settled("attest", audit_id, self._post(ATTEST_PATH, payload))

    def track(
        self,
        audit_id: str,
        event_type: EventType | str,
        ts: str | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> PostResult:
        """Record an impression, click, dismiss or conversion. Never raises."""
        payload = event_payload(audit_id, event_name(event_type), ts, meta)
        return self._settled("track", audit_id, self._post(EVENTS_PATH, payload))

    def with_generation(
        self,
        request: RequestLike,
        generate: Callable[[], str],
        rendered: Rendered = None,
    ) -> TurnResult:
        """Evaluate WHILE the model generates, then attest the finished answer.

        The evaluate call runs on a worker thread so adgate adds no latency to the answer
        the user is waiting for. The only error that ever reaches the caller is the
        caller's own: if generate() raises, that exception propagates untouched and nothing
        is attested (there is no answer to attest).
        """
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="adgate-evaluate")
        try:
            evaluation = pool.submit(self.evaluate, request)
            try:
                answer = generate()
            except BaseException:
                evaluation.cancel()
                raise
            decision = evaluation.result()
            attest = None
            if decision.audit_id:
                shown = resolve_rendered(rendered, decision)
                attest = self.attest(decision.audit_id, answer, shown)
            return TurnResult(answer=answer, decision=decision, attest=attest)
        finally:
            # No wait: evaluate is bounded by the client deadline and never raises, so an
            # abandoned one finishes on its own instead of holding up the caller's error.
            pool.shutdown(wait=False)


class AsyncAdgate(BaseAdgate):
    """Asynchronous client. Same methods and meaning as Adgate, with awaits."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = DEFAULT_TIMEOUT,
        transport: httpx.AsyncBaseTransport | None = None,
        logger: Logger | None = None,
    ) -> None:
        super().__init__(api_key, base_url, timeout, logger)
        self._client = httpx.AsyncClient(transport=transport, timeout=self._timeout)

    async def __aenter__(self) -> AsyncAdgate:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def _post(self, path: str, payload: Any) -> Outcome:
        try:
            response = await self._client.post(
                self._url(path), json=payload, headers=self._headers(), timeout=self._timeout
            )
            return Answer(status=response.status_code, text=response.text)
        except Exception as exception:  # noqa: BLE001 - every transport problem is an Outcome
            return failure_of(exception)

    async def evaluate(self, request: RequestLike) -> EvaluateResult:
        """Ask the gateway whether a sponsored slot may follow this turn. Never raises."""
        started = time.monotonic()
        outcome = await self._post(EVALUATE_PATH, request_payload(request))
        return self._evaluated(outcome, started)

    async def attest(
        self, audit_id: str, model_output_text: str, rendered: bool = True
    ) -> PostResult:
        """Hash the complete answer locally and send ONLY the hash. Never raises."""
        try:
            payload = attest_payload(audit_id, model_output_text, rendered)
        except Exception as exception:  # noqa: BLE001 - e.g. text that is not encodable
            return self._settled("attest", audit_id, failure_of(exception))
        return self._settled("attest", audit_id, await self._post(ATTEST_PATH, payload))

    async def track(
        self,
        audit_id: str,
        event_type: EventType | str,
        ts: str | None = None,
        meta: Mapping[str, Any] | None = None,
    ) -> PostResult:
        """Record an impression, click, dismiss or conversion. Never raises."""
        payload = event_payload(audit_id, event_name(event_type), ts, meta)
        return self._settled("track", audit_id, await self._post(EVENTS_PATH, payload))

    async def with_generation(
        self,
        request: RequestLike,
        generate: Callable[[], Awaitable[str]],
        rendered: Rendered = None,
    ) -> TurnResult:
        """Evaluate WHILE the model generates, then attest the finished answer.

        Both run concurrently so adgate adds no latency to the answer the user is waiting
        for. The only error that ever reaches the caller is the caller's own: if generate()
        raises, that exception propagates untouched, the evaluate task is cancelled and
        nothing is attested (there is no answer to attest).
        """
        evaluation = asyncio.ensure_future(self.evaluate(request))
        try:
            generation = asyncio.ensure_future(generate())
            answer, decision = await asyncio.gather(generation, evaluation)
        except BaseException:
            # generate() failed: nothing to attest, and the evaluate it was racing is of no
            # use to anyone. Cancelling it keeps the loop clean; the caller's error is next.
            evaluation.cancel()
            raise
        attest = None
        if decision.audit_id:
            attest = await self.attest(
                decision.audit_id, answer, resolve_rendered(rendered, decision)
            )
        return TurnResult(answer=answer, decision=decision, attest=attest)


#: Logger, Rendered and resolve_rendered live in _base.py; they are re-exported here
#: because this is where a reader of the client looks for them.
__all__ = ["Adgate", "AsyncAdgate", "Logger", "Rendered", "resolve_rendered"]
