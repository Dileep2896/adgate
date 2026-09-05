<!-- Generated from the OpenAPI document by `pnpm docs:api`. Do not edit by hand:
     packages/gateway/src/openapi/reference.test.ts compares this file with a fresh render. -->

# adgate gateway API reference

Neutral policy, verification and mediation gateway for ads inside AI chat and agents. docs/api.md is the contract; this document is generated from the Zod schemas that implement it. Every non-2xx body except /v1/evaluate is { error: { code, message } }.

**[docs/api.md](api.md) is the contract.** It is written by hand and changes only by a human
decision. This file is generated from the OpenAPI document the gateway serves at
`GET /openapi.json`, which is built from the Zod schemas in `packages/schemas`.
Where the two disagree, docs/api.md is right and the code is wrong.

|  |  |
| --- | --- |
| API version | `1` |
| OpenAPI | `3.1.0` |
| JSON Schema dialect | `https://json-schema.org/draft/2020-12/schema` |
| Licence | `Apache-2.0` |
| Regenerate | `pnpm docs:api` |

## Authentication

- `bearer` (http bearer): Authorization: Bearer <api_key>. Keys have a role: app (evaluate, attest, events, its own audit records) or advertiser_read (audit records naming its creatives).

## Endpoints

| Method | Path | Auth | Summary |
| --- | --- | --- | --- |
| POST | `/v1/evaluate` | Bearer API key | Decide whether a sponsored slot may be shown for this turn and which creative. |
| POST | `/v1/attest` | Bearer API key | Record the hash of the finished model output against an audit record. |
| POST | `/v1/events` | Bearer API key | Record an impression, click, dismiss or conversion for an audit record. |
| GET | `/c/{audit_id}` | public | Click redirect: log a click event and send the user to the creative's destination. |
| GET | `/v1/audit/{id}` | Bearer API key | The full signed audit record (docs/audit.md). |
| GET | `/v1/verify/{id}` | Bearer API key | Re-verify an audit record: schema, hash, chain, signature, creative, disclosure. |
| GET | `/healthz` | public | Liveness probe. |
| GET | `/openapi.json` | public | This document, generated from the Zod schemas. |

### POST /v1/evaluate

Decide whether a sponsored slot may be shown for this turn and which creative.

Always HTTP 200 once the body validates, even on internal errors (decision suppress, reason error). An audit_id is returned for every evaluation; creative.url points at the gateway click redirect, never at the advertiser. Requires an app key.

Auth: Bearer API key.

**Request body** (required): `EvaluateRequest`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `app_id` | `AppId` | yes | Identifier with the "app_" prefix. Pattern: `^app_.*`. |
| `conversation_id` | `string` | yes | App-side conversation id. Stored only as a salted hash. |
| `turn_id` | `string` | yes |  |
| `user` | `User` | yes | The end user of the app for this turn. |
| `messages` | `Message[]` | no | The last few turns, newest last. Required and non-empty unless context_summary is sent. |
| `context_summary` | `string` | no | Short summary sent instead of raw messages. Required unless messages is sent. |
| `surface` | `Surface` | yes | Where the sponsored slot would be rendered. |
| `policy_overrides` | `PolicyOverrides` | no | Partial PolicyConfig merged over the stored policy. May only make policy stricter. |

Additional constraints (`anyOf`), which the property table cannot express:

```json
[
  {
    "properties": {
      "messages": {
        "minItems": 1
      }
    },
    "required": [
      "messages"
    ]
  },
  {
    "required": [
      "context_summary"
    ]
  }
]
```

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `200` | The decision. | `EvaluateResponse` | `X-RateLimit-Remaining` |
| `400` | invalid_request: the body is not JSON or not an EvaluateRequest. | `ErrorResponse` | — |
| `401` | unauthorized: missing, malformed, unknown or revoked API key. | `ErrorResponse` | `WWW-Authenticate` |
| `403` | forbidden: app_id is not the key's app, or the key role is not app. | `ErrorResponse` | — |
| `413` | payload_too_large: the body exceeds 262144 bytes. | `ErrorResponse` | — |
| `429` | rate_limited: the API key emptied its token bucket. | `ErrorResponse` | `Retry-After`, `X-RateLimit-Remaining` |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### POST /v1/attest

Record the hash of the finished model output against an audit record.

Called by the SDK after the answer is complete. The record is re-hashed and re-signed as a new version with separation_attestation true, chained to the previous version.

Auth: Bearer API key.

**Request body** (required): `AttestRequest`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `audit_id` | `AuditId` | yes | Identifier with the "aud_" prefix. Pattern: `^aud_.*`. |
| `model_output_hash` | `Sha256Hash` | yes | sha256 of the complete model answer. Pattern: `^sha256:[0-9a-f]{64}$`. |
| `rendered` | `boolean` | yes | Whether the sponsored block was actually rendered. |

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `204` | Attested. | no body | — |
| `400` | invalid_request: the body is not JSON or not an AttestRequest. | `ErrorResponse` | — |
| `401` | unauthorized: missing, malformed, unknown or revoked API key. | `ErrorResponse` | `WWW-Authenticate` |
| `404` | not_found: no record with that audit_id belongs to the key's app. | `ErrorResponse` | — |
| `409` | already_attested: the latest version already carries an attestation. | `ErrorResponse` | — |
| `429` | rate_limited: the API key emptied its token bucket. | `ErrorResponse` | `Retry-After`, `X-RateLimit-Remaining` |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### POST /v1/events

Record an impression, click, dismiss or conversion for an audit record.

Duplicate impressions for the same audit_id are ignored (still 204).

Auth: Bearer API key.

**Request body** (required): `EventRequest`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `audit_id` | `AuditId` | yes | Identifier with the "aud_" prefix. Pattern: `^aud_.*`. |
| `type` | `EventType` | yes | One of: `impression`, `click`, `dismiss`, `conversion`. |
| `ts` | `IsoTimestamp` | yes | ISO 8601 timestamp in UTC, e.g. 2026-09-02T18:04:11Z. Format: date-time. |
| `meta` | `object` | no |  |

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `204` | Recorded (or a duplicate impression, ignored). | no body | — |
| `400` | invalid_request: not an EventRequest, or meta over 4096 bytes serialized. | `ErrorResponse` | — |
| `401` | unauthorized: missing, malformed, unknown or revoked API key. | `ErrorResponse` | `WWW-Authenticate` |
| `403` | forbidden: the audit_id belongs to another app. | `ErrorResponse` | — |
| `404` | not_found: no record has that audit_id. | `ErrorResponse` | — |
| `429` | rate_limited: the API key emptied its token bucket. | `ErrorResponse` | `Retry-After`, `X-RateLimit-Remaining` |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### GET /c/{audit_id}

Click redirect: log a click event and send the user to the creative's destination.

Public (the audit id is the capability). Affiliate links are built here with the app owner's own identifiers.

Auth: public.

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `audit_id` | path | yes | `AuditId` | The audit_id returned by POST /v1/evaluate. |

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `302` | Redirect to the destination. | no body | `Location`, `Cache-Control`, `Referrer-Policy` |
| `404` | not_found: unknown audit id, no creative, or no http(s) destination. | `ErrorResponse` | — |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### GET /v1/audit/{id}

The full signed audit record (docs/audit.md).

An app key reads its own app's records; an advertiser_read key reads records naming its creatives. Anything else is 404.

Auth: Bearer API key.

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | yes | `AuditId` | The audit_id returned by POST /v1/evaluate. |
| `version` | query | no | `Sha256Hash` | record_hash of a specific stored version (an attested record has two). Default: the latest. |

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `200` | The stored record, exactly as signed. | `AuditRecord` | `X-Adgate-Record-Hash` |
| `401` | unauthorized: missing, malformed, unknown or revoked API key. | `ErrorResponse` | `WWW-Authenticate` |
| `404` | not_found: unknown id or version, or not visible to this key. | `ErrorResponse` | — |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### GET /v1/verify/{id}

Re-verify an audit record: schema, hash, chain, signature, creative, disclosure.

Auth: Bearer API key.

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | yes | `AuditId` | The audit_id returned by POST /v1/evaluate. |
| `version` | query | no | `Sha256Hash` | record_hash of a specific stored version (an attested record has two). Default: the latest. |

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `200` | The verdict and every check, whatever the outcome. | `VerifyResponse` | `X-Adgate-Record-Hash` |
| `401` | unauthorized: missing, malformed, unknown or revoked API key. | `ErrorResponse` | `WWW-Authenticate` |
| `404` | not_found: unknown id or version, or not visible to this key. | `ErrorResponse` | — |
| `default` | Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1). | `ErrorResponse` | — |

### GET /healthz

Liveness probe.

Auth: public.

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `200` | Alive. | `HealthResponse` | — |

### GET /openapi.json

This document, generated from the Zod schemas.

Auth: public.

**Responses**

| Status | Meaning | Body | Headers |
| --- | --- | --- | --- |
| `200` | The OpenAPI 3.1 document. | `object` | `Cache-Control` |

## Schemas

Every schema below is a component of `GET /openapi.json` and is also written to
`packages/schemas/json/<Name>.schema.json` (JSON Schema 2020-12).

| Name | Description |
| --- | --- |
| `EvaluateRequest` | Body of POST /v1/evaluate. |
| `EvaluateResponse` | Body of POST /v1/evaluate. Always HTTP 200; internal failures suppress with reason error. |
| `AuditRecord` | A signed audit record (docs/audit.md): one per /v1/evaluate call, chained per app through prev_hash. Body of GET /v1/audit/:id. |
| `PolicyConfig` | An app policy (docs/policy.md). Omitted fields take the documented defaults; unknown keys are rejected. |
| `PolicyOverrides` | Deep-partial PolicyConfig sent as EvaluateRequest.policy_overrides. Only values that make the stored policy stricter are applied; the rest are ignored and recorded as override_rejected. |
| `AffiliateConfig` | Per-app affiliate identifiers, one optional entry per AffiliateNetwork. The app owner brings their own accounts; a network without an entry yields no affiliate candidates. |
| `AffiliateNetwork` | Affiliate network used by an affiliate demand entry. |
| `KoahConfig` | The app owner's Koah settings. Until partner API access exists the adapter answers not_implemented even when enabled with both credentials (docs/decisions.md item 10). |
| `GravityConfig` | The app owner's Gravity settings. Until partner API access exists the adapter answers not_implemented even when enabled with both credentials (docs/decisions.md item 10). |
| `PublicKeysJson` | Shape of ADGATE_PUBLIC_KEYS_JSON: key_id -> SPKI PEM public key, including every retired key (old public keys remain available for verification forever). |
| `PublicKeyPem` | An Ed25519 public key as an SPKI PEM string (-----BEGIN PUBLIC KEY-----). |
| `KeyId` | Identifier of the Ed25519 key pair that signed a record, e.g. k_2026_09. |
| `Ed25519Signature` | An Ed25519 signature written as ed25519:<base64>, over the UTF-8 bytes of the record_hash string. |
| `PolicyDecision` | One entry of an audit record policy_decisions list: the outcome of one rule. Every rule records an entry, pass or fail. |
| `PolicyRule` | A docs/policy.md rule name, listed in the order the rules run. |
| `CapState` | Frequency-cap counters the gateway reads before evaluating policy. The policy engine is pure and receives them as input. |
| `Classification` | What the classifier concluded about the conversation turn. Never contains message text. |
| `Creative` | A sponsored creative to render in a separate labeled block after the answer. |
| `CatalogCreative` | A creative as stored in the catalog (creatives table, dashboard, seed file plus id). |
| `SeedCreative` | A catalog creative before an id is assigned: the shape of examples/creatives.seed.json entries. |
| `TargetCategory` | A content category such as software.devtools.database, or a trailing-wildcard pattern such as software.devtools.* that matches every deeper category. |
| `DemandRequest` | What the gateway hands every demand adapter for one evaluation. |
| `DemandResponse` | One demand adapter’s answer; summarized into the audit record demand block. |
| `Candidate` | A catalog creative an adapter proposes for this turn, with its scores. |
| `DemandTrace` | The demand block of an audit record: the mediation trace for one evaluation (docs/audit.md). |
| `DemandResponseSummary` | One entry of an audit record demand.responses list: a demand adapter answer with the candidates reduced to a count. error is set when the adapter failed, timed out or was aborted. |
| `ExcludedCandidate` | One entry of an audit record demand.excluded list: a candidate mediation dropped before ranking. This resolves the pending competitor_exclusions policy decision. |
| `SuppressReason` | Why no ad was served: paid_user, region_blocked, sensitive_category:<name> (name from the sensitive taxonomy), low_confidence, low_commercial_intent, frequency_cap, no_fill, or error. |
| `AttestRequest` | Body of POST /v1/attest, sent after the model answer is complete. Returns 204. |
| `EventRequest` | Body of POST /v1/events. Returns 204. Duplicate impressions for the same audit_id are ignored. |
| `VerifyResponse` | Body of GET /v1/verify/:id. |
| `VerifyCheck` | Result of one verification check. |
| `VerifyCheckName` |  |
| `Message` | One conversation turn. Servers truncate to the last 4 messages and 4,000 characters before classification, and reject a single message over 32,768 characters. |
| `MessageRole` |  |
| `User` | The end user of the app for this turn. |
| `Surface` | Where the sponsored slot would be rendered. |
| `SurfaceType` |  |
| `Decision` |  |
| `DemandSource` | Demand source that supplied a creative (see docs/policy.md demand list). |
| `ClassificationMethod` | llm when the LLM classifier answered in time, rules when only the rule stage ran, cached when a recent classification of the same text was reused. |
| `EventType` |  |
| `SensitiveCategory` | A sensitive topic that blocks ads. Matches fixtures/classify-fixtures.json. |
| `ContentCategory` | A commercial content category. Matches fixtures/classify-fixtures.json. |
| `AppId` | Identifier with the "app_" prefix. |
| `AuditId` | Identifier with the "aud_" prefix. |
| `CreativeId` | Identifier with the "cr_" prefix. |
| `Sha256Hash` | A SHA-256 digest written as sha256:<64 lowercase hex digits>. |
| `IsoTimestamp` | ISO 8601 timestamp in UTC, e.g. 2026-09-02T18:04:11Z. |
| `ErrorResponse` | Body of every 4xx/5xx response from endpoints other than /v1/evaluate. |
| `HealthResponse` | Body of GET /healthz. |
