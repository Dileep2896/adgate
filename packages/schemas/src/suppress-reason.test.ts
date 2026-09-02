import { describe, expect, it } from 'vitest';

import {
  FIXED_SUPPRESS_REASONS,
  SENSITIVE_CATEGORY_REASONS,
  SUPPRESS_REASONS,
  SuppressReason,
  sensitiveCategoryReason,
} from './suppress-reason.js';
import { SENSITIVE_TAXONOMY } from './taxonomy.js';

describe('SuppressReason', () => {
  it('accepts exactly the fixed reasons from docs/api.md', () => {
    expect([...FIXED_SUPPRESS_REASONS]).toEqual([
      'paid_user',
      'region_blocked',
      'low_confidence',
      'low_commercial_intent',
      'frequency_cap',
      'no_fill',
      'error',
    ]);
    for (const reason of FIXED_SUPPRESS_REASONS) {
      expect(SuppressReason.safeParse(reason).success).toBe(true);
    }
  });

  it('accepts sensitive_category:<name> for every entry of the sensitive taxonomy', () => {
    expect(SENSITIVE_CATEGORY_REASONS).toHaveLength(SENSITIVE_TAXONOMY.length);
    for (const name of SENSITIVE_TAXONOMY) {
      expect(SuppressReason.safeParse(`sensitive_category:${name}`).success).toBe(true);
    }
  });

  it('rejects sensitive_category with a name outside the taxonomy', () => {
    expect(SuppressReason.safeParse('sensitive_category:unknown').success).toBe(false);
    expect(SuppressReason.safeParse('sensitive_category:').success).toBe(false);
    expect(SuppressReason.safeParse('sensitive_category:Health').success).toBe(false);
    expect(SuppressReason.safeParse('sensitive_category:health ').success).toBe(false);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'serve', 'suppress', 'health', 'paid', 'error ', null, 0]) {
      expect(SuppressReason.safeParse(value).success).toBe(false);
    }
  });

  it('SUPPRESS_REASONS lists the fixed reasons then the sensitive ones with no duplicates', () => {
    expect(SUPPRESS_REASONS).toEqual([...FIXED_SUPPRESS_REASONS, ...SENSITIVE_CATEGORY_REASONS]);
    expect(new Set(SUPPRESS_REASONS).size).toBe(SUPPRESS_REASONS.length);
  });

  it('sensitiveCategoryReason builds a valid reason', () => {
    const reason = sensitiveCategoryReason('health');
    expect(reason).toBe('sensitive_category:health');
    expect(SuppressReason.parse(reason)).toBe(reason);
  });
});
