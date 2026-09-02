import { describe, expect, it } from 'vitest';

import { CONTRACT_SCHEMAS } from './json-schema.js';
import {
  CapState,
  POLICY_RULES,
  PolicyDecision,
  PolicyDecisionResult,
  PolicyRule,
} from './policy-decision.js';

describe('POLICY_RULES', () => {
  it('lists the seven docs/policy.md rules in documented order', () => {
    expect(POLICY_RULES).toEqual([
      'serve_to_tiers',
      'regions',
      'blocked_categories',
      'min_confidence',
      'min_commercial_intent',
      'frequency_caps',
      'competitor_exclusions',
    ]);
    expect(PolicyRule.options).toEqual([...POLICY_RULES]);
  });
});

describe('PolicyDecision', () => {
  it('accepts every docs/audit.md policy_decisions entry', () => {
    const entries = [
      { rule: 'serve_to_tiers', result: 'pass' },
      { rule: 'regions', result: 'pass' },
      { rule: 'blocked_categories', result: 'pass' },
      { rule: 'min_confidence', result: 'pass' },
      { rule: 'min_commercial_intent', result: 'pass' },
      { rule: 'frequency_caps', result: 'pass', detail: 'session=0/1 day=1/3 turns_since=9' },
      { rule: 'competitor_exclusions', result: 'pending' },
    ];
    for (const entry of entries) {
      expect(PolicyDecision.parse(entry)).toEqual(entry);
    }
  });

  it('accepts fail with a detail', () => {
    const entry = { rule: 'regions', result: 'fail', detail: 'region missing' };
    expect(PolicyDecision.parse(entry)).toEqual(entry);
  });

  it('rejects unknown rules, unknown results and an empty detail', () => {
    expect(PolicyDecision.safeParse({ rule: 'disclosure', result: 'pass' }).success).toBe(false);
    expect(PolicyDecision.safeParse({ rule: 'regions', result: 'skipped' }).success).toBe(false);
    expect(PolicyDecision.safeParse({ rule: 'regions', result: 'pass', detail: '' }).success).toBe(
      false,
    );
    expect(PolicyDecisionResult.options).toEqual(['pass', 'fail', 'pending']);
  });
});

describe('CapState', () => {
  it('accepts counts with a null turns_since_last (no ad served yet)', () => {
    const fresh = { session_count: 0, day_count: 0, turns_since_last: null };
    expect(CapState.parse(fresh)).toEqual(fresh);
    const served = { session_count: 1, day_count: 2, turns_since_last: 9 };
    expect(CapState.parse(served)).toEqual(served);
  });

  it('rejects negative, fractional or missing counts', () => {
    expect(
      CapState.safeParse({ session_count: -1, day_count: 0, turns_since_last: null }).success,
    ).toBe(false);
    expect(
      CapState.safeParse({ session_count: 0, day_count: 1.5, turns_since_last: null }).success,
    ).toBe(false);
    expect(
      CapState.safeParse({ session_count: 0, day_count: 0, turns_since_last: -3 }).success,
    ).toBe(false);
    expect(CapState.safeParse({ session_count: 0, day_count: 0 }).success).toBe(false);
  });
});

describe('contract registration', () => {
  it('registers PolicyDecision, PolicyRule and CapState so S14 audit records can reuse them', () => {
    expect(CONTRACT_SCHEMAS.PolicyDecision).toBe(PolicyDecision);
    expect(CONTRACT_SCHEMAS.PolicyRule).toBe(PolicyRule);
    expect(CONTRACT_SCHEMAS.CapState).toBe(CapState);
  });
});
