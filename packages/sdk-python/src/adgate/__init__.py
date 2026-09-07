"""adgate: the neutral policy, verification and mediation gateway for ads in AI chat.

    from adgate import Adgate

    with Adgate(api_key="ak_...", base_url="https://adgate.example.com") as adgate:
        decision = adgate.evaluate(
            {
                "app_id": "app_01J...",
                "conversation_id": "conv_abc",
                "turn_id": "turn_7",
                "user": {"tier": "free", "region": "US"},
                "messages": [{"role": "user", "content": text}],
                "surface": {"type": "chat", "placement": "after_answer"},
            }
        )
        answer = my_model(text)
        adgate.attest(decision.audit_id, answer)

The ad is never part of ``answer``: render decision.creative in a separate labeled block
after it. No method here raises - see adgate.errors.

The contract models in adgate.models are generated from packages/schemas (docs/api.md).
"""

from __future__ import annotations

from ._hash import (
    CLIENT_FAILURE_PROMPT_SEED,
    CLIENT_FAILURE_PROMPT_VERSION,
    SHA256_PREFIX,
    hash_model_output,
)
from ._http import (
    ATTEST_PATH,
    DEFAULT_TIMEOUT,
    EVALUATE_PATH,
    EVENTS_PATH,
    RequestLike,
)
from .client import Adgate, AsyncAdgate, Logger, Rendered
from .errors import AdgateConfigError, ClientError, ClientErrorKind
from .models import (
    AttestRequest,
    Classification,
    Creative,
    Decision,
    EvaluateRequest,
    EvaluateResponse,
    EventRequest,
    EventType,
    Message,
    SuppressReason,
    Surface,
    User,
)
from .results import EvaluateResult, PostResult, TurnResult, fail_closed_evaluate

__version__ = "0.1.0-alpha.1"

__all__ = [
    "ATTEST_PATH",
    "CLIENT_FAILURE_PROMPT_SEED",
    "CLIENT_FAILURE_PROMPT_VERSION",
    "DEFAULT_TIMEOUT",
    "EVALUATE_PATH",
    "EVENTS_PATH",
    "SHA256_PREFIX",
    "Adgate",
    "AdgateConfigError",
    "AsyncAdgate",
    "AttestRequest",
    "Classification",
    "ClientError",
    "ClientErrorKind",
    "Creative",
    "Decision",
    "EvaluateRequest",
    "EvaluateResponse",
    "EvaluateResult",
    "EventRequest",
    "EventType",
    "Logger",
    "Message",
    "PostResult",
    "Rendered",
    "RequestLike",
    "SuppressReason",
    "Surface",
    "TurnResult",
    "User",
    "__version__",
    "fail_closed_evaluate",
    "hash_model_output",
]
