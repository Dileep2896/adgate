import { PolicyConfig } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import {
  creativeDeliverability,
  type DeliverabilityContext,
  type DeliverabilityCreative,
  enabledAffiliateNetworks,
  enabledDemandSources,
  targetCategoryBase,
} from './deliverability.js';

/**
 * The measured failure this diagnostic exists for: 12 affiliate creatives seeded into a live
 * gateway, all active, all matching, none serving. Two causes, both correct behaviour and both
 * invisible - the app had no affiliate_config, and the default policy enables exactly one
 * affiliate network (partnerstack), so the four `impact` creatives were never queried.
 */

const policy = (patch: Partial<PolicyConfig> = {}): PolicyConfig => ({
  ...PolicyConfig.parse({ app_id: 'app_test' }),
  ...patch,
});

const creative = (patch: Partial<DeliverabilityCreative> = {}): DeliverabilityCreative => ({
  active: true,
  source: 'affiliate',
  network: 'partnerstack',
  target_categories: ['software.devtools.database'],
  target_regions: ['US', 'CA', 'GB', 'EU'],
  ...patch,
});

const configured: DeliverabilityContext = {
  policy: policy(),
  affiliateConfig: { partnerstack: { program_id: 'ps_1' } },
};

describe('creativeDeliverability', () => {
  it('passes a creative the policy enables, the app configures and the regions admit', () => {
    expect(creativeDeliverability(creative(), configured)).toEqual({ deliverable: true });
  });

  it('passes a direct creative under the default policy with no affiliate config at all', () => {
    expect(
      creativeDeliverability(creative({ source: 'direct', network: undefined }), {
        policy: policy(),
      }),
    ).toEqual({ deliverable: true });
  });

  it('reports inactive first, before any policy reason that also applies', () => {
    const result = creativeDeliverability(
      creative({ active: false, network: 'impact', target_regions: ['JP'] }),
      configured,
    );
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('inactive');
    expect(result.detail).toContain('active');
  });

  it('reports source_not_enabled when the policy disables the creative’s whole source', () => {
    const rulesOnly = policy({
      demand: [
        { source: 'direct', enabled: true },
        { source: 'affiliate', network: 'partnerstack', enabled: false },
      ],
    });
    const result = creativeDeliverability(creative(), { policy: rulesOnly });
    expect(result).toMatchObject({ deliverable: false, reason: 'source_not_enabled' });
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.detail).toContain('affiliate');
    expect(result.detail).toContain('direct');
  });

  it('reports network_not_enabled for an impact creative under the default policy', () => {
    // The exact failure measured on the live gateway: 4 impact creatives, 0 served.
    const result = creativeDeliverability(creative({ network: 'impact' }), configured);
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('network_not_enabled');
    expect(result.detail).toContain('impact');
    expect(result.detail).toContain('partnerstack');
  });

  it('reports affiliate_not_configured and names the missing config key', () => {
    const result = creativeDeliverability(creative(), { policy: policy() });
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('affiliate_not_configured');
    expect(result.detail).toContain('affiliate_config.partnerstack');
  });

  it('treats a creative without a network as belonging to any enabled affiliate entry', () => {
    const noNetwork = creative({ network: undefined });
    const twoNetworks = policy({
      demand: [
        { source: 'affiliate', network: 'partnerstack', enabled: true },
        { source: 'affiliate', network: 'impact', enabled: true },
      ],
    });
    // Configured for the second entry only: still deliverable, through that one.
    expect(
      creativeDeliverability(noNetwork, {
        policy: twoNetworks,
        affiliateConfig: { impact: { program_id: 'imp_1' } },
      }),
    ).toEqual({ deliverable: true });
    const result = creativeDeliverability(noNetwork, { policy: twoNetworks });
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('affiliate_not_configured');
    expect(result.detail).toContain('affiliate_config.partnerstack');
    expect(result.detail).toContain('affiliate_config.impact');
  });

  it('does not let a creative-level program_id stand in for the app’s missing config', () => {
    // registry.ts: the override never replaces the network entry, so nor does it here.
    const result = creativeDeliverability(creative(), { policy: policy(), affiliateConfig: {} });
    expect(result).toMatchObject({ deliverable: false, reason: 'affiliate_not_configured' });
  });

  it('reports region_never_allowed when target_regions never meet regions.allow', () => {
    const result = creativeDeliverability(creative({ target_regions: ['JP', 'AU'] }), configured);
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('region_never_allowed');
    expect(result.detail).toContain('JP');
    expect(result.detail).toContain('US');
  });

  it('expands EU on both sides before deciding the regions never meet', () => {
    const deCreative = creative({ target_regions: ['DE'] });
    // Policy allows the EU token: DE is one of the 27, so the creative is deliverable.
    expect(creativeDeliverability(deCreative, configured)).toEqual({ deliverable: true });
    // A creative targeting EU against a policy that allows only DE is deliverable too.
    expect(
      creativeDeliverability(creative({ target_regions: ['EU'] }), {
        ...configured,
        policy: policy({ regions: { allow: ['DE'] } }),
      }),
    ).toEqual({ deliverable: true });
    // GB is not in the EU, so an EU-only policy never admits a GB-only creative.
    expect(
      creativeDeliverability(creative({ target_regions: ['GB'] }), {
        ...configured,
        policy: policy({ regions: { allow: ['EU'] } }),
      }),
    ).toMatchObject({ deliverable: false, reason: 'region_never_allowed' });
  });

  it('treats empty target_regions as everywhere, and an empty regions.allow as nowhere', () => {
    const everywhere = creative({ target_regions: [] });
    expect(creativeDeliverability(everywhere, configured)).toEqual({ deliverable: true });
    const result = creativeDeliverability(everywhere, {
      ...configured,
      policy: policy({ regions: { allow: [] } }),
    });
    if (result.deliverable) {
      throw new Error('expected a blocked result');
    }
    expect(result.reason).toBe('region_never_allowed');
    expect(result.detail).toContain('regions.allow');
  });

  it('reports no_target_categories rather than claiming every category is blocked', () => {
    const result = creativeDeliverability(creative({ target_categories: [] }), configured);
    expect(result).toMatchObject({ deliverable: false, reason: 'no_target_categories' });
  });

  it('reports all_categories_blocked only when every target is blocked', () => {
    const blockedPolicy = policy({ blocked_categories: ['self_harm', 'health', 'finance'] });
    const context = { ...configured, policy: blockedPolicy };
    expect(
      creativeDeliverability(creative({ target_categories: ['health', 'finance'] }), context),
    ).toMatchObject({ deliverable: false, reason: 'all_categories_blocked' });
    // One survivor is enough to make the creative deliverable.
    expect(
      creativeDeliverability(
        creative({ target_categories: ['health', 'software.devtools.database'] }),
        context,
      ),
    ).toEqual({ deliverable: true });
  });

  it('compares a wildcard target on its base, and a blocked category blocks everything under it', () => {
    const context = {
      ...configured,
      policy: policy({ blocked_categories: ['self_harm', 'health'] }),
    };
    expect(
      creativeDeliverability(creative({ target_categories: ['health.*'] }), context),
    ).toMatchObject({ deliverable: false, reason: 'all_categories_blocked' });
    expect(
      creativeDeliverability(creative({ target_categories: ['health.insurance.*'] }), context),
    ).toMatchObject({ deliverable: false, reason: 'all_categories_blocked' });
    expect(
      creativeDeliverability(creative({ target_categories: ['software.devtools.*'] }), context),
    ).toEqual({ deliverable: true });
  });

  it('is per app: the same creative can be deliverable for one app and blocked for another', () => {
    const impact = creative({ network: 'impact' });
    const enablesImpact: DeliverabilityContext = {
      policy: policy({
        demand: [
          { source: 'direct', enabled: true },
          { source: 'affiliate', network: 'impact', enabled: true },
        ],
      }),
      affiliateConfig: { impact: { program_id: 'imp_1' } },
    };
    expect(creativeDeliverability(impact, enablesImpact)).toEqual({ deliverable: true });
    expect(creativeDeliverability(impact, configured)).toMatchObject({
      deliverable: false,
      reason: 'network_not_enabled',
    });
  });

  it('never mentions creative copy: the detail names policy and catalog fields only', () => {
    const results = [
      creativeDeliverability(creative({ active: false }), configured),
      creativeDeliverability(creative({ network: 'impact' }), configured),
      creativeDeliverability(creative(), { policy: policy() }),
    ];
    for (const result of results) {
      if (result.deliverable) {
        throw new Error('expected a blocked result');
      }
      expect(result.detail.length).toBeGreaterThan(0);
      expect(result.detail).not.toMatch(/headline|body|cta/i);
    }
  });
});

describe('policy helpers', () => {
  it('lists enabled sources and affiliate networks in policy order without repeats', () => {
    const p = policy({
      demand: [
        { source: 'direct', enabled: true },
        { source: 'affiliate', network: 'partnerstack', enabled: true },
        { source: 'affiliate', network: 'impact', enabled: false },
        { source: 'affiliate', network: 'amazon', enabled: true },
        { source: 'koah', enabled: false },
      ],
    });
    expect(enabledDemandSources(p)).toEqual(['direct', 'affiliate']);
    expect(enabledAffiliateNetworks(p)).toEqual(['partnerstack', 'amazon']);
  });

  it('strips only a trailing wildcard from a target category', () => {
    expect(targetCategoryBase('software.devtools.*')).toBe('software.devtools');
    expect(targetCategoryBase('software.devtools.database')).toBe('software.devtools.database');
    expect(targetCategoryBase('health')).toBe('health');
  });
});
