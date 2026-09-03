import { describe, expect, it } from 'vitest';

import { buildImpactUrl } from './impact.js';

describe('buildImpactUrl', () => {
  it('fills program_id, campaign_id and the encoded destination', () => {
    expect(
      buildImpactUrl({
        template: 'https://imp.example/c/{{program_id}}/{{campaign_id}}?u={{u}}',
        config: { program_id: 'imp_1', campaign_id: 'camp_2' },
        destination: 'https://shop.example/item?id=7&ref=a b',
      }),
    ).toEqual({
      ok: true,
      url: 'https://imp.example/c/imp_1/camp_2?u=https%3A%2F%2Fshop.example%2Fitem%3Fid%3D7%26ref%3Da%20b',
    });
  });

  it('does not need a campaign id when the template has no {{campaign_id}}', () => {
    expect(
      buildImpactUrl({
        template: 'https://imp.example/c/{{program_id}}?u=https://shop.example',
        config: { program_id: 'imp_1' },
      }),
    ).toEqual({ ok: true, url: 'https://imp.example/c/imp_1?u=https://shop.example' });
  });

  it('fails when the template needs a campaign id the config lacks', () => {
    expect(
      buildImpactUrl({
        template: 'https://imp.example/c/{{program_id}}/{{campaign_id}}',
        config: { program_id: 'imp_1' },
      }),
    ).toEqual({ ok: false, error: 'missing_placeholder:campaign_id' });
  });

  it('encodes ids in path position too', () => {
    expect(
      buildImpactUrl({
        template: 'https://imp.example/c/{{program_id}}',
        config: { program_id: 'a/b c' },
      }),
    ).toEqual({ ok: true, url: 'https://imp.example/c/a%2Fb%20c' });
  });
});
