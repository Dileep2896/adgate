import { type AffiliateConfig, AffiliateNetwork } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import {
  AFFILIATE_BUILDERS,
  AFFILIATE_NOT_CONFIGURED,
  buildAffiliateUrl,
  isAffiliateConfigured,
} from './registry.js';

describe('buildAffiliateUrl', () => {
  const config: AffiliateConfig = {
    partnerstack: { program_id: 'ps_1' },
    impact: { program_id: 'imp_1', campaign_id: 'camp_1' },
    amazon: { tag: 'tag-20' },
  };

  it('dispatches to the builder of the network', () => {
    expect(
      buildAffiliateUrl({
        network: 'partnerstack',
        template: 'https://p.example/?pid={{program_id}}',
        config,
      }),
    ).toEqual({ ok: true, url: 'https://p.example/?pid=ps_1' });
    expect(
      buildAffiliateUrl({
        network: 'impact',
        template: 'https://i.example/{{program_id}}/{{campaign_id}}',
        config,
      }),
    ).toEqual({ ok: true, url: 'https://i.example/imp_1/camp_1' });
    expect(
      buildAffiliateUrl({ network: 'amazon', template: 'https://www.amazon.com/dp/X', config }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/X?tag=tag-20' });
    expect(Object.keys(AFFILIATE_BUILDERS).sort()).toEqual([...AffiliateNetwork.options].sort());
  });

  it('reports affiliate_not_configured when the network has no config entry', () => {
    for (const network of AffiliateNetwork.options) {
      expect(
        buildAffiliateUrl({ network, template: 'https://www.amazon.com/dp/X', config: {} }),
      ).toEqual({ ok: false, error: AFFILIATE_NOT_CONFIGURED });
      expect(isAffiliateConfigured({}, network)).toBe(false);
      expect(isAffiliateConfigured(config, network)).toBe(true);
    }
    expect(AFFILIATE_NOT_CONFIGURED).toBe('affiliate_not_configured');
    expect(
      buildAffiliateUrl({
        network: 'partnerstack',
        template: 'https://p.example/?pid={{program_id}}',
        config: { impact: { program_id: 'x' } },
      }),
    ).toEqual({ ok: false, error: 'affiliate_not_configured' });
  });

  it('lets a creative program_id override the app-level program id, never a missing config', () => {
    expect(
      buildAffiliateUrl({
        network: 'partnerstack',
        template: 'https://p.example/?pid={{program_id}}',
        config,
        program_id: 'ps_override',
      }),
    ).toEqual({ ok: true, url: 'https://p.example/?pid=ps_override' });
    expect(
      buildAffiliateUrl({
        network: 'impact',
        template: 'https://i.example/{{program_id}}/{{campaign_id}}',
        config,
        program_id: 'imp_override',
      }),
    ).toEqual({ ok: true, url: 'https://i.example/imp_override/camp_1' });
    expect(
      buildAffiliateUrl({
        network: 'partnerstack',
        template: 'https://p.example/?pid={{program_id}}',
        config: {},
        program_id: 'ps_override',
      }),
    ).toEqual({ ok: false, error: 'affiliate_not_configured' });
  });

  it('never lets a creative program_id replace the owner\u2019s Amazon tag', () => {
    expect(
      buildAffiliateUrl({
        network: 'amazon',
        template: 'https://www.amazon.com/dp/X',
        config,
        program_id: 'other-21',
      }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/X?tag=tag-20' });
    expect(
      buildAffiliateUrl({
        network: 'amazon',
        template: 'https://www.amazon.com/dp/X?tag={{tag}}',
        config,
        program_id: 'other-21',
      }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/X?tag=tag-20' });
  });

  it('passes the destination through to the builder', () => {
    expect(
      buildAffiliateUrl({
        network: 'partnerstack',
        template: 'https://p.example/?pid={{program_id}}&u={{u}}',
        config,
        destination: 'https://d.example/?a=b',
      }),
    ).toEqual({
      ok: true,
      url: 'https://p.example/?pid=ps_1&u=https%3A%2F%2Fd.example%2F%3Fa%3Db',
    });
  });
});
