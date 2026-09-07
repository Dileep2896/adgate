import { OverrideRejection, PolicyConfig, type PolicyOverrides } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { mergeOverrides } from './merge.js';
import { basePolicy } from './merge.fixture.js';

const paths = (rejected: OverrideRejection[]) => rejected.map((entry) => entry.path);

describe('mergeOverrides', () => {
  it('returns an equal copy and no rejections for empty overrides', () => {
    const policy = basePolicy();
    const result = mergeOverrides(policy, {});
    expect(result.policy).toEqual(policy);
    expect(result.policy).not.toBe(policy);
    expect(result.rejected).toEqual([]);
  });

  it('never mutates its inputs', () => {
    const policy = basePolicy();
    const overrides: PolicyOverrides = {
      frequency_caps: { per_session: 0 },
      demand: [{ source: 'direct', enabled: false }],
      blocked_categories: ['finance'],
    };
    const policySnapshot = structuredClone(policy);
    const overridesSnapshot = structuredClone(overrides);
    mergeOverrides(policy, overrides);
    expect(policy).toEqual(policySnapshot);
    expect(overrides).toEqual(overridesSnapshot);
  });

  it('treats values equal to the stored policy as silent no-ops', () => {
    const policy = basePolicy();
    const result = mergeOverrides(policy, {
      version: 1,
      app_id: 'app_base',
      sensitive_detection: 'balanced',
      min_confidence: 0.6,
      frequency_caps: { per_session: 2, min_turns_between: 3 },
      disclosure: { label: 'Sponsored', position: 'after_answer', style: 'separate_block' },
      privacy: { store_raw_text: true, retain_days: 30 },
      demand: [{ source: 'direct' }, { source: 'koah', enabled: false }],
    });
    expect(result.policy).toEqual(policy);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a different app_id', () => {
    const result = mergeOverrides(basePolicy(), { app_id: 'app_other' });
    expect(result.policy.app_id).toBe('app_base');
    expect(result.rejected).toEqual([{ path: 'app_id', reason: 'app_id cannot be overridden' }]);
  });

  describe('sensitive_detection', () => {
    it('applies balanced -> strict', () => {
      const result = mergeOverrides(basePolicy(), { sensitive_detection: 'strict' });
      expect(result.policy.sensitive_detection).toBe('strict');
      expect(result.rejected).toEqual([]);
    });

    it('rejects strict -> balanced', () => {
      const policy = basePolicy({ sensitive_detection: 'strict' });
      const result = mergeOverrides(policy, { sensitive_detection: 'balanced' });
      expect(result.policy.sensitive_detection).toBe('strict');
      expect(paths(result.rejected)).toEqual(['sensitive_detection']);
    });
  });

  describe('thresholds', () => {
    it('applies raises', () => {
      const result = mergeOverrides(basePolicy(), {
        min_commercial_intent: 0.9,
        min_confidence: 0.95,
      });
      expect(result.policy.min_commercial_intent).toBe(0.9);
      expect(result.policy.min_confidence).toBe(0.95);
      expect(result.rejected).toEqual([]);
    });

    it('rejects lowering', () => {
      const result = mergeOverrides(basePolicy(), {
        min_commercial_intent: 0.1,
        min_confidence: 0.5,
      });
      expect(result.policy.min_commercial_intent).toBe(0.5);
      expect(result.policy.min_confidence).toBe(0.6);
      expect(result.rejected).toEqual([
        {
          path: 'min_commercial_intent',
          reason: 'cannot lower min_commercial_intent from 0.5 to 0.1',
        },
        { path: 'min_confidence', reason: 'cannot lower min_confidence from 0.6 to 0.5' },
      ]);
    });
  });

  describe('frequency_caps', () => {
    it('applies lower per_session and per_user_per_day and a higher min_turns_between', () => {
      const result = mergeOverrides(basePolicy(), {
        frequency_caps: { per_session: 0, per_user_per_day: 1, min_turns_between: 10 },
      });
      expect(result.policy.frequency_caps).toEqual({
        per_session: 0,
        per_user_per_day: 1,
        min_turns_between: 10,
      });
      expect(result.rejected).toEqual([]);
    });

    it('rejects higher per_session and per_user_per_day and a lower min_turns_between', () => {
      const result = mergeOverrides(basePolicy(), {
        frequency_caps: { per_session: 3, per_user_per_day: 6, min_turns_between: 0 },
      });
      expect(result.policy.frequency_caps).toEqual({
        per_session: 2,
        per_user_per_day: 5,
        min_turns_between: 3,
      });
      expect(result.rejected).toEqual([
        {
          path: 'frequency_caps.per_session',
          reason: 'cannot raise frequency_caps.per_session from 2 to 3',
        },
        {
          path: 'frequency_caps.per_user_per_day',
          reason: 'cannot raise frequency_caps.per_user_per_day from 5 to 6',
        },
        {
          path: 'frequency_caps.min_turns_between',
          reason: 'cannot lower frequency_caps.min_turns_between from 3 to 0',
        },
      ]);
    });

    it('leaves caps that are not mentioned untouched', () => {
      const result = mergeOverrides(basePolicy(), { frequency_caps: { per_session: 1 } });
      expect(result.policy.frequency_caps).toEqual({
        per_session: 1,
        per_user_per_day: 5,
        min_turns_between: 3,
      });
    });
  });

  describe('disclosure', () => {
    it('rejects any change to the label', () => {
      const result = mergeOverrides(basePolicy(), { disclosure: { label: 'Answer' } });
      expect(result.policy.disclosure.label).toBe('Sponsored');
      expect(result.rejected).toEqual([
        { path: 'disclosure.label', reason: 'disclosure cannot be overridden per request' },
      ]);
    });
  });

  describe('demand', () => {
    it('disables a stored source', () => {
      const result = mergeOverrides(basePolicy(), {
        demand: [{ source: 'direct', enabled: false }],
      });
      expect(result.policy.demand[0]).toEqual({ source: 'direct', enabled: false });
      expect(result.rejected).toEqual([]);
    });

    it('disables every affiliate entry when no network is given, or just one when it is', () => {
      const all = mergeOverrides(basePolicy(), {
        demand: [{ source: 'affiliate', enabled: false }],
      });
      expect(all.policy.demand.map((entry) => entry.enabled)).toEqual([true, false, false, false]);
      const one = mergeOverrides(basePolicy(), {
        demand: [{ source: 'affiliate', network: 'impact', enabled: false }],
      });
      expect(one.policy.demand.map((entry) => entry.enabled)).toEqual([true, true, false, false]);
      expect(all.rejected).toEqual([]);
      expect(one.rejected).toEqual([]);
    });

    it('rejects enabling a disabled source', () => {
      const result = mergeOverrides(basePolicy(), { demand: [{ source: 'koah', enabled: true }] });
      expect(result.policy.demand[3]).toEqual({ source: 'koah', enabled: false });
      expect(result.rejected).toEqual([
        { path: 'demand[0]', reason: 'cannot enable demand source koah' },
      ]);
    });

    it('rejects sources the stored policy does not list', () => {
      const result = mergeOverrides(basePolicy(), {
        demand: [
          { source: 'direct', enabled: false },
          { source: 'gravity', enabled: false },
          { source: 'affiliate', network: 'amazon', enabled: false },
        ],
      });
      expect(result.policy.demand[0]?.enabled).toBe(false);
      expect(result.rejected).toEqual([
        { path: 'demand[1]', reason: 'cannot add demand source gravity' },
        { path: 'demand[2]', reason: 'cannot add demand source affiliate/amazon' },
      ]);
    });
  });

  describe('privacy', () => {
    it('applies store_raw_text true -> false', () => {
      const result = mergeOverrides(basePolicy(), { privacy: { store_raw_text: false } });
      expect(result.policy.privacy).toEqual({ store_raw_text: false, retain_days: 30 });
      expect(result.rejected).toEqual([]);
    });

    it('rejects store_raw_text false -> true', () => {
      const policy = basePolicy({ privacy: { store_raw_text: false } });
      const result = mergeOverrides(policy, { privacy: { store_raw_text: true } });
      expect(result.policy.privacy.store_raw_text).toBe(false);
      expect(paths(result.rejected)).toEqual(['privacy.store_raw_text']);
    });

    it('rejects any change to retain_days', () => {
      for (const retain_days of [7, 365]) {
        const result = mergeOverrides(basePolicy(), { privacy: { retain_days } });
        expect(result.policy.privacy.retain_days).toBe(30);
        expect(paths(result.rejected)).toEqual(['privacy.retain_days']);
      }
    });
  });

  it('yields a valid PolicyConfig and valid rejections for a mixed override', () => {
    const result = mergeOverrides(basePolicy(), {
      serve_to_tiers: ['free', 'enterprise'],
      allow_paid_tiers: false,
      blocked_categories: ['finance'],
      sensitive_detection: 'strict',
      min_confidence: 0.2,
      frequency_caps: { per_session: 1, min_turns_between: 1 },
      demand: [{ source: 'koah', enabled: true }],
      privacy: { store_raw_text: false },
      regions: { allow: ['US', 'FR'] },
    });
    expect(PolicyConfig.safeParse(result.policy).success).toBe(true);
    for (const rejection of result.rejected) {
      expect(OverrideRejection.safeParse(rejection).success).toBe(true);
    }
    expect(paths(result.rejected)).toEqual([
      'serve_to_tiers',
      'min_confidence',
      'frequency_caps.min_turns_between',
      'demand[0]',
      'regions.allow',
    ]);
    expect(result.policy).toMatchObject({
      serve_to_tiers: ['free'],
      allow_paid_tiers: false,
      blocked_categories: ['self_harm', 'health', 'finance'],
      sensitive_detection: 'strict',
      min_confidence: 0.6,
      frequency_caps: { per_session: 1, per_user_per_day: 5, min_turns_between: 3 },
      privacy: { store_raw_text: false, retain_days: 30 },
      regions: { allow: ['US'] },
    });
  });
});
