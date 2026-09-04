"""Process entry point::

    uvicorn app.main:app --reload --port 8000

The environment is read here and nowhere else, at import time: a missing ADGATE_API_KEY is a
readable ConfigError before the port opens, rather than a mystery suppression later. Everything
this module builds is testable without it - see app/api.py and the tests.
"""

from __future__ import annotations

from .api import create_app, deps_from_settings
from .config import settings_from_env

app = create_app(deps_from_settings(settings_from_env()))

__all__ = ["app"]
