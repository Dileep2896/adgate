import type { CatalogCreative, DemandResponse } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { createDirectAdapter } from '../direct.js';
import { creative, request } from '../direct.fixture.js';
import { AFFILIATE_MAX_CANDIDATES, AffiliateAdapter, createAffiliateAdapter } from './adapter.js';
import {
  LANGUAGE_CLASSIFICATION,
  PARTNERSTACK_CONFIG,
  affiliateCreative,
  fetchOptions as opts,
  languageRequest,
  seedCatalog as catalog,
} from './adapter.fixture.js';

describe('AffiliateAdapter selection parity with DirectAdapter', () => {
  const entries: Partial<CatalogCreative>[] = [
    { id: 'cr_03', ecpm: 5 },
    { id: 'cr_01', ecpm: 5 },
    { id: 'cr_02', ecpm: 5 },
    { id: 'cr_04', ecpm: 9, target_categories: ['software.*'] },
    { id: 'cr_00', ecpm: 7 },
    { id: 'cr_05', ecpm: 100, active: false },
    { id: 'cr_06', ecpm: 50, target_regions: ['GB'] },
    { id: 'cr_07', ecpm: 8, target_regions: ['EU'], keywords: ['postgres', 'neon'] },
    { id: 'cr_08', ecpm: 60, target_categories: ['education.language'] },
  ];
  const direct = createDirectAdapter(entries.map((entry) => creative(entry)));
  const affiliate = createAffiliateAdapter({
    catalog: entries.map((entry) => affiliateCreative(entry)),
    network: 'partnerstack',
    config: PARTNERSTACK_CONFIG,
  });
  const summary = (response: DemandResponse) =>
    response.candidates.map((c) => [c.id, c.targeting_match, c.ecpm_estimate]);

  it.each([
    ['US without keywords', request()],
    ['DE (EU token) with keywords', request({ user: { region: 'DE' }, keywords: ['postgres'] })],
    ['BR', request({ user: { region: 'BR' } })],
    ['a missing region', request({ user: {} })],
  ])('ranks the same ids and scores as DirectAdapter for %s', async (_name, req) => {
    const [d, a] = await Promise.all([direct.fetch(req, opts), affiliate.fetch(req, opts)]);
    expect(summary(a)).toEqual(summary(d));
    expect(a.candidates.length).toBeLessThanOrEqual(AFFILIATE_MAX_CANDIDATES);
    expect(a.error).toBeUndefined();
  });

  it('orders by targeting_match, then ecpm, then id, top 3, inactive and off-region never', async () => {
    const us = await affiliate.fetch(request(), opts);
    expect(us.candidates.map((c) => c.id)).toEqual(['cr_00', 'cr_01', 'cr_02']);
    const de = await affiliate.fetch(
      request({ user: { region: 'DE' }, keywords: ['postgres'] }),
      opts,
    );
    expect(de.candidates.map((c) => c.id)).toEqual(['cr_07', 'cr_00', 'cr_01']);
    expect(de.candidates[0]?.targeting_match).toBe(0.875);
    expect(AFFILIATE_MAX_CANDIDATES).toBe(3);
  });

  it('does not apply competitor exclusions (mediation does)', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [affiliateCreative({ advertiser_domain: 'competitor.com' })],
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
    });
    const response = await adapter.fetch(request({ exclusions: ['competitor.com'] }), opts);
    expect(response.candidates).toHaveLength(1);
  });
});

describe('AffiliateAdapter never throws', () => {
  it('returns [] for an empty catalog and for a classification without categories', async () => {
    const empty = createAffiliateAdapter({
      catalog: [],
      network: 'amazon',
      config: { amazon: { tag: 't' } },
    });
    expect((await empty.fetch(request(), opts)).candidates).toEqual([]);
    const adapter = createAffiliateAdapter({
      catalog,
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
    });
    const response = await adapter.fetch(
      languageRequest({ classification: { ...LANGUAGE_CLASSIFICATION, categories: [] } }),
      opts,
    );
    expect(response.candidates).toEqual([]);
    expect(response.error).toBeUndefined();
  });

  it('reports an aborted signal instead of candidates', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createAffiliateAdapter({
      catalog,
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
      now: () => 0,
    });
    const response = await adapter.fetch(languageRequest(), {
      timeoutMs: 250,
      signal: controller.signal,
    });
    expect(response).toEqual({
      source: 'affiliate',
      candidates: [],
      latency_ms: 0,
      error: 'aborted',
    });
  });

  it('turns malformed input, an unencodable id and a throwing clock into responses', async () => {
    const adapter = createAffiliateAdapter({
      catalog: [affiliateCreative()],
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
    });
    const malformed = request({ user: null as unknown as { region?: string } });
    const response = await adapter.fetch(malformed, opts);
    expect(response.candidates).toEqual([]);
    expect(response.error).toMatch(/^TypeError: /);
    const lone = createAffiliateAdapter({
      catalog: [affiliateCreative()],
      network: 'partnerstack',
      config: { partnerstack: { program_id: String.fromCharCode(0xd800) } },
    });
    expect(await lone.fetch(request(), opts)).toMatchObject({
      candidates: [],
      error: 'build_failed:cr_01:encode_failed',
    });
    let calls = 0;
    const clock = new AffiliateAdapter({
      catalog: [affiliateCreative()],
      network: 'partnerstack',
      config: PARTNERSTACK_CONFIG,
      now: () => {
        calls += 1;
        throw new Error('no clock');
      },
    });
    const clocked = await clock.fetch(request(), opts);
    expect(clocked.candidates).toHaveLength(1);
    expect(clocked.latency_ms).toBe(0);
    expect(calls).toBe(2);
  });

  it('measures latency_ms with the injected clock and copies the catalog and config', async () => {
    const ticks = [1000, 1061];
    const entries = [affiliateCreative()];
    const config = { partnerstack: { program_id: 'ps_123' } };
    const adapter = createAffiliateAdapter({
      catalog: entries,
      network: 'partnerstack',
      config,
      now: () => ticks.shift() ?? 0,
    });
    entries.push(affiliateCreative({ id: 'cr_99' }));
    config.partnerstack.program_id = 'changed';
    const response = await adapter.fetch(request(), opts);
    expect(response.latency_ms).toBe(61);
    expect(response.candidates).toHaveLength(1);
    expect(response.candidates[0]?.resolved_url).toContain('pid=ps_123');
    expect(adapter.source).toBe('affiliate');
  });
});
