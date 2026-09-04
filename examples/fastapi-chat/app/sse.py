"""Server-Sent Events: the four event names this example emits, and how one is written.

The wire format is the whole point of the example, so it is worth being precise about it. One
turn is:

    event: token        zero or more, the answer as it is generated
    event: decision     exactly one, what the gateway decided and why
    event: sponsored    ONLY when the decision is serve
    event: done         exactly one, last

``token`` never carries anything but model text, and ``sponsored`` never carries model text.
That separation is what adgate exists to prove, and it is visible on the wire.
"""

from __future__ import annotations

import json
from typing import Any

#: A chunk of the model's answer: ``{"text": "..."}``.
TOKEN = "token"

#: The gateway's outcome for this turn: decision, reason, audit_id, latency_ms. Always sent,
#: for served and suppressed turns alike, so the demo UI can show why nothing was shown.
DECISION = "decision"

#: The creative to render, in a labelled block BELOW the answer. Serve decisions only.
SPONSORED = "sponsored"

#: The model call failed. The turn ends with no decision and no ad.
ERROR = "error"

#: The turn is over: the answer is complete and the audit record has been attested.
DONE = "done"

#: Sent alongside media_type text/event-stream. X-Accel-Buffering stops nginx buffering the
#: stream into one lump, which would hide the point of the demo behind a proxy.
SSE_HEADERS = {
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def sse(event: str, data: Any) -> str:
    """One SSE event. The JSON is on a single line: json.dumps escapes every newline."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


__all__ = ["DECISION", "DONE", "ERROR", "SPONSORED", "SSE_HEADERS", "TOKEN", "sse"]
