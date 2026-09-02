import { describe, expect, it } from 'vitest';

import { mergeOverrides } from './merge.js';
import { basePolicy } from './merge.fixture.js';

describe('mergeOverrides list fields', () => {
  describe('serve_to_tiers and allow_paid_tiers', () => {
    it('applies removing a tier', () => {
      const result = mergeOverrides(basePolicy(), { serve_to_tiers: ['free'] });
      expect(result.policy.serve_to_tiers).toEqual(['free']);
      expect(result.policy.allow_paid_tiers).toBe(true);
      expect(result.rejected).toEqual([]);
    });

    it('rejects adding a tier and still applies the removals in the same list', () => {
      const result = mergeOverrides(basePolicy(), { serve_to_tiers: ['free', 'enterprise'] });
      expect(result.policy.serve_to_tiers).toEqual(['free']);
      expect(result.rejected).toEqual([
        { path: 'serve_to_tiers', reason: 'cannot add tiers: enterprise' },
      ]);
    });

    it('serves nobody when the override lists only tiers the policy lacks', () => {
      const result = mergeOverrides(basePolicy(), { serve_to_tiers: ['enterprise', 'vip'] });
      expect(result.policy.serve_to_tiers).toEqual([]);
      expect(result.rejected).toEqual([
        { path: 'serve_to_tiers', reason: 'cannot add tiers: enterprise, vip' },
      ]);
    });

    it('applies allow_paid_tiers true -> false and drops the non-free tiers with it', () => {
      const result = mergeOverrides(basePolicy(), { allow_paid_tiers: false });
      expect(result.policy.allow_paid_tiers).toBe(false);
      expect(result.policy.serve_to_tiers).toEqual(['free']);
      expect(result.rejected).toEqual([]);
    });

    it('rejects allow_paid_tiers false -> true', () => {
      const policy = basePolicy({ serve_to_tiers: ['free'], allow_paid_tiers: false });
      const result = mergeOverrides(policy, {
        allow_paid_tiers: true,
        serve_to_tiers: ['free', 'paid'],
      });
      expect(result.policy.allow_paid_tiers).toBe(false);
      expect(result.policy.serve_to_tiers).toEqual(['free']);
      expect(result.rejected).toEqual([
        { path: 'serve_to_tiers', reason: 'cannot add tiers: paid' },
        { path: 'allow_paid_tiers', reason: 'cannot enable paid tiers' },
      ]);
    });
  });

  describe('regions.allow', () => {
    it('applies removing regions', () => {
      const result = mergeOverrides(basePolicy(), { regions: { allow: ['US'] } });
      expect(result.policy.regions.allow).toEqual(['US']);
      expect(result.rejected).toEqual([]);
    });

    it('rejects adding regions and still applies the removals', () => {
      const result = mergeOverrides(basePolicy(), { regions: { allow: ['DE', 'FR', 'EU'] } });
      expect(result.policy.regions.allow).toEqual(['DE']);
      expect(result.rejected).toEqual([
        { path: 'regions.allow', reason: 'cannot add regions: FR, EU' },
      ]);
    });

    it('ignores an empty regions object', () => {
      const policy = basePolicy();
      const result = mergeOverrides(policy, { regions: {} });
      expect(result.policy).toEqual(policy);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('blocked_categories', () => {
    it('adds categories in override order after the stored ones, without duplicates', () => {
      const result = mergeOverrides(basePolicy(), {
        blocked_categories: ['finance', 'health', 'adult', 'finance'],
      });
      expect(result.policy.blocked_categories).toEqual(['self_harm', 'health', 'finance', 'adult']);
      expect(result.rejected).toEqual([]);
    });

    it('never removes a stored category, so self_harm always survives', () => {
      const result = mergeOverrides(basePolicy(), { blocked_categories: ['gambling'] });
      expect(result.policy.blocked_categories).toEqual(['self_harm', 'health', 'gambling']);
      expect(result.rejected).toEqual([]);
      const empty = mergeOverrides(basePolicy(), { blocked_categories: [] });
      expect(empty.policy.blocked_categories).toEqual(['self_harm', 'health']);
    });
  });

  describe('competitor_exclusions', () => {
    it('adds domains without duplicates and never removes one', () => {
      const result = mergeOverrides(basePolicy(), {
        competitor_exclusions: ['other.com', 'rival.com', 'other.com'],
      });
      expect(result.policy.competitor_exclusions).toEqual(['rival.com', 'other.com']);
      expect(result.rejected).toEqual([]);
      expect(
        mergeOverrides(basePolicy(), { competitor_exclusions: [] }).policy.competitor_exclusions,
      ).toEqual(['rival.com']);
    });
  });
});
