/**
 * Test fixture (not exported from the package): the docs/policy.md "Full example with defaults"
 * block, copied verbatim, and the object it must produce. Keep both in sync by hand when the
 * contract doc changes (a human decision, CLAUDE.md).
 */

export const POLICY_DOC_YAML = `version: 1
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
`;

export const POLICY_DOC_EXAMPLE = {
  version: 1,
  app_id: 'my-chat-app',
  serve_to_tiers: ['free'],
  allow_paid_tiers: false,
  blocked_categories: [
    'health',
    'finance',
    'politics',
    'legal',
    'adult',
    'gambling',
    'weapons',
    'religion',
    'self_harm',
  ],
  sensitive_detection: 'strict',
  min_commercial_intent: 0.6,
  min_confidence: 0.7,
  competitor_exclusions: [],
  frequency_caps: { per_session: 1, per_user_per_day: 3, min_turns_between: 4 },
  disclosure: { label: 'Sponsored', position: 'after_answer', style: 'separate_block' },
  demand: [
    { source: 'direct', enabled: true },
    { source: 'affiliate', network: 'partnerstack', enabled: true },
    { source: 'koah', enabled: false },
    { source: 'gravity', enabled: false },
  ],
  privacy: { store_raw_text: false, retain_days: 90 },
  regions: { allow: ['US', 'CA', 'GB', 'EU'] },
};
