import { describe, expect, it } from 'vitest';

import { buildPartnerStackUrl } from './partnerstack.js';

describe('buildPartnerStackUrl', () => {
  const config = { program_id: 'ps_123' };

  it('fills {{program_id}} and the encoded destination', () => {
    expect(
      buildPartnerStackUrl({
        template: 'https://partner.example/track?pid={{program_id}}&u={{u}}',
        config,
        destination: 'https://examplelang.app/?a=1&b=two words',
      }),
    ).toEqual({
      ok: true,
      url: 'https://partner.example/track?pid=ps_123&u=https%3A%2F%2Fexamplelang.app%2F%3Fa%3D1%26b%3Dtwo%20words',
    });
  });

  it('builds the seed template, whose destination is literal', () => {
    expect(
      buildPartnerStackUrl({
        template: 'https://partner.example/track?pid={{program_id}}&u=https://examplelang.app',
        config,
      }),
    ).toEqual({
      ok: true,
      url: 'https://partner.example/track?pid=ps_123&u=https://examplelang.app',
    });
  });

  it('encodes the program id', () => {
    expect(
      buildPartnerStackUrl({
        template: 'https://partner.example/track?pid={{program_id}}',
        config: { program_id: 'p&q r' },
      }),
    ).toEqual({ ok: true, url: 'https://partner.example/track?pid=p%26q%20r' });
  });

  it('fails without a destination for {{u}} and on placeholders PartnerStack does not fill', () => {
    expect(
      buildPartnerStackUrl({
        template: 'https://partner.example/track?pid={{program_id}}&u={{u}}',
        config,
      }),
    ).toEqual({ ok: false, error: 'missing_placeholder:u' });
    expect(
      buildPartnerStackUrl({ template: 'https://partner.example/track?c={{campaign_id}}', config }),
    ).toEqual({ ok: false, error: 'missing_placeholder:campaign_id' });
    expect(
      buildPartnerStackUrl({ template: 'https://partner.example/track?t={{tag}}', config }),
    ).toEqual({ ok: false, error: 'missing_placeholder:tag' });
  });
});
