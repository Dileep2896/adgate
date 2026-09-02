# adgate audit record

One record per `/v1/evaluate` call, including suppressions. Records for an app form a hash chain. Each record is signed with Ed25519.

```json
{
  "id": "aud_01J...",
  "app_id": "app_01J...",
  "conversation_id_hash": "sha256:...",
  "user_hash": "sha256:... or null",
  "turn_id": "turn_7",
  "ts": "2026-09-02T18:04:11Z",
  "surface": { "type": "chat", "placement": "after_answer" },
  "classification": {
    "commercial_intent": 0.84,
    "categories": ["software.devtools.database"],
    "sensitive": [],
    "confidence": 0.91,
    "method": "llm",
    "prompt_version": "sha256:..."
  },
  "policy_version": 1,
  "policy_hash": "sha256:...",
  "policy_decisions": [
    { "rule": "serve_to_tiers", "result": "pass" },
    { "rule": "regions", "result": "pass" },
    { "rule": "blocked_categories", "result": "pass" },
    { "rule": "min_confidence", "result": "pass" },
    { "rule": "min_commercial_intent", "result": "pass" },
    { "rule": "frequency_caps", "result": "pass", "detail": "session=0/1 day=1/3 turns_since=9" },
    { "rule": "competitor_exclusions", "result": "pending" }
  ],
  "decision": "serve",
  "reason": null,
  "demand": {
    "requested": ["direct", "affiliate"],
    "responses": [
      { "source": "direct", "candidates": 2, "latency_ms": 38 },
      { "source": "affiliate", "candidates": 0, "latency_ms": 61 }
    ],
    "excluded": [],
    "selected": "direct"
  },
  "creative": { "id": "cr_01J...", "advertiser": "Example DB Cloud", "advertiser_domain": "example.com", "content_hash": "sha256:..." },
  "disclosure": { "label": "Sponsored", "position": "after_answer", "style": "separate_block" },
  "model_output_hash": null,
  "separation_attestation": false,
  "attested_at": null,
  "supersedes_hash": null,
  "prev_hash": "sha256:...",
  "record_hash": "sha256:...",
  "signature": "ed25519:base64...",
  "key_id": "k_2026_09"
}
```

## Rules

- `conversation_id_hash` = sha256(app_salt + conversation_id). Raw conversation ids are never stored.
- Raw message text is never stored in the record. If `policy.privacy.store_raw_text` is true, text is stored in a separate table keyed by `audit_id`, not inside the signed record.
- `record_hash` = sha256(canonical JSON of the record with `record_hash` and `signature` removed, concatenated with `prev_hash`).
- Canonical JSON: keys sorted lexicographically at every level, no insignificant whitespace, UTF-8, numbers serialized in shortest round-trip form.
- `prev_hash` is the `record_hash` of the previous record for the same `app_id`, or the literal string `genesis` for the first record.
- `signature` = Ed25519 over `record_hash` with the private key identified by `key_id`.
- Attestation produces a NEW record that copies the original, sets `model_output_hash`, `separation_attestation: true`, `attested_at`, and `supersedes_hash` = the original `record_hash`, then re-hashes and re-signs. Both records remain in the chain and both verify.
- Key rotation: new `key_id`, old public keys remain available for verification forever.

## Verification checks (in order)

`schema`, `record_hash`, `chain` (prev_hash matches the previous record for the app), `signature`, `creative_hash` (content_hash matches the stored creative), `disclosure_present` (label non-empty, position after_answer), `separation_attested` (true only if attested), `supersedes` (if set, the superseded record exists and verifies).

A verification report for an advertiser is an aggregate over records referencing that advertiser's creatives: impressions, clicks, category distribution, sensitive exposures (must be zero), disclosure compliance percentage, separation attestation percentage, and chain integrity.
