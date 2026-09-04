"""What can go wrong, and the one thing that is ever raised.

A client call NEVER raises: an app must not break because adgate is slow, unreachable or
wrong. Every failure is reported in the returned value - evaluate fails closed to a
suppress decision carrying a ClientError, attest and track answer PostResult(ok=False).
The single exception is AdgateConfigError, raised while CONSTRUCTING a client with an
unusable api_key, base_url or timeout: that is a programming error, best seen at boot.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

#: Why a call did not produce a usable answer.
#:
#: - ``network``: no response was obtained (the transport failed, or the request could not
#:   be prepared, e.g. a body that is not JSON serialisable).
#: - ``timeout``: the client's own deadline expired first.
#: - ``http``: the gateway answered with a non-2xx status (see ``status``).
#: - ``invalid_response``: a 2xx answer whose body is not JSON or not the documented shape.
ClientErrorKind = Literal["network", "timeout", "http", "invalid_response"]


class ClientError(BaseModel):
    """Why evaluate could not use the gateway's answer. Carried on the suppress result."""

    kind: ClientErrorKind
    status: int | None = None
    """The HTTP status, when one arrived at all."""


class AdgateConfigError(ValueError):
    """A client was constructed with an unusable api_key, base_url or timeout."""


__all__ = ["AdgateConfigError", "ClientError", "ClientErrorKind"]
