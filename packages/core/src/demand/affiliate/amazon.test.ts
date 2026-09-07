import { AMAZON_MARKETPLACES } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { buildAmazonUrl, isAmazonHost, setTagParam } from './amazon.js';

describe('buildAmazonUrl', () => {
  const config = { tag: 'mysite-20' };

  it('appends tag= to a URL without a query string', () => {
    expect(buildAmazonUrl({ template: 'https://www.amazon.com/dp/B000000000', config })).toEqual({
      ok: true,
      url: 'https://www.amazon.com/dp/B000000000?tag=mysite-20',
    });
  });

  it('appends tag= to an existing query string, keeping it verbatim', () => {
    expect(
      buildAmazonUrl({ template: 'https://www.amazon.com/dp/B000000000?th=1&psc=1', config }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/B000000000?th=1&psc=1&tag=mysite-20' });
  });

  it('replaces a tag already in the template with the app owner’s own tag', () => {
    expect(
      buildAmazonUrl({
        template: 'https://www.amazon.com/dp/B000000000?tag=someone-else-21&th=1',
        config,
      }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/B000000000?th=1&tag=mysite-20' });
    expect(
      buildAmazonUrl({
        template: 'https://amazon.de/s?k=kaffee&tag={{tag}}',
        config: { tag: 'mysite-21', marketplace: 'de' },
      }),
    ).toEqual({ ok: true, url: 'https://amazon.de/s?k=kaffee&tag=mysite-21' });
  });

  it('keeps the fragment after the query and encodes the tag', () => {
    expect(
      buildAmazonUrl({
        template: 'https://www.amazon.co.uk/dp/B000000000#reviews',
        config: { tag: 'my site&x', marketplace: 'co.uk' },
      }),
    ).toEqual({
      ok: true,
      url: 'https://www.amazon.co.uk/dp/B000000000?tag=my%20site%26x#reviews',
    });
    expect(setTagParam('https://www.amazon.com/dp/X?tag=old', 't')).toBe(
      'https://www.amazon.com/dp/X?tag=t',
    );
    expect(setTagParam('https://www.amazon.com/dp/X?', 't')).toBe(
      'https://www.amazon.com/dp/X?tag=t',
    );
  });

  it('drops every spelling of an existing tag parameter: case and percent-encoding included', () => {
    expect(
      setTagParam('https://www.amazon.com/dp/X?TAG=a&Tag=b&%74ag=c&%54%41%47=d&th=1&tag=e', 't'),
    ).toBe('https://www.amazon.com/dp/X?th=1&tag=t');
    expect(setTagParam('https://www.amazon.com/dp/X?tag&tagx=1&xtag=2', 't')).toBe(
      'https://www.amazon.com/dp/X?tagx=1&xtag=2&tag=t',
    );
    // A parameter name that cannot be percent-decoded is kept: it is not `tag`.
    expect(setTagParam('https://www.amazon.com/dp/X?%E0=1', 't')).toBe(
      'https://www.amazon.com/dp/X?%E0=1&tag=t',
    );
    expect(
      buildAmazonUrl({ template: 'https://www.amazon.com/dp/X?TAG=someone-else-21', config }),
    ).toEqual({ ok: true, url: 'https://www.amazon.com/dp/X?tag=mysite-20' });
  });

  it('rejects hosts that are not an Amazon storefront, including short links', () => {
    for (const template of [
      'https://amzn.to/3abc',
      'https://notamazon.com/dp/X',
      'https://amazon.com.evil.net/dp/X',
      'https://www.amazon.evil/dp/X',
      'https://amazon.com@evil.net/dp/X',
      'https://smile.amazon.com/dp/X',
    ]) {
      expect(buildAmazonUrl({ template, config }), template).toEqual({
        ok: false,
        error: 'not_amazon_host',
      });
    }
  });

  it('rejects a storefront other than the configured marketplace', () => {
    expect(
      buildAmazonUrl({
        template: 'https://www.amazon.com/dp/X',
        config: { tag: 't', marketplace: 'co.uk' },
      }),
    ).toEqual({ ok: false, error: 'marketplace_mismatch' });
    expect(
      buildAmazonUrl({
        template: 'https://www.amazon.co.uk/dp/X',
        config: { tag: 't', marketplace: 'co.uk' },
      }),
    ).toEqual({ ok: true, url: 'https://www.amazon.co.uk/dp/X?tag=t' });
  });

  it('propagates template failures', () => {
    expect(
      buildAmazonUrl({ template: 'https://www.amazon.com/dp/{{program_id}}', config }),
    ).toEqual({ ok: false, error: 'missing_placeholder:program_id' });
    expect(buildAmazonUrl({ template: 'amazon.com/dp/X', config })).toEqual({
      ok: false,
      error: 'invalid_url',
    });
  });
});

describe('isAmazonHost', () => {
  it('accepts every known storefront, with or without www, case-insensitively', () => {
    for (const marketplace of AMAZON_MARKETPLACES) {
      expect(isAmazonHost(`amazon.${marketplace}`), marketplace).toBe(true);
      expect(isAmazonHost(`www.amazon.${marketplace}`), marketplace).toBe(true);
      expect(isAmazonHost(`www.amazon.${marketplace}`, marketplace), marketplace).toBe(true);
    }
    expect(isAmazonHost('WWW.AMAZON.COM')).toBe(true);
  });

  it('rejects other subdomains, unknown storefronts and a different marketplace', () => {
    expect(isAmazonHost('smile.amazon.com')).toBe(false);
    expect(isAmazonHost('amazon.evil')).toBe(false);
    expect(isAmazonHost('amazon.com', 'de')).toBe(false);
    expect(isAmazonHost('amazon.co.uk', 'co')).toBe(false);
  });
});
