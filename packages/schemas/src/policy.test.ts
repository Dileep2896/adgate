import { describe, expect, it } from 'vitest';

import { DemandSource } from './creative.js';
import { DemandEntry, PolicyConfig } from './policy.js';
import { POLICY_DOC_EXAMPLE } from './policy.fixture.js';
import { SENSITIVE_TAXONOMY } from './taxonomy.js';

const base = { app_id: 'my-chat-app' };
const issuesOf = (input: unknown) =>
  PolicyConfig.safeParse(input).error?.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })) ?? [];

describe('PolicyConfig defaults', () => {
  it('returns fresh default objects on every parse', () => {
    const first = PolicyConfig.parse(base);
    const second = PolicyConfig.parse(base);
    expect(first).toEqual(second);
    expect(first.frequency_caps).not.toBe(second.frequency_caps);
    expect(first.demand).not.toBe(second.demand);
    expect(first.blocked_categories).not.toBe(second.blocked_categories);
  });

  it('fills nested defaults inside partial nested objects', () => {
    const policy = PolicyConfig.parse({
      ...base,
      frequency_caps: { per_session: 0 },
      privacy: { store_raw_text: true },
      disclosure: { label: 'Ad' },
      regions: {},
    });
    expect(policy.frequency_caps).toEqual({
      per_session: 0,
      per_user_per_day: 3,
      min_turns_between: 4,
    });
    expect(policy.privacy).toEqual({ store_raw_text: true, retain_days: 90 });
    expect(policy.disclosure).toEqual({
      label: 'Ad',
      position: 'after_answer',
      style: 'separate_block',
    });
    expect(policy.regions).toEqual({ allow: ['US', 'CA', 'GB', 'EU'] });
  });

  it('defaults blocked_categories to the whole sensitive taxonomy', () => {
    expect(PolicyConfig.parse(base).blocked_categories).toEqual([...SENSITIVE_TAXONOMY]);
  });

  it('defaults demand entries to enabled', () => {
    const policy = PolicyConfig.parse({ ...base, demand: [{ source: 'koah' }] });
    expect(policy.demand).toEqual([{ source: 'koah', enabled: true }]);
  });
});

describe('PolicyConfig validation', () => {
  it('rejects unknown keys at the top level', () => {
    expect(issuesOf({ ...base, min_intent: 0.5 })).toEqual([
      { path: '', message: 'Unrecognized key: "min_intent"' },
    ]);
  });

  it('rejects unknown keys inside every nested object', () => {
    expect(PolicyConfig.safeParse({ ...base, frequency_caps: { per_day: 1 } }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, disclosure: { colour: 'red' } }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, privacy: { pii: false } }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, regions: { deny: ['RU'] } }).success).toBe(false);
    expect(
      PolicyConfig.safeParse({ ...base, demand: [{ source: 'direct', weight: 2 }] }).success,
    ).toBe(false);
  });

  it('rejects removing self_harm from blocked_categories', () => {
    const issues = issuesOf({ ...base, blocked_categories: ['health'] });
    expect(issues).toEqual([
      {
        path: 'blocked_categories',
        message: 'self_harm cannot be removed from blocked_categories',
      },
    ]);
    expect(PolicyConfig.safeParse({ ...base, blocked_categories: [] }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, blocked_categories: ['self_harm'] }).success).toBe(
      true,
    );
  });

  it('only accepts sensitive taxonomy names as blocked categories', () => {
    expect(
      PolicyConfig.safeParse({
        ...base,
        blocked_categories: ['self_harm', 'software.devtools.database'],
      }).success,
    ).toBe(false);
  });

  it('rejects non-free tiers unless allow_paid_tiers is true', () => {
    expect(issuesOf({ ...base, serve_to_tiers: ['free', 'paid'] })).toEqual([
      {
        path: 'serve_to_tiers',
        message:
          'serve_to_tiers includes non-free tiers (paid); set allow_paid_tiers: true to allow this',
      },
    ]);
    expect(
      PolicyConfig.safeParse({ ...base, serve_to_tiers: ['paid'], allow_paid_tiers: false })
        .success,
    ).toBe(false);
    const allowed = PolicyConfig.parse({
      ...base,
      serve_to_tiers: ['free', 'paid'],
      allow_paid_tiers: true,
    });
    expect(allowed.serve_to_tiers).toEqual(['free', 'paid']);
  });

  it('requires allow_paid_tiers to be a real boolean', () => {
    expect(PolicyConfig.safeParse({ ...base, allow_paid_tiers: 'true' }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, allow_paid_tiers: 1 }).success).toBe(false);
  });

  it('accepts empty serve_to_tiers and regions.allow (nobody is served)', () => {
    const policy = PolicyConfig.parse({ ...base, serve_to_tiers: [], regions: { allow: [] } });
    expect(policy.serve_to_tiers).toEqual([]);
    expect(policy.regions.allow).toEqual([]);
  });

  it('keeps thresholds within 0..1', () => {
    for (const key of ['min_commercial_intent', 'min_confidence']) {
      expect(PolicyConfig.safeParse({ ...base, [key]: 0 }).success).toBe(true);
      expect(PolicyConfig.safeParse({ ...base, [key]: 1 }).success).toBe(true);
      expect(PolicyConfig.safeParse({ ...base, [key]: -0.1 }).success).toBe(false);
      expect(PolicyConfig.safeParse({ ...base, [key]: 1.1 }).success).toBe(false);
      expect(PolicyConfig.safeParse({ ...base, [key]: '0.5' }).success).toBe(false);
    }
  });

  it('keeps caps as non-negative integers', () => {
    for (const key of ['per_session', 'per_user_per_day', 'min_turns_between']) {
      expect(PolicyConfig.safeParse({ ...base, frequency_caps: { [key]: 0 } }).success).toBe(true);
      expect(PolicyConfig.safeParse({ ...base, frequency_caps: { [key]: -1 } }).success).toBe(
        false,
      );
      expect(PolicyConfig.safeParse({ ...base, frequency_caps: { [key]: 1.5 } }).success).toBe(
        false,
      );
    }
  });

  it('requires retain_days to be a positive integer', () => {
    expect(PolicyConfig.safeParse({ ...base, privacy: { retain_days: 1 } }).success).toBe(true);
    expect(PolicyConfig.safeParse({ ...base, privacy: { retain_days: 0 } }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, privacy: { retain_days: 2.5 } }).success).toBe(false);
  });

  it('requires a non-empty disclosure label and the fixed position and style', () => {
    expect(PolicyConfig.safeParse({ ...base, disclosure: { label: '' } }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, disclosure: { position: 'inline' } }).success).toBe(
      false,
    );
    expect(PolicyConfig.safeParse({ ...base, disclosure: { style: 'inline_text' } }).success).toBe(
      false,
    );
  });

  it('accepts alpha-2 regions and the token EU, nothing else', () => {
    expect(PolicyConfig.safeParse({ ...base, regions: { allow: ['DE', 'EU'] } }).success).toBe(
      true,
    );
    for (const bad of ['usa', 'U', 'eu', 'EUR', '']) {
      expect(PolicyConfig.safeParse({ ...base, regions: { allow: [bad] } }).success).toBe(false);
    }
  });

  it('accepts only strict or balanced sensitive_detection', () => {
    expect(PolicyConfig.safeParse({ ...base, sensitive_detection: 'balanced' }).success).toBe(true);
    expect(PolicyConfig.safeParse({ ...base, sensitive_detection: 'lenient' }).success).toBe(false);
  });

  it('requires version 1 and a non-empty app_id', () => {
    expect(PolicyConfig.safeParse({ ...base, version: 2 }).success).toBe(false);
    expect(PolicyConfig.safeParse({ ...base, version: '1' }).success).toBe(false);
    expect(PolicyConfig.safeParse({}).success).toBe(false);
    expect(PolicyConfig.safeParse({ app_id: '' }).success).toBe(false);
  });

  it('reports every value problem at once with its path', () => {
    // zod runs the cross-field refinements only when the shape itself is valid, so a missing key
    // or wrong type hides them until it is fixed; value checks (ranges, patterns) co-report.
    const issues = issuesOf({
      ...base,
      blocked_categories: ['health'],
      frequency_caps: { per_session: -1 },
      regions: { allow: ['usa'] },
    });
    expect(issues.map((issue) => issue.path).sort()).toEqual([
      'blocked_categories',
      'frequency_caps.per_session',
      'regions.allow.0',
    ]);
    expect(issuesOf({ ...base, demand: [{ source: 'affiliate' }] }).map((i) => i.path)).toEqual([
      'demand.0.network',
    ]);
  });
});

describe('DemandEntry', () => {
  it('covers exactly the DemandSource values', () => {
    const sources = DemandEntry.options.map((option) => option.shape.source.value);
    expect(sources).toEqual(DemandSource.options);
  });

  it('requires a known affiliate network', () => {
    expect(DemandEntry.safeParse({ source: 'affiliate' }).success).toBe(false);
    expect(DemandEntry.safeParse({ source: 'affiliate', network: 'cj' }).success).toBe(false);
    for (const network of ['partnerstack', 'impact', 'amazon']) {
      expect(DemandEntry.parse({ source: 'affiliate', network })).toEqual({
        source: 'affiliate',
        network,
        enabled: true,
      });
    }
  });

  it('rejects unknown sources and a network on non-affiliate entries', () => {
    expect(DemandEntry.safeParse({ source: 'adsense' }).success).toBe(false);
    expect(DemandEntry.safeParse({ source: 'direct', network: 'impact' }).success).toBe(false);
  });

  it('keeps the documented default demand order', () => {
    expect(PolicyConfig.parse(base).demand).toEqual(POLICY_DOC_EXAMPLE.demand);
  });
});
