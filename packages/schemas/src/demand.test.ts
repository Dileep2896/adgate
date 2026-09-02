import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  Candidate,
  CatalogCreative,
  DemandRequest,
  DemandResponse,
  SeedCreative,
  TARGET_CATEGORY_PATTERN,
  TargetCategory,
} from './demand.js';
import { CATEGORIES_TAXONOMY } from './taxonomy.js';

const seeds = JSON.parse(
  readFileSync(new URL('../../../examples/creatives.seed.json', import.meta.url), 'utf8'),
) as unknown[];

const creative = {
  id: 'cr_01J',
  advertiser: 'Example DB Cloud',
  advertiser_domain: 'exampledb.dev',
  headline: 'Managed Postgres with a free tier',
  body: '',
  cta: 'Try it free',
  url_template: 'https://exampledb.dev/?ref=adgate',
  target_categories: ['software.devtools.database', 'software.devtools.*'],
  target_regions: ['US', 'EU'],
  keywords: ['postgres', 'managed postgres'],
  ecpm: 12,
  source: 'direct',
  active: true,
};

const classification = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'rules',
  prompt_version: 'sha256:test',
};

const request = {
  app_id: 'app_01J',
  classification,
  surface: { type: 'chat', placement: 'after_answer' },
  user: { region: 'US', locale: 'en-US' },
  exclusions: ['competitor.com'],
};

describe('TargetCategory', () => {
  it('accepts every taxonomy category', () => {
    for (const category of CATEGORIES_TAXONOMY) {
      expect(TargetCategory.safeParse(category).success, category).toBe(true);
    }
  });

  it('accepts trailing-wildcard patterns with at least one segment', () => {
    expect(TargetCategory.safeParse('software.devtools.*').success).toBe(true);
    expect(TargetCategory.safeParse('software.*').success).toBe(true);
    expect(TargetCategory.safeParse('shopping_v2.*').success).toBe(true);
  });

  it('rejects a bare wildcard, inner wildcards, upper case and dangling dots', () => {
    for (const bad of [
      '*',
      '.*',
      'software.*.database',
      'software.dev*',
      'Software.devtools',
      'software.devtools.',
      '.software',
      'software..devtools',
      '',
      'software devtools',
    ]) {
      expect(TargetCategory.safeParse(bad).success, bad).toBe(false);
      expect(TARGET_CATEGORY_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('CatalogCreative', () => {
  it('accepts a direct creative with an empty body and no affiliate fields', () => {
    expect(CatalogCreative.parse(creative)).toEqual(creative);
  });

  it('accepts the optional affiliate fields', () => {
    const affiliate = { ...creative, source: 'affiliate', network: 'impact', program_id: 'p-1' };
    expect(CatalogCreative.parse(affiliate)).toEqual(affiliate);
    expect(CatalogCreative.safeParse({ ...affiliate, network: 'cj' }).success).toBe(false);
    expect(CatalogCreative.safeParse({ ...affiliate, program_id: '' }).success).toBe(false);
  });

  it('requires the cr_ id prefix and the documented demand sources', () => {
    expect(CatalogCreative.safeParse({ ...creative, id: 'adv_01J' }).success).toBe(false);
    expect(CatalogCreative.safeParse({ ...creative, source: 'adsense' }).success).toBe(false);
  });

  it('validates targeting lists', () => {
    expect(
      CatalogCreative.safeParse({ ...creative, target_categories: ['Software'] }).success,
    ).toBe(false);
    expect(CatalogCreative.safeParse({ ...creative, target_regions: ['usa'] }).success).toBe(false);
    expect(CatalogCreative.safeParse({ ...creative, keywords: [''] }).success).toBe(false);
    expect(
      CatalogCreative.safeParse({ ...creative, target_categories: [], target_regions: [] }).success,
    ).toBe(true);
  });

  it('requires a non-negative ecpm, a boolean active flag and non-empty text fields', () => {
    expect(CatalogCreative.safeParse({ ...creative, ecpm: -1 }).success).toBe(false);
    expect(CatalogCreative.safeParse({ ...creative, ecpm: 0 }).success).toBe(true);
    expect(CatalogCreative.safeParse({ ...creative, active: 'yes' }).success).toBe(false);
    for (const field of ['advertiser', 'advertiser_domain', 'headline', 'cta', 'url_template']) {
      expect(CatalogCreative.safeParse({ ...creative, [field]: '' }).success, field).toBe(false);
    }
  });
});

describe('SeedCreative', () => {
  it('loads every entry of examples/creatives.seed.json', () => {
    const parsed = SeedCreative.array().parse(seeds);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((seed) => seed.source)).toEqual(['direct', 'direct', 'affiliate']);
    for (const seed of parsed) {
      expect(seed).not.toHaveProperty('id');
    }
  });

  it('is CatalogCreative without the id', () => {
    const { id, ...seed } = creative;
    expect(id).toBe('cr_01J');
    expect(SeedCreative.parse(seed)).toEqual(seed);
    expect(SeedCreative.safeParse({ ...seed, ecpm: 'free' }).success).toBe(false);
  });
});

describe('DemandRequest', () => {
  it('accepts a request without keywords and strips user fields adapters must not see', () => {
    const parsed = DemandRequest.parse({
      ...request,
      user: { ...request.user, tier: 'free', user_hash: 'sha256:x' },
    });
    expect(parsed.user).toEqual({ region: 'US', locale: 'en-US' });
    expect(parsed.keywords).toBeUndefined();
  });

  it('accepts dictionary keywords and an empty user', () => {
    const parsed = DemandRequest.parse({ ...request, user: {}, keywords: ['postgres'] });
    expect(parsed.keywords).toEqual(['postgres']);
    expect(parsed.user.region).toBeUndefined();
  });

  it('requires exclusions, a valid classification and an alpha-2 region', () => {
    const { exclusions, ...noExclusions } = request;
    expect(exclusions).toHaveLength(1);
    expect(DemandRequest.safeParse(noExclusions).success).toBe(false);
    expect(DemandRequest.safeParse({ ...request, user: { region: 'usa' } }).success).toBe(false);
    expect(
      DemandRequest.safeParse({
        ...request,
        classification: { ...classification, categories: ['unknown'] },
      }).success,
    ).toBe(false);
    expect(DemandRequest.safeParse({ ...request, keywords: [''] }).success).toBe(false);
  });
});

describe('Candidate and DemandResponse', () => {
  const candidate = { ...creative, ecpm_estimate: 12, targeting_match: 0.85 };

  it('extends CatalogCreative with scores and an optional resolved_url', () => {
    expect(Candidate.parse(candidate)).toEqual(candidate);
    const resolved = { ...candidate, resolved_url: 'https://exampledb.dev/?ref=adgate' };
    expect(Candidate.parse(resolved)).toEqual(resolved);
    expect(Candidate.safeParse({ ...candidate, targeting_match: 1.01 }).success).toBe(false);
    expect(Candidate.safeParse({ ...candidate, targeting_match: -0.1 }).success).toBe(false);
    expect(Candidate.safeParse({ ...candidate, ecpm_estimate: -1 }).success).toBe(false);
    expect(Candidate.safeParse({ ...candidate, resolved_url: '' }).success).toBe(false);
  });

  it('DemandResponse carries the source, candidates, an integer latency and an optional error', () => {
    const ok = { source: 'direct', candidates: [candidate], latency_ms: 38 };
    expect(DemandResponse.parse(ok)).toEqual(ok);
    const failed = { source: 'koah', candidates: [], latency_ms: 250, error: 'timeout' };
    expect(DemandResponse.parse(failed)).toEqual(failed);
    expect(DemandResponse.safeParse({ ...ok, latency_ms: 1.5 }).success).toBe(false);
    expect(DemandResponse.safeParse({ ...ok, latency_ms: -1 }).success).toBe(false);
    expect(DemandResponse.safeParse({ ...ok, error: '' }).success).toBe(false);
    expect(DemandResponse.safeParse({ ...ok, source: 'adsense' }).success).toBe(false);
  });
});
