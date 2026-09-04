"""The FastAPI app: a static page, one streaming chat endpoint, and a health check.

``create_app`` takes already-constructed dependencies so the tests can hand it a client
pointed at a faked gateway. app/main.py is the process entry point that builds them from the
environment.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from adgate import AsyncAdgate
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import Settings
from .model import answer_stream, model_name
from .sse import SSE_HEADERS
from .turn import ChatDeps, Turn, stream_turn

STATIC_DIR = Path(__file__).parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"

#: The two tiers the demo toggles between. Anything else is treated as free, because the
#: gateway - not this app - is what decides which tiers may be served.
TIERS = ("free", "paid")


class ChatRequest(BaseModel):
    """POST /chat. Only `message` is required; the rest keep a conversation together."""

    message: str = Field(min_length=1)
    conversation_id: str | None = None
    turn_id: str | None = None
    tier: str = "free"


def turn_of(request: ChatRequest) -> Turn:
    """Fill in the ids the browser did not send.

    Frequency caps are per conversation, so a real app must send a stable conversation_id (the
    page does, and it keeps it for the life of the tab).
    """
    return Turn(
        message=request.message,
        conversation_id=request.conversation_id or f"conv_{uuid.uuid4().hex}",
        turn_id=request.turn_id or f"turn_{uuid.uuid4().hex}",
        tier=request.tier if request.tier in TIERS else "free",
    )


def deps_from_settings(settings: Settings) -> ChatDeps:
    """One adgate client and one generator for the life of the process."""
    return ChatDeps(
        settings=settings,
        client=AsyncAdgate(api_key=settings.api_key, base_url=settings.base_url),
        generate=answer_stream(settings),
    )


def create_app(deps: ChatDeps) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await deps.client.close()

    api = FastAPI(title="adgate example: FastAPI chat", lifespan=lifespan)

    @api.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(INDEX_HTML, media_type="text/html")

    @api.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {
            "ok": True,
            "model": model_name(deps.settings),
            "offline": deps.settings.offline,
            "adgate_base_url": deps.settings.base_url,
        }

    @api.post("/chat")
    async def chat(request: ChatRequest) -> StreamingResponse:
        """Stream the answer, then the ad decision, as separate SSE events."""
        return StreamingResponse(
            stream_turn(deps, turn_of(request)),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )

    return api


__all__ = [
    "INDEX_HTML",
    "STATIC_DIR",
    "TIERS",
    "ChatRequest",
    "create_app",
    "deps_from_settings",
    "turn_of",
]
