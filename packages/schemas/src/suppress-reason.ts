import { z } from 'zod';

import { SENSITIVE_TAXONOMY, type SensitiveCategory } from './taxonomy.js';

/** Reasons that are not tied to a sensitive category. */
export const FIXED_SUPPRESS_REASONS = [
  'paid_user',
  'region_blocked',
  'low_confidence',
  'low_commercial_intent',
  'frequency_cap',
  'no_fill',
  'error',
] as const;

export const SENSITIVE_CATEGORY_REASON_PREFIX = 'sensitive_category:' as const;

/** Builds the `sensitive_category:<name>` reason for a taxonomy entry, typed exactly. */
export const sensitiveCategoryReason = <N extends SensitiveCategory>(
  name: N,
): `${typeof SENSITIVE_CATEGORY_REASON_PREFIX}${N}` => `${SENSITIVE_CATEGORY_REASON_PREFIX}${name}`;

export const SENSITIVE_CATEGORY_REASONS = SENSITIVE_TAXONOMY.map((name) =>
  sensitiveCategoryReason(name),
);

/** Every suppress reason the API may return, in docs/api.md order. */
export const SUPPRESS_REASONS = [...FIXED_SUPPRESS_REASONS, ...SENSITIVE_CATEGORY_REASONS];

export const SuppressReason = z.enum(SUPPRESS_REASONS).meta({
  title: 'SuppressReason',
  description:
    'Why no ad was served: paid_user, region_blocked, sensitive_category:<name> (name from the sensitive taxonomy), low_confidence, low_commercial_intent, frequency_cap, no_fill, or error.',
});
export type SuppressReason = z.infer<typeof SuppressReason>;
