# adgate policy as code

Each app has one stored policy (YAML). Requests may pass `policy_overrides` that only make it stricter.

## Full example with defaults

```yaml
version: 1
app_id: my-chat-app
serve_to_tiers: [free]           # default [free]. Any other tier is suppressed with reason paid_user.
allow_paid_tiers: false          # must be explicitly true to include non-free tiers in serve_to_tiers. Logs a warning when true.
blocked_categories:              # default is exactly this list
  - health
  - finance
  - politics
  - legal
  - adult
  - gambling
  - weapons
  - religion
  - self_harm                    # cannot be removed. Always blocked.
sensitive_detection: strict      # strict | balanced. strict suppresses on any sensitive signal from rules OR LLM.
min_commercial_intent: 0.6       # 0..1
min_confidence: 0.7              # 0..1
competitor_exclusions: []        # advertiser domains that must never be shown, e.g. [competitor.com]
frequency_caps:
  per_session: 1                 # per conversation
  per_user_per_day: 3            # requires user.user_hash; if absent, per_session applies only
  min_turns_between: 4
disclosure:
  label: "Sponsored"             # must be non-empty
  position: after_answer         # only value in v1
  style: separate_block          # only value in v1
demand:                          # ordered list; only enabled sources are queried
  - source: direct
  - source: affiliate
    network: partnerstack        # partnerstack | impact | amazon
    enabled: true
  - source: koah
    enabled: false
  - source: gravity
    enabled: false
privacy:
  store_raw_text: false          # when false, only hashes and classification are persisted
  retain_days: 90
regions:
  allow: [US, CA, GB, EU]        # ISO 3166 alpha-2 plus the token EU
```

## Rule order

Rules run in this exact order. The first failing rule sets the suppress reason. Every rule still records a decision entry in the audit record, pass or fail.

1. `serve_to_tiers` (reason `paid_user`)
2. `regions` (reason `region_blocked`)
3. `blocked_categories` against both `classification.sensitive` and `classification.categories` (reason `sensitive_category:<name>`)
4. `min_confidence` (reason `low_confidence`)
5. `min_commercial_intent` (reason `low_commercial_intent`)
6. `frequency_caps` (reason `frequency_cap`)
7. `competitor_exclusions` (applied during creative selection; recorded here as `pending` then resolved in the demand trace)

## Validation rules

- Unknown keys are rejected.
- `self_harm` cannot be removed from `blocked_categories`.
- `allow_paid_tiers` must be a boolean if present; `serve_to_tiers` containing anything other than `free` requires `allow_paid_tiers: true`.
- `policy_hash` is sha256 over canonical JSON (sorted keys, no whitespace) of the fully defaulted policy, so equivalent YAML files produce the same hash.

## Overrides

`policy_overrides` in a request are merged with these constraints: may add blocked categories, may lower caps, may raise thresholds, may add competitor exclusions, may disable demand sources. Anything that loosens policy is ignored and noted in the audit record as `override_rejected`.
