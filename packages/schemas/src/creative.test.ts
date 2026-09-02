import { describe, expect, it } from 'vitest';

import { Creative, DemandSource } from './creative.js';

const valid = {
  id: 'cr_01J',
  advertiser: 'Example DB Cloud',
  headline: 'Managed Postgres with a free tier',
  body: '',
  cta: 'Try it free',
  url: 'http://localhost:8787/c/aud_01J',
  source: 'affiliate',
  disclosure_label: 'Sponsored',
};

describe('Creative', () => {
  it('accepts a creative with an empty body', () => {
    expect(Creative.parse(valid)).toEqual(valid);
  });

  it('requires the cr_ id prefix and a non-empty disclosure label', () => {
    expect(Creative.safeParse({ ...valid, id: 'adv_01J' }).success).toBe(false);
    expect(Creative.safeParse({ ...valid, disclosure_label: '' }).success).toBe(false);
  });

  it('accepts exactly the policy demand sources', () => {
    expect(DemandSource.options).toEqual(['direct', 'affiliate', 'koah', 'gravity']);
    expect(Creative.safeParse({ ...valid, source: 'adsense' }).success).toBe(false);
  });

  it('requires headline, cta and url to be non-empty', () => {
    expect(Creative.safeParse({ ...valid, headline: '' }).success).toBe(false);
    expect(Creative.safeParse({ ...valid, cta: '' }).success).toBe(false);
    expect(Creative.safeParse({ ...valid, url: '' }).success).toBe(false);
  });
});
