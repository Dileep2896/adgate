import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';

import type { AppEnv, AuthContext } from '../app-env.js';
import type { ApiKeyRole, ApiKeyRow, AppRow } from '../db/tables/apps.js';
import { burnVerifyTime, type ParsedApiKey, parseBearerHeader, verifyApiSecret } from './keys.js';
import type { ApiKeyStore } from './repository.js';
import { createVerifiedKeyCache, type VerifiedKeyCache } from './verified-cache.js';

/**
 * `bearerAuth({ store, roles })` protects a route with docs/api.md authentication. It parses
 * the bearer, finds the key by its public prefix, verifies the secret against the argon2id
 * hash (or the verified-key cache, which spares a hot key the argon2 cost for a minute),
 * rejects revoked keys, checks the role and sets c.get('auth') and c.get('app').
 *
 * Every failure to authenticate is the same 401 body (an attacker learns nothing about
 * which prefixes exist or which keys were revoked); a wrong role is 403; a store or database
 * failure during the lookup is 503 unavailable with Retry-After: 1, because the caller's key
 * was not judged at all. Rejections are thrown as HTTPException so app.ts renders
 * { error: { code, message } }. Log lines carry key_id at most: never the key, the secret or
 * the hash.
 */

export const UNAUTHORIZED_MESSAGE = 'missing or invalid API key';
export const UNAVAILABLE_MESSAGE = 'authentication temporarily unavailable; retry';
export const WWW_AUTHENTICATE = 'Bearer realm="adgate"';
export const RETRY_AFTER_SECONDS = '1';
/** last_used_at is written at most once per key per this interval, off the request path. */
export const LAST_USED_THROTTLE_MS = 60_000;

export interface BearerAuthOptions {
  store: ApiKeyStore;
  /** Roles allowed on the route. At least one. */
  roles: readonly ApiKeyRole[];
  /** Clock for the last_used_at throttle and the cache. Defaults to Date.now. */
  now?: (() => number) | undefined;
  /** The verified-key cache to consult before argon2. Default: one per bearerAuth instance. */
  cache?: VerifiedKeyCache | undefined;
}

type AuthResult =
  | { ok: true; row: ApiKeyRow; app: AppRow }
  | { ok: false; reason: 'unknown_key' | 'bad_secret' | 'revoked' | 'no_app' | 'store_error' };

const unauthorized = (): HTTPException =>
  new HTTPException(401, {
    message: UNAUTHORIZED_MESSAGE,
    res: new Response(null, { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE } }),
  });

const unavailable = (): HTTPException =>
  new HTTPException(503, {
    message: UNAVAILABLE_MESSAGE,
    res: new Response(null, { status: 503, headers: { 'Retry-After': RETRY_AFTER_SECONDS } }),
  });

const forbidden = (role: ApiKeyRole, roles: readonly ApiKeyRole[]): HTTPException =>
  new HTTPException(403, {
    message: `API key role ${role} cannot use this endpoint; it requires role ${roles.join(' or ')}`,
  });

const contextOf = (row: ApiKeyRow): AuthContext => ({
  key_id: row.id,
  app_id: row.appId,
  role: row.role,
  advertiser_id: row.advertiserId,
});

/** Looks the key up and verifies it. Never throws; a store failure is its own outcome. */
const authenticate = async (
  store: ApiKeyStore,
  cache: VerifiedKeyCache,
  parsed: ParsedApiKey,
  log: Logger,
): Promise<AuthResult> => {
  try {
    const row = await store.findByPrefix(parsed.key_prefix);
    if (row === null) {
      await burnVerifyTime(parsed.secret);
      return { ok: false, reason: 'unknown_key' };
    }
    // A cached entry counts only for the same key row; anything else pays the argon2 verify.
    const cached = cache.get(parsed.key_prefix, parsed.secret)?.key_id === row.id;
    if (!cached && !(await verifyApiSecret(row.hashedKey, parsed.secret))) {
      return { ok: false, reason: 'bad_secret' };
    }
    if (row.revokedAt !== null) {
      cache.invalidate(row.id);
      log.info({ key_id: row.id }, 'revoked api key presented');
      return { ok: false, reason: 'revoked' };
    }
    const app = await store.findApp(row.appId);
    if (app === null) {
      log.error({ key_id: row.id, app_id: row.appId }, 'api key references a missing app');
      return { ok: false, reason: 'no_app' };
    }
    if (!cached) {
      cache.set(parsed.key_prefix, parsed.secret, contextOf(row));
    }
    return { ok: true, row, app };
  } catch (error) {
    log.error({ err: error }, 'api key lookup failed');
    return { ok: false, reason: 'store_error' };
  }
};

const touchLastUsed = (
  store: ApiKeyStore,
  row: ApiKeyRow,
  now: () => number,
  log: Logger,
): void => {
  const last = row.lastUsedAt;
  if (last !== null && now() - last.getTime() < LAST_USED_THROTTLE_MS) {
    return;
  }
  const warn = (error: unknown): void => {
    log.warn({ err: error, key_id: row.id }, 'last_used_at update failed');
  };
  try {
    store.touchLastUsed(row.id).catch(warn);
  } catch (error) {
    warn(error);
  }
};

export const bearerAuth = (options: BearerAuthOptions) => {
  const roles: readonly ApiKeyRole[] = [...options.roles];
  if (roles.length === 0) {
    throw new TypeError('bearerAuth: roles must name at least one role');
  }
  const { store } = options;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? createVerifiedKeyCache({ now });

  return createMiddleware<AppEnv>(async (c, next) => {
    const log = c.get('logger');
    const parsed = parseBearerHeader(c.req.header('authorization'));
    if (parsed === null) {
      log.debug({ reason: 'malformed' }, 'auth rejected');
      throw unauthorized();
    }
    const result = await authenticate(store, cache, parsed, log);
    if (!result.ok) {
      log.debug({ reason: result.reason }, 'auth rejected');
      throw result.reason === 'store_error' ? unavailable() : unauthorized();
    }
    const { row, app } = result;
    if (!roles.includes(row.role)) {
      log.debug({ key_id: row.id, role: row.role, required: roles }, 'auth forbidden');
      throw forbidden(row.role, roles);
    }
    c.set('auth', contextOf(row));
    c.set('app', app);
    c.set('logger', log.child({ key_id: row.id, app_id: row.appId }));
    touchLastUsed(store, row, now, log);
    await next();
  });
};
