import { describe, expect, it } from 'vitest';

import { DEFAULT_LANDING_PATH, safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('keeps a same-site absolute path', () => {
    expect(safeRedirectPath('/audit')).toBe('/audit');
    expect(safeRedirectPath('/apps?page=2')).toBe('/apps?page=2');
  });

  it.each([
    '//evil.example.com',
    '/\\evil.example.com',
    'https://evil.example.com',
    'http://evil.example.com',
    'javascript:alert(1)',
    'apps',
    '',
    '/audit\nSet-Cookie: x=1',
  ])('refuses %s', (candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_LANDING_PATH);
  });

  it('refuses null and undefined', () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_LANDING_PATH);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_LANDING_PATH);
  });

  it('never bounces back to the login form', () => {
    expect(safeRedirectPath('/login')).toBe(DEFAULT_LANDING_PATH);
    expect(safeRedirectPath('/login?from=%2Fapps')).toBe(DEFAULT_LANDING_PATH);
  });

  it('honours an explicit fallback', () => {
    expect(safeRedirectPath('//evil.example.com', '/creatives')).toBe('/creatives');
  });
});
