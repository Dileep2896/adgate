# adgate HTTP API contract (v1)

This document is the contract. packages/schemas implements it with Zod. Do not change the meaning of any field without a human decision recorded in progress.txt.

All endpoints are JSON over HTTPS. Authentication is `Authorization: Bearer <api_key>`. API keys have a role: `app` (can evaluate, attest, send events, read its own audit records) or `advertiser_read` (can read and verify audit records that reference its creatives).

## POST /v1/evaluate

Decide whether a sponsored slot may be shown for this turn and, if so, which creative.

Request:

```json
{
  "app_id": "app_01J...",
  "conversation_id": "conv_abc",
  "turn_id": "turn_7",
  "user": { "tier": "free", "region": "US", "locale": "en-US", "user_hash": "optional sha256" },
  "messages": [
    { "role": "user", "content": "which postgres hosting should I use for a side project" }
  ],
  "context_summary": "optional alternative to raw messages",
  "surface": { "type": "chat", "placement": "after_answer", "max_creatives": 1 },
  "policy_overrides": {}
}
```

- `messages`: the last few turns, newest last. Servers truncate to the last 4 messages and 4,000 characters before classification.
- `context_summary`: apps that will not send raw text may send a short summary instead. At least one of `messages` or `context_summary` is required.
- `user.tier`: `free` or `paid` (apps may add other strings; anything not in `serve_to_tiers` is suppressed).
- `surface.type`: `chat`, `agent`, or `cli`. `surface.placement` is always `after_answer` in v1.
- `policy_overrides`: a partial PolicyConfig merged over the app's stored policy. Overrides may only make policy stricter (they cannot remove blocked categories, raise caps, or enable paid tiers).

Response (HTTP 200 always, even on internal errors):

```json
{
  "decision": "serve",
  "reason": null,
  "classification": {
    "commercial_intent": 0.84,
    "categories": ["software.devtools.database"],
    "sensitive": [],
    "confidence": 0.91,
    "method": "llm",
    "prompt_version": "sha256:..."
  },
  "creative": {
    "id": "cr_01J...",
    "advertiser": "Example DB Cloud",
    "headline": "Managed Postgres with a free tier",
    "body": "Spin up a database in 30 seconds.",
    "cta": "Try it free",
    "url": "https://<gateway>/c/aud_01J...",
    "source": "direct",
    "disclosure_label": "Sponsored"
  },
  "audit_id": "aud_01J...",
  "latency_ms": 142
}
```

When suppressed: `decision` is `"suppress"`, `creative` is `null`, and `reason` is exactly one of:

`paid_user`, `region_blocked`, `sensitive_category:<name>`, `low_confidence`, `low_commercial_intent`, `frequency_cap`, `no_fill`, `error`.

An `audit_id` is returned for every evaluation, including suppressions, so that suppress decisions are also verifiable.

`creative.url` always points at the gateway click redirect, never directly at the advertiser.

## POST /v1/attest

Called by the SDK after the model's answer is complete. Proves the ad decision was independent of, and rendered separately from, the model output.

```json
{ "audit_id": "aud_01J...", "model_output_hash": "sha256:...", "rendered": true }
```

Returns 204. The audit record is re-hashed and re-signed with `model_output_hash` and `separation_attestation: true`, keeping a link to the previous record hash.

## POST /v1/events

```json
{ "audit_id": "aud_01J...", "type": "impression", "ts": "2026-09-02T18:04:11Z", "meta": {} }
```

`type` is one of `impression`, `click`, `dismiss`, `conversion`. Returns 204. Duplicate impressions for the same audit_id are ignored.

## GET /c/:audit_id

Click redirect. Logs a `click` event and responds 302 to the creative's destination URL (affiliate URLs are built here with the app owner's own affiliate identifiers). 404 if the audit record does not exist or has no creative.

## GET /v1/audit/:id

Returns the full audit record as described in docs/audit.md.

## GET /v1/verify/:id

Re-verifies the record and returns:

```json
{ "valid": true, "checks": [ { "name": "schema", "ok": true }, { "name": "record_hash", "ok": true }, { "name": "chain", "ok": true }, { "name": "signature", "ok": true, "detail": "key_id=k_2026_09" }, { "name": "creative_hash", "ok": true }, { "name": "disclosure_present", "ok": true }, { "name": "separation_attested", "ok": true } ] }
```

## GET /healthz

`{ "ok": true }`.

## GET /openapi.json

Generated from the Zod schemas.

## Error behavior

- `/v1/evaluate` never returns 5xx. Internal failures return `decision: "suppress"`, `reason: "error"`, and are logged with a request id.
- All other endpoints use standard 4xx/5xx codes with `{ "error": { "code": "...", "message": "..." } }`.
- Rate limits return 429 with a `Retry-After` header.

## Latency targets

`/v1/evaluate` p95 under 300 ms with a warm classifier cache, under 700 ms cold. Classifier LLM timeout 400 ms. Demand adapters 250 ms each, in parallel.
