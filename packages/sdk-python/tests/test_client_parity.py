"""The two clients are one API, and a client is only strict about its own configuration."""

from __future__ import annotations

import inspect

import httpx
import pytest
import respx

from adgate import Adgate, AsyncAdgate
from adgate.errors import AdgateConfigError

from .conftest import API_KEY, BASE_URL, EVALUATE_URL, REQUEST, SERVE_BODY

PUBLIC_METHODS = {"attest", "close", "evaluate", "track", "with_generation"}


def _methods(client: type) -> set[str]:
    return {
        name
        for name, _ in inspect.getmembers(client, predicate=inspect.isfunction)
        if not name.startswith("_")
    }


def test_sync_and_async_expose_the_same_methods() -> None:
    assert _methods(Adgate) == _methods(AsyncAdgate) == PUBLIC_METHODS


@pytest.mark.parametrize("method", sorted(PUBLIC_METHODS - {"with_generation"}))
def test_the_same_parameters_in_the_same_order(method: str) -> None:
    """with_generation is excluded: its generate() returns a str on one, an awaitable on
    the other."""
    assert list(inspect.signature(getattr(Adgate, method)).parameters) == list(
        inspect.signature(getattr(AsyncAdgate, method)).parameters
    )


def test_only_the_async_methods_are_coroutines() -> None:
    for name in PUBLIC_METHODS:
        assert not inspect.iscoroutinefunction(getattr(Adgate, name))
        assert inspect.iscoroutinefunction(getattr(AsyncAdgate, name))


BAD_CONFIG = [
    ("empty api key", {"api_key": "", "base_url": BASE_URL}),
    ("empty base url", {"api_key": API_KEY, "base_url": ""}),
    ("zero timeout", {"api_key": API_KEY, "base_url": BASE_URL, "timeout": 0}),
    ("negative timeout", {"api_key": API_KEY, "base_url": BASE_URL, "timeout": -1.0}),
    ("timeout is not a number", {"api_key": API_KEY, "base_url": BASE_URL, "timeout": "fast"}),
]


@pytest.mark.parametrize(("name", "kwargs"), BAD_CONFIG, ids=[c[0] for c in BAD_CONFIG])
@pytest.mark.parametrize("client", [Adgate, AsyncAdgate])
def test_construction_is_the_only_thing_that_raises(name, kwargs, client) -> None:
    with pytest.raises(AdgateConfigError):
        client(**kwargs)


@respx.mock
def test_a_trailing_slash_on_the_base_url_is_ignored() -> None:
    route = respx.post(EVALUATE_URL).mock(return_value=httpx.Response(200, json=SERVE_BODY))

    with Adgate(API_KEY, BASE_URL + "///") as adgate:
        adgate.evaluate(REQUEST)

    assert str(route.calls.last.request.url) == EVALUATE_URL


def test_the_context_manager_closes_the_http_client() -> None:
    with Adgate(API_KEY, BASE_URL) as adgate:
        assert adgate._client.is_closed is False
    assert adgate._client.is_closed is True


async def test_the_async_context_manager_closes_the_http_client() -> None:
    async with AsyncAdgate(API_KEY, BASE_URL) as adgate:
        assert adgate._client.is_closed is False
    assert adgate._client.is_closed is True


@respx.mock
def test_a_transport_can_be_injected() -> None:
    """No respx needed to fake the gateway: hand the client an httpx transport."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=SERVE_BODY)

    with Adgate(API_KEY, BASE_URL, transport=httpx.MockTransport(handler)) as adgate:
        result = adgate.evaluate(REQUEST)

    assert result.audit_id == SERVE_BODY["audit_id"]
    assert len(seen) == 1
