import { ErrorResponse } from '@adgateio/schemas';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { AppEnv } from '../app-env.js';
import { registerApp } from '../apps/register-app.js';
import type { DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { advertisers, apiKeys } from '../db/schema.js';
import { createTestDb, requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { generateApiKey } from './keys.js';
import { bearerAuth, UNAUTHORIZED_MESSAGE } from './middleware.js';
import { createApiKeyStore, type IssuedApiKey, issueApiKey, revokeApiKey } from './repository.js';
import { createVerifiedKeyCache } from './verified-cache.js';

/**
 * bearerAuth against the real api_keys table. The protected routes exist only in this file:
 * the production app gets its routes (and their auth) from S18 onwards.
 */
const url = requireTestDatabaseUrl();
let handle: DbHandle;
let appId: string;
let appKey: IssuedApiKey;
let advertiserKey: IssuedApiKey;
let revokedKey: IssuedApiKey;
let lines: string[];
let app: ReturnType<typeof createApp>;

const request = (path: string, authorization?: string) =>
  app.request(path, { headers: authorization === undefined ? {} : { authorization } });

const UNAUTHORIZED_BODY = { error: { code: 'unauthorized', message: UNAUTHORIZED_MESSAGE } };

beforeAll(async () => {
  await runMigrations(url);
  handle = createTestDb(url, { max: 2 });
  await truncateAllTables(handle.sql);

  const registered = await registerApp(handle.db, { name: 'Auth Test App' });
  appId = registered.app.id;
  appKey = registered.key;
  const [advertiser] = await handle.db
    .insert(advertisers)
    .values({ id: 'adv_01AUTHTEST', name: 'Example DB Cloud', domain: 'exampledb.dev' })
    .returning();
  advertiserKey = await issueApiKey(handle.db, {
    appId,
    role: 'advertiser_read',
    advertiserId: advertiser?.id ?? null,
  });
  revokedKey = await issueApiKey(handle.db, { appId, role: 'app' });
  expect(await revokeApiKey(handle.db, revokedKey.key_id)).toBe(true);

  const logs = collectLogs();
  lines = logs.lines;
  app = createApp({
    logger: createLogger({ level: 'debug' }, logs.stream),
    corsAllowedOrigins: [],
    db: handle.db,
  });
  const store = createApiKeyStore(handle.db);
  const echo = (c: Context<AppEnv>) => c.json({ auth: c.get('auth'), app_name: c.get('app').name });
  app.get('/_test/app-only', bearerAuth({ store, roles: ['app'] }), echo);
  app.get('/_test/advertiser-only', bearerAuth({ store, roles: ['advertiser_read'] }), echo);
  app.get('/_test/either', bearerAuth({ store, roles: ['app', 'advertiser_read'] }), echo);
});

afterAll(async () => {
  await handle.close();
});

describe('bearerAuth rejects with 401 and the documented body', () => {
  it.each([
    ['no Authorization header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a bare key without the scheme', ''],
    ['a malformed key', 'Bearer not-a-key'],
    ['an unknown prefix', `Bearer ak_ZZZZZZZZZZZZ_${generateApiKey().secret}`],
  ])('%s', async (_label, header) => {
    const authorization = header === '' ? appKey.api_key : header;
    const res = await request('/_test/app-only', authorization);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(ErrorResponse.parse(await res.json())).toEqual(UNAUTHORIZED_BODY);
  });

  it('a wrong secret under a known prefix', async () => {
    const wrong = `ak_${appKey.key_prefix}_${generateApiKey().secret}`;
    const res = await request('/_test/app-only', `Bearer ${wrong}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it('a revoked key, with a body identical to an unknown key', async () => {
    const res = await request('/_test/app-only', `Bearer ${revokedKey.api_key}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY);
  });
});

describe('bearerAuth accepts a valid key and enforces roles', () => {
  it('lets an app key through an app-only route with the auth and app context set', async () => {
    const res = await request('/_test/app-only', `Bearer ${appKey.api_key}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      auth: { key_id: appKey.key_id, app_id: appId, role: 'app', advertiser_id: null },
      app_name: 'Auth Test App',
    });
  });

  it('answers 403 forbidden to an advertiser_read key on an app-only route', async () => {
    const res = await request('/_test/app-only', `Bearer ${advertiserKey.api_key}`);
    expect(res.status).toBe(403);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toContain('app');
  });

  it('answers 403 forbidden to an app key on an advertiser_read-only route', async () => {
    const res = await request('/_test/advertiser-only', `Bearer ${appKey.api_key}`);
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe('forbidden');
  });

  it('lets an advertiser_read key through its route with the advertiser id', async () => {
    const res = await request('/_test/advertiser-only', `Bearer ${advertiserKey.api_key}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      auth: {
        key_id: advertiserKey.key_id,
        app_id: appId,
        role: 'advertiser_read',
        advertiser_id: 'adv_01AUTHTEST',
      },
      app_name: 'Auth Test App',
    });
  });

  it('accepts either role on a route that lists both', async () => {
    expect((await request('/_test/either', `Bearer ${appKey.api_key}`)).status).toBe(200);
    expect((await request('/_test/either', `Bearer ${advertiserKey.api_key}`)).status).toBe(200);
  });

  it('records last_used_at best effort after a successful call', async () => {
    const deadline = Date.now() + 5_000;
    let lastUsedAt: Date | null = null;
    while (lastUsedAt === null && Date.now() < deadline) {
      const [row] = await handle.db
        .select({ lastUsedAt: apiKeys.lastUsedAt })
        .from(apiKeys)
        .where(eq(apiKeys.id, appKey.key_id));
      lastUsedAt = row?.lastUsedAt ?? null;
      if (lastUsedAt === null) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('bearerAuth and revocation', () => {
  it('rejects a key that was accepted moments ago once the store marks it revoked', async () => {
    const temp = await issueApiKey(handle.db, { appId, role: 'app' });
    expect((await request('/_test/app-only', `Bearer ${temp.api_key}`)).status).toBe(200);
    expect(await revokeApiKey(handle.db, temp.key_id)).toBe(true);
    const res = await request('/_test/app-only', `Bearer ${temp.api_key}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it('revokeApiKey drops the key from the verified-key cache it is given', async () => {
    const temp = await issueApiKey(handle.db, { appId, role: 'app' });
    const cache = createVerifiedKeyCache();
    cache.set(temp.key_prefix, temp.secret, {
      key_id: temp.key_id,
      app_id: appId,
      role: 'app',
      advertiser_id: null,
    });
    expect(await revokeApiKey(handle.db, temp.key_id, { cache })).toBe(true);
    expect(cache.size).toBe(0);
    expect(await revokeApiKey(handle.db, temp.key_id, { cache })).toBe(false);
  });
});

describe('bearerAuth never logs key material', () => {
  it('no log line carries a secret, a presented key or a stored hash', async () => {
    const rows = await handle.db.select({ hashedKey: apiKeys.hashedKey }).from(apiKeys);
    expect(rows.length).toBe(5);
    expect(lines.length).toBeGreaterThan(5);
    const forbidden = [
      appKey.secret,
      advertiserKey.secret,
      revokedKey.secret,
      appKey.api_key,
      advertiserKey.api_key,
      revokedKey.api_key,
      ...rows.map((row) => row.hashedKey),
    ];
    for (const line of lines) {
      for (const value of forbidden) {
        expect(line).not.toContain(value);
      }
    }
    // The key id is the only identifier the logs may carry.
    expect(lines.some((line) => line.includes(appKey.key_id))).toBe(true);
  });
});
