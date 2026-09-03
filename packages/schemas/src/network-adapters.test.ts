import { describe, expect, it } from 'vitest';

import { GravityConfig, KoahConfig } from './network-adapters.js';

const CREDENTIALS = { api_key: 'sk_test', base_url: 'https://api.partner.example' };

describe.each([
  ['KoahConfig', KoahConfig],
  ['GravityConfig', GravityConfig],
] as const)('%s', (title, Config) => {
  it('defaults enabled to false and accepts an empty object', () => {
    expect(Config.parse({})).toEqual({ enabled: false });
    expect(Config.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('accepts the full shape and round-trips it', () => {
    const full = { enabled: true, ...CREDENTIALS };
    expect(Config.parse(full)).toEqual(full);
    expect(Config.parse({ enabled: true })).toEqual({ enabled: true });
    expect(Config.parse(CREDENTIALS)).toEqual({ enabled: false, ...CREDENTIALS });
  });

  it('rejects unknown keys (strict object)', () => {
    expect(Config.safeParse({ enabled: true, ...CREDENTIALS, secret: 'x' }).success).toBe(false);
    expect(Config.safeParse({ apiKey: 'x' }).success).toBe(false);
    expect(Config.safeParse({ enabeld: true }).success).toBe(false);
  });

  it('requires a boolean switch and non-empty credentials when present', () => {
    expect(Config.safeParse({ enabled: 'true' }).success).toBe(false);
    expect(Config.safeParse({ enabled: 1 }).success).toBe(false);
    expect(Config.safeParse({ api_key: '' }).success).toBe(false);
    expect(Config.safeParse({ base_url: '' }).success).toBe(false);
    expect(Config.safeParse({ api_key: 1 }).success).toBe(false);
  });

  it('carries its own title and the three documented keys', () => {
    expect(Config.meta()?.title).toBe(title);
    expect(Object.keys(Config.shape).sort()).toEqual(['api_key', 'base_url', 'enabled']);
  });
});

describe('KoahConfig and GravityConfig', () => {
  it('are distinct schemas of the same shape', () => {
    expect(KoahConfig).not.toBe(GravityConfig);
    expect(Object.keys(KoahConfig.shape)).toEqual(Object.keys(GravityConfig.shape));
    expect(KoahConfig.meta()?.description).not.toBe(GravityConfig.meta()?.description);
  });
});
