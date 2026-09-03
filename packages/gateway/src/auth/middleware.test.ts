import argon2 from 'argon2';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { ApiKeyRow, AppRow } from '../db/schema.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { generateApiKey, hashApiSecret } from './keys.js';
import { bearerAuth, LAST_USED_THROTTLE_MS } from './middleware.js';
import type { ApiKeyStore } from './repository.js';
import { createVerifiedKeyCache, type VerifiedKeyCache } from './verified-cache.js';

/** Edge cases that need a store the database cannot easily produce; the real store is covered by the integration test. */
const key = generateApiKey();
let hashedKey: string;

const appRow: AppRow = {
  id: 'app_01TEST',
  name: 'Fake',
  salt: 'ab'.repeat(32),
  policyYaml: 'version: 1\napp_id: app_01TEST\n',
  policyHash: `sha256:${'0'.repeat(64)}`,
  policyVersion: 1,
  affiliateConfig: null,
  createdAt: new Date('2026-09-02T00:00:00Z'),
  updatedAt: new Date('2026-09-02T00:00:00Z'),
};

const keyRow = (patch: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: 'key_01TEST',
  appId: appRow.id,
  keyPrefix: key.key_prefix,
  hashedKey,
  role: 'app',
  advertiserId: null,
  createdAt: new Date('2026-09-02T00:00:00Z'),
  revokedAt: null,
  lastUsedAt: null,
  ...patch,
});

const workingStore = (): ApiKeyStore => ({
  findByPrefix: vi.fn(async () => keyRow()),
  findApp: vi.fn(async () => appRow),
  touchLastUsed: vi.fn(async () => undefined),
});

const build = (store: ApiKeyStore, now?: () => number, cache?: VerifiedKeyCache) => {
  const { lines, stream } = collectLogs();
  const app = createApp({
    logger: createLogger({ level: 'debug' }, stream),
    corsAllowedOrigins: [],
  });
  app.get(
    '/p',
    bearerAuth({ store, roles: ['app'], ...(now ? { now } : {}), ...(cache ? { cache } : {}) }),
    (c) => c.json({ ok: true, key_id: c.get('auth').key_id }),
  );
  return { app, lines };
};

const authed = (app: ReturnType<typeof createApp>, apiKey = key.api_key) =>
  app.request('/p', { headers: { authorization: `Bearer ${apiKey}` } });

beforeAll(async () => {
  hashedKey = await hashApiSecret(key.secret);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bearerAuth with a scripted store', () => {
  it('refuses to be built without any role', () => {
    const store: ApiKeyStore = {
      findByPrefix: vi.fn(),
      findApp: vi.fn(),
      touchLastUsed: vi.fn(),
    };
    expect(() => bearerAuth({ store, roles: [] })).toThrow(TypeError);
  });

  it('still answers 200 when the last_used_at update fails', async () => {
    const store: ApiKeyStore = {
      ...workingStore(),
      touchLastUsed: vi.fn(async () => {
        throw new Error('pool closed');
      }),
    };
    const { app, lines } = build(store);
    const res = await authed(app);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key_id: 'key_01TEST' });
    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes('last_used_at'))).toBe(true);
    });
    expect(store.touchLastUsed).toHaveBeenCalledWith('key_01TEST');
  });

  it('skips the last_used_at write when the key was used recently', async () => {
    const now = Date.parse('2026-09-02T12:00:00Z');
    const recent = new Date(now - LAST_USED_THROTTLE_MS / 2);
    const store: ApiKeyStore = {
      ...workingStore(),
      findByPrefix: vi.fn(async () => keyRow({ lastUsedAt: recent })),
    };
    const { app } = build(store, () => now);
    expect((await authed(app)).status).toBe(200);
    expect(store.touchLastUsed).not.toHaveBeenCalled();

    const stale = new Date(now - LAST_USED_THROTTLE_MS * 2);
    const staleStore: ApiKeyStore = {
      ...store,
      findByPrefix: async () => keyRow({ lastUsedAt: stale }),
    };
    const second = build(staleStore, () => now);
    expect((await authed(second.app)).status).toBe(200);
    expect(store.touchLastUsed).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 401 when the key row has no app', async () => {
    const store: ApiKeyStore = { ...workingStore(), findApp: vi.fn(async () => null) };
    const { app } = build(store);
    const res = await authed(app);
    expect(res.status).toBe(401);
    expect(store.touchLastUsed).not.toHaveBeenCalled();
  });

  it('answers 503 unavailable with Retry-After when the store fails, never 401 or 500', async () => {
    const store: ApiKeyStore = {
      ...workingStore(),
      findByPrefix: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    const { app, lines } = build(store);
    const res = await authed(app);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      error: { code: 'unavailable', message: expect.stringContaining('unavailable') },
    });
    expect(lines.join('\n')).not.toContain(key.secret);
  });

  it('never calls the store for a malformed header', async () => {
    const store: ApiKeyStore = { findByPrefix: vi.fn(), findApp: vi.fn(), touchLastUsed: vi.fn() };
    const { app } = build(store);
    const res = await app.request('/p', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
    expect(store.findByPrefix).not.toHaveBeenCalled();
  });
});

describe('bearerAuth verified-key cache', () => {
  it('verifies with argon2 once, then serves the same key from the cache', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    const store = workingStore();
    const cache = createVerifiedKeyCache();
    const { app } = build(store, undefined, cache);
    expect((await authed(app)).status).toBe(200);
    expect((await authed(app)).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    // The row is still loaded every time: revocations written elsewhere are seen at once.
    expect(store.findByPrefix).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it('rejects a key revoked in the store within the TTL and drops it from the cache', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    const store = workingStore();
    const cache = createVerifiedKeyCache();
    const { app } = build(store, undefined, cache);
    expect((await authed(app)).status).toBe(200);
    store.findByPrefix = vi.fn(async () => keyRow({ revokedAt: new Date() }));
    const revoked = await authed(app);
    expect(revoked.status).toBe(401);
    expect(cache.size).toBe(0);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('still verifies (and fails) a wrong secret under a cached prefix', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    const { app } = build(workingStore(), undefined, createVerifiedKeyCache());
    expect((await authed(app)).status).toBe(200);
    const wrong = `ak_${key.key_prefix}_${generateApiKey().secret}`;
    expect((await authed(app, wrong)).status).toBe(401);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(await verify.mock.results[1]?.value).toBe(false);
  });

  it('forgets a verified key once the TTL has passed', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    let t = Date.parse('2026-09-03T00:00:00Z');
    const now = () => t;
    const { app } = build(workingStore(), now, createVerifiedKeyCache({ ttlMs: 60_000, now }));
    expect((await authed(app)).status).toBe(200);
    t += 60_000;
    expect((await authed(app)).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
