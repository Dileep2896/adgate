import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';

import type { AppEnv, AuthContext } from '../app-env.js';
import type { ApiKeyRole, ApiKeyRow, AppRow } from '../db/tables/apps.js';
import { burnVerifyTime, type ParsedApiKey, parseBearerHeader, verifyApiSecret } from './keys.js';
import type { ApiKeyStore } from './repository.js';

/**
 * `bearerAuth({ store, roles })` protects a route with docs/api.md authentication. It parses
 * the bearer, finds the key by its public prefix, verifies the secret against the argon2id
 * hash, rejects revoked keys, checks the role and sets c.get('auth') and c.get('app').
 *
 * Every failure to authenticate is the same 401 body (an attacker learns nothing about
 * which prefixes exist or which keys were revoked); a wrong role is 403. Rejections are
 * thrown as HTTPException so app.ts renders { error: { code, message } }. Log lines carry
 * key_id at most: never the key, the secret or the hash.
 */

export const UNAUTHORIZED_MESSAGE = 'missing or invalid API key';
export const WWW_AUTHENTICATE = 'Bearer realm="adgate"';
/** last_used_at is written at most once per key per this interval, off the request path. */
export const LAST_USED_THROTTLE_MS = 60_000;

export interface BearerAuthOptions {
  store: ApiKeyStore;
  /** Roles allowed on the route. At least one. */
  roles: readonly ApiKeyRole[];
  /** Clock for the last_used_at throttle. Defaults to Date.now. */
  now?: (() => number) | undefined;
}

type AuthResult =
  | { ok: true; row: ApiKeyRow; app: AppRow }
  | { ok: false; reason: 'unknown_key' | 'bad_secret' | 'revoked' | 'no_app' | 'store_error' };

const unauthorized = (): HTTPException =>
  new HTTPException(401, {
    message: UNAUTHORIZED_MESSAGE,
    res: new Response(null, { status: 401, headers: { 'WWW-Authenticate': WWW_AUTHENTICATE } }),
  });

const forbidden = (role: ApiKeyRole, roles: readonly ApiKeyRole[]): HTTPException =>
  new HTTPException(403, {
    message: `API key role ${role} cannot use this endpoint; it requires role ${roles.join(' or ')}`,
  });

/** Looks the key up and verifies it. Never throws; a store failure denies access. */
const authenticate = async (
  store: ApiKeyStore,
  parsed: ParsedApiKey,
  log: Logger,
): Promise<AuthResult> => {
  try {
    const row = await store.findByPrefix(parsed.key_prefix);
    if (row === null) {
      await burnVerifyTime(parsed.secret);
      return { ok: false, reason: 'unknown_key' };
    }
    if (!(await verifyApiSecret(row.hashedKey, parsed.secret))) {
      return { ok: false, reason: 'bad_secret' };
    }
    if (row.revokedAt !== null) {
      log.info({ key_id: row.id }, 'revoked api key presented');
      return { ok: false, reason: 'revoked' };
    }
    const app = await store.findApp(row.appId);
    if (app === null) {
      log.error({ key_id: row.id, app_id: row.appId }, 'api key references a missing app');
      return { ok: false, reason: 'no_app' };
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

  return createMiddleware<AppEnv>(async (c, next) => {
    const log = c.get('logger');
    const parsed = parseBearerHeader(c.req.header('authorization'));
    if (parsed === null) {
      log.debug({ reason: 'malformed' }, 'auth rejected');
      throw unauthorized();
    }
    const result = await authenticate(store, parsed, log);
    if (!result.ok) {
      log.debug({ reason: result.reason }, 'auth rejected');
      throw unauthorized();
    }
    const { row, app } = result;
    if (!roles.includes(row.role)) {
      log.debug({ key_id: row.id, role: row.role, required: roles }, 'auth forbidden');
      throw forbidden(row.role, roles);
    }
    const auth: AuthContext = {
      key_id: row.id,
      app_id: row.appId,
      role: row.role,
      advertiser_id: row.advertiserId,
    };
    c.set('auth', auth);
    c.set('app', app);
    c.set('logger', log.child({ key_id: row.id, app_id: row.appId }));
    touchLastUsed(store, row, now, log);
    await next();
  });
};
