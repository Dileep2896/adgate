import { type AffiliateConfig, DemandResponse } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { request } from '../direct.fixture.js';
import { createAffiliateAdapter } from './adapter.js';
import {
  PARTNERSTACK_CONFIG,
  affiliateCreative,
  fetchOptions as opts,
  languageRequest,
  seedCatalog as catalog,
  seeds,
} from './adapter.fixture.js';
import { AFFILIATE_NOT_CONFIGURED } from './registry.js';

describe('AffiliateAdapter with examples/creatives.seed.json', () => {
  const adapter = createAffiliateAdapter({
    catalog,
    network: 'partnerstack',
    config: PARTNERSTACK_CONFIG,
  });

  it('resolves the Example Language App entry with the app owner’s PartnerStack id', async () => {
    const response = await adapter.fetch(languageRequest(), opts);
    expect(DemandResponse.parse(response)).toEqual(response);
    expect(response.source).toBe('affiliate');
    expect(response.error).toBeUndefined();
    expect(response.candidates).toHaveLength(1);
    const [lang] = response.candidates;
    expect(lang?.advertiser).toBe('Example Language App');
    expect(lang?.id).toBe(catalog[2]?.id);
    expect(lang?.resolved_url).toBe(
      'https://partner.example/track?pid=ps_123&u=https://examplelang.app',
    );
    expect(lang?.url_template).toBe(seeds[2]?.url_template);
    expect(lang?.ecpm_estimate).toBe(6);
    expect(lang?.targeting_match).toBe(0.833);
    expect(lang?.network).toBeUndefined();
  });

  it('serves the seed entry (no network field) under whichever network the policy names', async () => {
    const impact = createAffiliateAdapter({
      catalog,
      network: 'impact',
      config: { impact: { program_id: 'imp_1' } },
    });
    const response = await impact.fetch(languageRequest(), opts);
    expect(response.candidates[0]?.resolved_url).toBe(
      'https://partner.example/track?pid=imp_1&u=https://examplelang.app',
    );
  });

  it('never returns the direct seed creatives, even for their own category', async () => {
    const clocked = createAffiliateAdapter({
      catalog,
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
      now: () => 0,
    });
    const response = await clocked.fetch(request({ keywords: ['postgres'] }), opts);
    expect(response).toEqual({ source: 'affiliate', candidates: [], latency_ms: 0 });
  });
});

describe('AffiliateAdapter configuration', () => {
  it('yields zero candidates and affiliate_not_configured without its network config', async () => {
    const configs: AffiliateConfig[] = [{}, { impact: { program_id: 'imp_1' } }];
    for (const config of configs) {
      const adapter = createAffiliateAdapter({
        catalog,
        network: 'partnerstack',
        config,
        now: () => 0,
      });
      const response = await adapter.fetch(languageRequest(), opts);
      expect(response).toEqual({
        source: 'affiliate',
        candidates: [],
        latency_ms: 0,
        error: AFFILIATE_NOT_CONFIGURED,
      });
      expect(DemandResponse.parse(response)).toEqual(response);
    }
  });

  it('skips only the creatives whose template cannot be built and names them', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [
        affiliateCreative({ id: 'cr_01' }),
        affiliateCreative({
          id: 'cr_02',
          url_template: 'https://partner.example/track?c={{campaign_id}}',
        }),
        affiliateCreative({ id: 'cr_03', url_template: 'not a url' }),
      ],
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
    });
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => c.id)).toEqual(['cr_01']);
    // {{u}} falls back to the advertiser domain landing page when the catalog names no destination.
    expect(response.candidates[0]?.resolved_url).toBe(
      'https://partner.example/track?pid=ps_123&u=https%3A%2F%2Fadvertiser.test%2F',
    );
    expect(response.error).toBe(
      'build_failed:cr_02:missing_placeholder:campaign_id,build_failed:cr_03:invalid_url',
    );
    expect(DemandResponse.parse(response)).toEqual(response);
  });

  it('serves only creatives of its own network; a missing network means the adapter’s', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [
        affiliateCreative({ id: 'cr_01', network: 'impact' }),
        affiliateCreative({ id: 'cr_02', network: 'partnerstack' }),
        affiliateCreative({ id: 'cr_03' }),
        affiliateCreative({
          id: 'cr_04',
          network: 'amazon',
          url_template: 'https://www.amazon.com/dp/X',
        }),
      ],
      network: 'partnerstack',
      config: { ...PARTNERSTACK_CONFIG, impact: { program_id: 'i' }, amazon: { tag: 't' } },
    });
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => c.id)).toEqual(['cr_02', 'cr_03']);
    expect(response.error).toBeUndefined();
  });

  it('lets a creative program_id override the app-level id', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [affiliateCreative({ program_id: 'ps_override' })],
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
    });
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates[0]?.resolved_url).toBe(
      'https://partner.example/track?pid=ps_override&u=https%3A%2F%2Fadvertiser.test%2F',
    );
  });

  it('builds Amazon Associates links with the owner’s tag, whatever the creative says', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [
        affiliateCreative({ url_template: 'https://www.amazon.com/dp/B000000000?th=1' }),
        affiliateCreative({
          id: 'cr_02',
          url_template: 'https://www.amazon.com/dp/B000000001?TAG=someone-else-21',
          program_id: 'other-21',
        }),
      ],
      network: 'amazon',
      config: { amazon: { tag: 'mysite-20' } },
    });
    const response = await adapter.fetch(request(), opts);
    expect(response.candidates.map((c) => c.resolved_url)).toEqual([
      'https://www.amazon.com/dp/B000000000?th=1&tag=mysite-20',
      'https://www.amazon.com/dp/B000000001?tag=mysite-20',
    ]);
    // The catalog row (program_id, url_template) travels with the candidate; the link does not.
    for (const url of response.candidates.map((c) => c.resolved_url ?? '')) {
      expect(url).not.toContain('other-21');
      expect(url).not.toContain('someone-else');
    }
  });
});
