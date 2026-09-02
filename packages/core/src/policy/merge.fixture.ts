import { parsePolicy, type PolicyConfig, type PolicyConfigInput } from '@adgate/schemas';

/** Test fixture: a stored policy with room to move in both directions on every field family. */
export const BASE_POLICY_INPUT: PolicyConfigInput = {
  app_id: 'app_base',
  serve_to_tiers: ['free', 'paid'],
  allow_paid_tiers: true,
  blocked_categories: ['self_harm', 'health'],
  sensitive_detection: 'balanced',
  min_commercial_intent: 0.5,
  min_confidence: 0.6,
  competitor_exclusions: ['rival.com'],
  frequency_caps: { per_session: 2, per_user_per_day: 5, min_turns_between: 3 },
  demand: [
    { source: 'direct' },
    { source: 'affiliate', network: 'partnerstack' },
    { source: 'affiliate', network: 'impact' },
    { source: 'koah', enabled: false },
  ],
  privacy: { store_raw_text: true, retain_days: 30 },
  regions: { allow: ['US', 'CA', 'DE'] },
};

export const basePolicy = (patch: Partial<PolicyConfigInput> = {}): PolicyConfig =>
  parsePolicy({ ...BASE_POLICY_INPUT, ...patch });
