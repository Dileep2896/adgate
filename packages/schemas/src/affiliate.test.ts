import { describe, expect, it } from 'vitest';

import {
  AMAZON_MARKETPLACES,
  AffiliateConfig,
  AmazonConfig,
  AmazonMarketplace,
  ImpactConfig,
  PartnerStackConfig,
} from './affiliate.js';
import { AffiliateNetwork } from './policy-parts.js';

describe('AffiliateConfig', () => {
  const full = {
    partnerstack: { program_id: 'ps_123' },
    impact: { program_id: 'imp_1', campaign_id: 'camp_2' },
    amazon: { tag: 'mysite-20', marketplace: 'co.uk' },
  };

  it('accepts an empty object (no network configured) and every network at once', () => {
    expect(AffiliateConfig.parse({})).toEqual({});
    expect(AffiliateConfig.parse(full)).toEqual(full);
    expect(AffiliateConfig.parse({ amazon: { tag: 'mysite-20' } })).toEqual({
      amazon: { tag: 'mysite-20' },
    });
  });

  it('has one key per AffiliateNetwork', () => {
    expect(Object.keys(AffiliateConfig.shape).sort()).toEqual([...AffiliateNetwork.options].sort());
  });

  it('rejects unknown keys at every level (strict objects)', () => {
    expect(AffiliateConfig.safeParse({ cj: { program_id: 'x' } }).success).toBe(false);
    expect(
      AffiliateConfig.safeParse({ partnerstack: { program_id: 'x', secret: 'no' } }).success,
    ).toBe(false);
    expect(AffiliateConfig.safeParse({ impact: { program_id: 'x', api_key: 'no' } }).success).toBe(
      false,
    );
    expect(AffiliateConfig.safeParse({ amazon: { tag: 'x', access_key: 'no' } }).success).toBe(
      false,
    );
  });

  it('requires non-empty ids and tags', () => {
    expect(PartnerStackConfig.safeParse({ program_id: '' }).success).toBe(false);
    expect(PartnerStackConfig.safeParse({}).success).toBe(false);
    expect(ImpactConfig.safeParse({ program_id: 'imp_1', campaign_id: '' }).success).toBe(false);
    expect(ImpactConfig.parse({ program_id: 'imp_1' })).toEqual({ program_id: 'imp_1' });
    expect(AmazonConfig.safeParse({ tag: '' }).success).toBe(false);
    expect(AmazonConfig.safeParse({ marketplace: 'com' }).success).toBe(false);
  });

  it('limits the Amazon marketplace to the known Associates storefronts', () => {
    for (const marketplace of ['com', 'co.uk', 'de', 'ca', 'co.jp', 'com.au']) {
      expect(AmazonMarketplace.safeParse(marketplace).success, marketplace).toBe(true);
      expect(AMAZON_MARKETPLACES).toContain(marketplace);
    }
    expect(AmazonMarketplace.safeParse('evil.net').success).toBe(false);
    expect(AmazonMarketplace.safeParse('COM').success).toBe(false);
    expect(AmazonMarketplace.options).toEqual(AMAZON_MARKETPLACES);
    expect(new Set(AMAZON_MARKETPLACES).size).toBe(AMAZON_MARKETPLACES.length);
  });
});
