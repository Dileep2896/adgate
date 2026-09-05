import { describe, expect, it } from 'vitest';

import { isSameOriginRequest, sameOriginRedirect } from './http';

/**
 * Signing out is the one state change a cross-site POST could still reach: it needs no session
 * cookie to do damage, so SameSite=Lax does not cover it. These are the cases the check has to
 * get right - the browser's own sec-fetch-site when it is there, the Origin/Host comparison
 * when it is not, and a non-browser caller with neither.
 */

const headers = (values: Record<string, string>): Headers => new Headers(values);

describe('isSameOriginRequest', () => {
  it('believes sec-fetch-site when the browser sends it', () => {
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    // A typed URL or a bookmark: no initiating site at all.
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'none' }))).toBe(true);
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  it('ignores an origin that disagrees with sec-fetch-site', () => {
    expect(
      isSameOriginRequest(
        headers({
          'sec-fetch-site': 'cross-site',
          origin: 'http://dashboard.example',
          host: 'dashboard.example',
        }),
      ),
    ).toBe(false);
  });

  it('compares the origin with the host the browser used', () => {
    expect(
      isSameOriginRequest(
        headers({ origin: 'https://dashboard.example', host: 'dashboard.example' }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(headers({ origin: 'https://evil.example', host: 'dashboard.example' })),
    ).toBe(false);
    // Behind a proxy the browser's host is the forwarded one.
    expect(
      isSameOriginRequest(
        headers({
          origin: 'https://dashboard.example',
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'dashboard.example',
        }),
      ),
    ).toBe(true);
  });

  it('refuses an opaque or unreadable origin', () => {
    expect(isSameOriginRequest(headers({ origin: 'null', host: 'dashboard.example' }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: 'not a url', host: 'dashboard.example' }))).toBe(
      false,
    );
    expect(isSameOriginRequest(headers({ origin: 'https://dashboard.example' }))).toBe(false);
  });

  it('allows a caller that is not a browser at all', () => {
    expect(isSameOriginRequest(headers({}))).toBe(true);
    expect(isSameOriginRequest(headers({ host: 'dashboard.example' }))).toBe(true);
  });
});

describe('sameOriginRedirect', () => {
  it('sends a relative location so the origin never changes', () => {
    const response = sameOriginRedirect('/login', 303);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
  });
});
