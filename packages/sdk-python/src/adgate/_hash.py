"""sha256 of the model's answer, in the contract's on-the-wire form.

Only the hash ever leaves the process: attest proves WHICH answer was on screen without
sending the answer. Byte identical to @adgateio/core's sha256Prefixed and to the TypeScript
SDK's hashModelOutput over the same UTF-8 text (tests/test_hash.py pins the vector).
"""

from __future__ import annotations

import hashlib

SHA256_PREFIX = "sha256:"


def hash_model_output(text: str) -> str:
    """``sha256:<64 lowercase hex digits>`` over the UTF-8 encoding of ``text``."""
    return SHA256_PREFIX + hashlib.sha256(text.encode("utf-8")).hexdigest()


#: prompt_version of the classification the client synthesises when the gateway never
#: answered. Classification requires a non-empty prompt_version and every real one is a
#: sha256 of a prompt or rule set, so this is the sha256 of a fixed seed string: it
#: satisfies the schema and is recognisable in dashboards as "the SDK failed closed, the
#: gateway did not classify". Same seed and same digest as the TypeScript SDK.
CLIENT_FAILURE_PROMPT_SEED = "adgate-sdk-client-failure"
CLIENT_FAILURE_PROMPT_VERSION = (
    "sha256:679b29a0864703385ac8b4ec9b3614e1fcd32dbc33b09c69a5227a992c88ac96"
)

__all__ = [
    "CLIENT_FAILURE_PROMPT_SEED",
    "CLIENT_FAILURE_PROMPT_VERSION",
    "SHA256_PREFIX",
    "hash_model_output",
]
