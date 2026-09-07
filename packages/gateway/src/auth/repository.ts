import { prefixedUlid, type UlidOptions } from '@adgateio/core';
import { and, eq, isNull } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { type ApiKeyRole, type ApiKeyRow, apiKeys, type AppRow, apps } from '../db/tables/apps.js';
import { type GeneratedApiKey, generateApiKey, hashApiSecret } from './keys.js';
import type { VerifiedKeyCache } from './verified-cache.js';

/**
 * Everything the gateway reads or writes in api_keys. The middleware talks to the
 * ApiKeyStore interface so unit tests can script it; createApiKeyStore is the Postgres one.
 */

export const API_KEY_ID_PREFIX = 'key_';

export interface ApiKeyStore {
  /** The row whose public lookup handle is `keyPrefix`, revoked or not; null when unknown. */
  findByPrefix(keyPrefix: string): Promise<ApiKeyRow | null>;
  findApp(appId: string): Promise<AppRow | null>;
  /** Best-effort bookkeeping; the middleware never waits for it. */
  touchLastUsed(keyId: string): Promise<void>;
}

export const createApiKeyStore = (db: DbOrTx): ApiKeyStore => ({
  findByPrefix: async (keyPrefix) => {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, keyPrefix)).limit(1);
    return row ?? null;
  },
  findApp: async (appId) => {
    const [row] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    return row ?? null;
  },
  touchLastUsed: async (keyId) => {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
  },
});

export interface IssueApiKeyInput {
  appId: string;
  role: ApiKeyRole;
  /** Required for advertiser_read, forbidden for app (the table CHECK says the same). */
  advertiserId?: string | null | undefined;
  ulid?: UlidOptions | undefined;
}

/** A freshly issued key. api_key and secret exist only in this object: show them once. */
export interface IssuedApiKey extends GeneratedApiKey {
  key_id: string;
  app_id: string;
  role: ApiKeyRole;
  advertiser_id: string | null;
}

export const issueApiKey = async (db: DbOrTx, input: IssueApiKeyInput): Promise<IssuedApiKey> => {
  const advertiserId = input.advertiserId ?? null;
  if (input.role === 'advertiser_read' && advertiserId === null) {
    throw new TypeError('issueApiKey: an advertiser_read key needs an advertiserId');
  }
  if (input.role === 'app' && advertiserId !== null) {
    throw new TypeError('issueApiKey: an app key cannot carry an advertiserId');
  }
  const generated = generateApiKey();
  const hashedKey = await hashApiSecret(generated.secret);
  const id = prefixedUlid(API_KEY_ID_PREFIX, input.ulid);
  await db.insert(apiKeys).values({
    id,
    appId: input.appId,
    keyPrefix: generated.key_prefix,
    hashedKey,
    role: input.role,
    advertiserId,
  });
  return {
    ...generated,
    key_id: id,
    app_id: input.appId,
    role: input.role,
    advertiser_id: advertiserId,
  };
};

export interface RevokeApiKeyOptions {
  now?: Date | undefined;
  /** The verified-key cache of this process, so the key stops working before its TTL. */
  cache?: VerifiedKeyCache | undefined;
}

/**
 * Marks a key revoked and drops it from the in-process verified-key cache. Returns false when
 * it did not exist or was already revoked. Other processes see the revocation on their next
 * request too: the middleware reloads the row every time and only skips the argon2 step.
 */
export const revokeApiKey = async (
  db: DbOrTx,
  keyId: string,
  options: RevokeApiKeyOptions = {},
): Promise<boolean> => {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: options.now ?? new Date() })
    .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  options.cache?.invalidate(keyId);
  return rows.length > 0;
};
