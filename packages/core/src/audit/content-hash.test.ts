import type { CatalogCreative } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonical/canonicalize.js';
import { CREATIVE_CONTENT_FIELDS, creativeContent, creativeContentHash } from './content-hash.js';
import { sha256Prefixed } from './crypto.js';
import { EXAMPLE_CANDIDATE } from './record.fixture.js';

const CONTENT = {
  advertiser: 'Example DB Cloud',
  advertiser_domain: 'example.com',
  headline: 'Managed Postgres with a free tier',
  body: 'Spin up a database in 30 seconds.',
  cta: 'Try it free',
  url_template: 'https://example.com/?ref=adgate',
};

/** The candidate as the creatives table stores it (S20 compares against this). */
const stored = (): CatalogCreative => {
  const { ecpm_estimate, targeting_match, resolved_url, ...creative } = EXAMPLE_CANDIDATE;
  expect(ecpm_estimate).toBe(5);
  expect(targeting_match).toBe(0.85);
  expect(resolved_url).toBeDefined();
  return creative;
};

describe('creativeContentHash', () => {
  it('is sha256 over the canonical JSON of the six content fields', () => {
    expect(creativeContentHash(EXAMPLE_CANDIDATE)).toBe(sha256Prefixed(canonicalize(CONTENT)));
    expect(creativeContentHash(EXAMPLE_CANDIDATE)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(CREATIVE_CONTENT_FIELDS).toEqual([
      'advertiser',
      'advertiser_domain',
      'headline',
      'body',
      'cta',
      'url_template',
    ]);
  });

  it('matches between a candidate and its stored catalog creative', () => {
    expect(creativeContentHash(stored())).toBe(creativeContentHash(EXAMPLE_CANDIDATE));
    expect(creativeContentHash(CONTENT)).toBe(creativeContentHash(EXAMPLE_CANDIDATE));
  });

  it('changes when any content field changes', () => {
    const base = creativeContentHash(EXAMPLE_CANDIDATE);
    for (const field of CREATIVE_CONTENT_FIELDS) {
      const changed = { ...EXAMPLE_CANDIDATE, [field]: `${EXAMPLE_CANDIDATE[field]} ` };
      expect(creativeContentHash(changed), field).not.toBe(base);
    }
    expect(creativeContentHash({ ...EXAMPLE_CANDIDATE, body: '' })).not.toBe(base);
  });

  it('ignores identity, targeting, pricing, status and per-request fields', () => {
    const base = creativeContentHash(EXAMPLE_CANDIDATE);
    const variants: Partial<CatalogCreative & { resolved_url: string; ecpm_estimate: number }>[] = [
      { id: 'cr_01JOTHER' },
      { ecpm: 99 },
      { ecpm_estimate: 99 },
      { resolved_url: 'https://example.com/?ref=other' },
      { keywords: [] },
      { target_categories: ['software.*'] },
      { target_regions: ['US'] },
      { active: false },
      { source: 'affiliate', network: 'impact', program_id: 'p1' },
    ];
    for (const patch of variants) {
      expect(creativeContentHash({ ...EXAMPLE_CANDIDATE, ...patch }), JSON.stringify(patch)).toBe(
        base,
      );
    }
  });

  it('does not depend on key order and creativeContent picks exactly the six fields', () => {
    const reordered = Object.fromEntries(Object.entries(CONTENT).reverse());
    expect(creativeContentHash(reordered as typeof CONTENT)).toBe(creativeContentHash(CONTENT));
    expect(creativeContent(EXAMPLE_CANDIDATE)).toEqual(CONTENT);
    expect(Object.keys(creativeContent(EXAMPLE_CANDIDATE))).toEqual([...CREATIVE_CONTENT_FIELDS]);
  });
});
