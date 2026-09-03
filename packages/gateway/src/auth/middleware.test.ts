import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import type { ApiKeyRow, AppRow } from '../db/schema.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { generateApiKey, hashApiSecret } from './keys.js';
import { bearerAuth, LAST_USED_THROTTLE_MS } from './middleware.js';
import type { ApiKeyStore } from './repository.js';

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

const build = (store: ApiKeyStore, now?: () => number) => {
  const { lines, stream } = collectLogs();
  const app = createApp({
    logger: createLogger({ level: 'debug' }, stream),
    corsAllowedOrigins: [],
  });
  app.get('/p', bearerAuth({ store, roles: ['app'], ...(now ? { now } : {}) }), (c) =>
    c.json({ ok: true, key_id: c.get('auth').key_id }),
  );
  return { app, lines };
};

const authed = (app: ReturnType<typeof createApp>) =>
  app.request('/p', { headers: { authorization: `Bearer ${key.api_key}` } });

beforeAll(async () => {
  hashedKey = await hashApiSecret(key.secret);
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
      findByPrefix: vi.fn(async () => keyRow()),
      findApp: vi.fn(async () => appRow),
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
      findByPrefix: vi.fn(async () => keyRow({ lastUsedAt: recent })),
      findApp: vi.fn(async () => appRow),
      touchLastUsed: vi.fn(async () => undefined),
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
    const store: ApiKeyStore = {
      findByPrefix: vi.fn(async () => keyRow()),
      findApp: vi.fn(async () => null),
      touchLastUsed: vi.fn(async () => undefined),
    };
    const { app } = build(store);
    const res = await authed(app);
    expect(res.status).toBe(401);
    expect(store.touchLastUsed).not.toHaveBeenCalled();
  });

  it('turns a store failure into 401 rather than a 500 that leaks state', async () => {
    const store: ApiKeyStore = {
      findByPrefix: vi.fn(async () => {
        throw new Error('connection refused');
      }),
      findApp: vi.fn(),
      touchLastUsed: vi.fn(),
    };
    const { app, lines } = build(store);
    const res = await authed(app);
    expect(res.status).toBe(401);
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
