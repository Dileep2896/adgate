import { describe, expect, it } from 'vitest';

import { DemandEntryOverride, OverrideRejection, PolicyOverrides } from './policy-overrides.js';

describe('PolicyOverrides', () => {
  it('accepts an empty object and leaves it empty', () => {
    expect(PolicyOverrides.parse({})).toEqual({});
  });

  it('is a deep partial: nested objects may be partial too', () => {
    const overrides = {
      blocked_categories: ['health'],
      frequency_caps: { per_session: 0 },
      privacy: { store_raw_text: false },
      regions: { allow: ['US'] },
      demand: [{ source: 'koah', enabled: false }],
    };
    expect(PolicyOverrides.parse(overrides)).toEqual(overrides);
  });

  it('never back-fills defaults', () => {
    expect(PolicyOverrides.parse({ frequency_caps: {} })).toEqual({ frequency_caps: {} });
    expect(PolicyOverrides.parse({ demand: [{ source: 'direct' }] })).toEqual({
      demand: [{ source: 'direct' }],
    });
  });

  it('rejects unknown keys at every level', () => {
    expect(PolicyOverrides.safeParse({ min_intent: 0.9 }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ frequency_caps: { per_day: 1 } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ disclosure: { colour: 'red' } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ privacy: { pii: false } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ regions: { deny: ['RU'] } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ demand: [{ source: 'direct', weight: 1 }] }).success).toBe(
      false,
    );
  });

  it('validates leaf values with the same rules as PolicyConfig', () => {
    expect(PolicyOverrides.safeParse({ min_confidence: 1.5 }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ frequency_caps: { per_session: -1 } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ regions: { allow: ['usa'] } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ blocked_categories: ['spam'] }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ disclosure: { label: '' } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ privacy: { retain_days: 0 } }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ version: 2 }).success).toBe(false);
    expect(PolicyOverrides.safeParse({ allow_paid_tiers: 'yes' }).success).toBe(false);
  });

  it('does not apply the cross-field policy rules (the merge keeps the stored policy valid)', () => {
    expect(PolicyOverrides.safeParse({ blocked_categories: ['health'] }).success).toBe(true);
    expect(PolicyOverrides.safeParse({ serve_to_tiers: ['paid'] }).success).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(PolicyOverrides.safeParse(null).success).toBe(false);
    expect(PolicyOverrides.safeParse([]).success).toBe(false);
    expect(PolicyOverrides.safeParse('strict').success).toBe(false);
  });
});

describe('DemandEntryOverride', () => {
  it('makes the affiliate network optional so one entry can target every affiliate', () => {
    expect(DemandEntryOverride.parse({ source: 'affiliate', enabled: false })).toEqual({
      source: 'affiliate',
      enabled: false,
    });
    expect(DemandEntryOverride.safeParse({ source: 'affiliate', network: 'cj' }).success).toBe(
      false,
    );
  });

  it('still rejects unknown sources', () => {
    expect(DemandEntryOverride.safeParse({ source: 'adsense', enabled: false }).success).toBe(
      false,
    );
  });
});

describe('OverrideRejection', () => {
  it('requires a non-empty path and reason', () => {
    expect(OverrideRejection.parse({ path: 'min_confidence', reason: 'lower' })).toEqual({
      path: 'min_confidence',
      reason: 'lower',
    });
    expect(OverrideRejection.safeParse({ path: '', reason: 'lower' }).success).toBe(false);
    expect(OverrideRejection.safeParse({ path: 'x', reason: '' }).success).toBe(false);
    expect(OverrideRejection.safeParse({ path: 'x', reason: 'y', extra: 1 }).success).toBe(false);
  });
});
