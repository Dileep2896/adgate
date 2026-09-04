# adgate (Python SDK)

Client for the [adgate](../../README.md) gateway: ask whether a sponsored slot is allowed for
this conversation turn, prove which model answer it was shown next to, and record events.

adgate is not an ad network. The gateway decides, fetches a candidate, and writes a signed
audit record; this package is the thin, never-raising client in front of it.

Two rules the SDK cannot enforce for you, from `docs/policy.md`:

- The ad never goes inside the model's answer. Render `decision.creative` in a separate block
  after the answer, with `creative.disclosure_label` visible.
- `creative.url` is already the gateway's click redirect. Link to it as-is.

## Install

```bash
pip install adgate            # httpx and pydantic v2 come with it
```

Python 3.10 or newer.

## Use it

```python
from adgate import Adgate

with Adgate(api_key="ak_live_...", base_url="https://adgate.example.com") as adgate:
    decision = adgate.evaluate(
        {
            "app_id": "app_01J...",
            "conversation_id": "conv_abc",
            "turn_id": "turn_7",
            "user": {"tier": "free", "region": "US"},
            "messages": [{"role": "user", "content": question}],
            "surface": {"type": "chat", "placement": "after_answer"},
        }
    )

    answer = my_model(question)                     # your generation, untouched

    if decision.decision == "serve" and decision.creative:
        render_sponsored_block(decision.creative)   # separate, labeled, after the answer
        adgate.track(decision.audit_id, "impression")

    adgate.attest(decision.audit_id, answer)        # sends sha256(answer), never the answer
```

`AsyncAdgate` is the same class with awaits and an `httpx.AsyncClient`:

```python
from adgate import AsyncAdgate

async with AsyncAdgate(api_key="ak_live_...", base_url="https://adgate.example.com") as adgate:
    turn = await adgate.with_generation(request, lambda: generate(question))
    print(turn.answer, turn.decision.decision, turn.attest)
```

`with_generation` runs the evaluate call and your generation concurrently (a worker thread on
`Adgate`, `asyncio.gather` on `AsyncAdgate`), then attests the finished answer once. If your
`generate` raises, that exception reaches you unchanged and nothing is attested.

### Requests

`evaluate` takes a plain dict (posted as given) or a generated model:

```python
from adgate import EvaluateRequest

request = EvaluateRequest.model_validate({...})     # validates against the contract
```

`EvaluateRequest` is a union model - the contract requires either `messages` or
`context_summary` - so build it with `model_validate`, not `EvaluateRequest(...)`.

## It never raises

An app must not break because adgate is slow, unreachable or wrong.

| what happened | `evaluate` returns | `attest` / `track` return |
| --- | --- | --- |
| connection error | suppress, `error.kind == "network"` | `ok=False`, `error="network"` |
| deadline (0.8 s default) | suppress, `error.kind == "timeout"` | `ok=False`, `error="timeout"` |
| 401, 429, any non-2xx | suppress, `error.kind == "http"`, `error.status` | `ok=False`, `status`, `error="http"` |
| malformed or off-contract body | suppress, `error.kind == "invalid_response"` | - |

A failed `evaluate` is a real `EvaluateResult`: `decision == "suppress"`, `reason == "error"`,
`creative is None`, `audit_id is None` (there is no record to attest or track against) and
`classification.prompt_version == CLIENT_FAILURE_PROMPT_VERSION`, so dashboards can tell a
client-side failure from a gateway classification.

The one exception the package raises is `AdgateConfigError`, while constructing a client with
an empty `api_key` or `base_url` or a non-positive `timeout`.

Nothing is logged by default. Pass `logger=logging.getLogger("adgate")` for one `warning` per
failed call; it carries kinds, statuses and audit ids only, never message or answer text.

## Contract models

`adgate.models` is **generated** from `packages/schemas/json/*.schema.json`, the JSON Schema
export of the Zod schemas that define the API (`docs/api.md`), so the Python and TypeScript
SDKs cannot drift. The file is checked in; regenerate it after any schema change:

```bash
cd packages/sdk-python
python -m scripts.generate_models            # rewrites src/adgate/models.py
python -m scripts.generate_models --check    # exit 1 if it is stale (what CI runs)
```

`tests/test_models_generated.py` regenerates into a temporary directory and compares byte for
byte, so a schema change without a regenerated `models.py` fails CI.

Model names are the titles the Zod schemas carry: `EvaluateRequest`, `EvaluateResponse`,
`Creative`, `Classification`, `AuditRecord`, `AuditCreative`, `DemandUser`, and so on. Nested
policy leaves that share a title but not a shape (`Disclosure`, `DisclosurePosition1`) keep the
generator's numbering.

## Develop

```bash
cd packages/sdk-python
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                 # no network: httpx is intercepted with respx
ruff check .
mypy
```

`pnpm test` at the repo root does NOT run this suite (it is not a pnpm workspace package); CI
runs it in its own `python` job.
