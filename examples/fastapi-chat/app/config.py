"""Configuration, read from the process environment.

No dotenv dependency: uvicorn already loads a file for you with ``--env-file .env``, and the
README says so. Everything is validated once, at import time, so a missing key is a readable
message before a port is opened rather than a suppressed ad nobody can explain.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

#: Where the gateway listens in the documented local setup.
DEFAULT_ADGATE_BASE_URL = "http://localhost:8787"

#: Any endpoint that speaks the OpenAI chat completions protocol.
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

#: Milliseconds between the offline model's tokens. Slow enough to watch the answer arrive.
DEFAULT_CHUNK_DELAY_MS = 35


class ConfigError(RuntimeError):
    """A missing or unusable environment variable."""


@dataclass(frozen=True)
class OpenAIConfig:
    """An OpenAI-compatible chat completions endpoint, when one is configured."""

    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True)
class Settings:
    """Everything the example needs to run one turn."""

    app_id: str
    api_key: str
    base_url: str = DEFAULT_ADGATE_BASE_URL
    openai: OpenAIConfig | None = None
    chunk_delay_ms: int = DEFAULT_CHUNK_DELAY_MS

    @property
    def offline(self) -> bool:
        """True when no model provider is configured and the canned model answers instead."""
        return self.openai is None


def _value(env: Mapping[str, str], name: str) -> str:
    return env.get(name, "").strip()


def _required(env: Mapping[str, str], name: str, hint: str) -> str:
    value = _value(env, name)
    if not value:
        raise ConfigError(f"{name} is not set. {hint}")
    return value


def _chunk_delay_ms(env: Mapping[str, str]) -> int:
    raw = _value(env, "MOCK_CHUNK_DELAY_MS")
    if not raw:
        return DEFAULT_CHUNK_DELAY_MS
    try:
        delay = int(raw)
    except ValueError as error:
        raise ConfigError("MOCK_CHUNK_DELAY_MS must be a whole number of milliseconds") from error
    if delay < 0:
        raise ConfigError("MOCK_CHUNK_DELAY_MS must not be negative")
    return delay


def openai_from_env(env: Mapping[str, str]) -> OpenAIConfig | None:
    """A real provider only when OPENAI_API_KEY is set; base URL and model are optional."""
    api_key = _value(env, "OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAIConfig(
        api_key=api_key,
        base_url=_value(env, "OPENAI_BASE_URL") or DEFAULT_OPENAI_BASE_URL,
        model=_value(env, "OPENAI_MODEL") or DEFAULT_OPENAI_MODEL,
    )


def settings_from_env(env: Mapping[str, str] | None = None) -> Settings:
    """Read the environment. Raises ConfigError with the command that produces the value."""
    source = os.environ if env is None else env
    return Settings(
        app_id=_required(
            source,
            "ADGATE_APP_ID",
            "It is the app_id printed by `pnpm --filter @adgate/gateway create-app`.",
        ),
        api_key=_required(
            source,
            "ADGATE_API_KEY",
            "It is the app-role key printed once by the same command.",
        ),
        base_url=_value(source, "ADGATE_BASE_URL") or DEFAULT_ADGATE_BASE_URL,
        openai=openai_from_env(source),
        chunk_delay_ms=_chunk_delay_ms(source),
    )


__all__ = [
    "DEFAULT_ADGATE_BASE_URL",
    "DEFAULT_CHUNK_DELAY_MS",
    "DEFAULT_OPENAI_BASE_URL",
    "DEFAULT_OPENAI_MODEL",
    "ConfigError",
    "OpenAIConfig",
    "Settings",
    "openai_from_env",
    "settings_from_env",
]
