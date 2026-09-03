import type { Logger } from 'pino';

import type { ApiKeyRole, AppRow } from './db/tables/apps.js';

/**
 * What bearerAuth (auth/middleware.ts) proves about the caller. key_id is the only one of
 * these that may appear in a log line; the key itself never reaches the context.
 */
export interface AuthContext {
  key_id: string;
  app_id: string;
  role: ApiKeyRole;
  /** Set for advertiser_read keys: the advertiser whose records the key may read. */
  advertiser_id: string | null;
}

/**
 * Per-request variables on the Hono context. requestId and logger are set on every request
 * by request-id.ts; auth and app are set by bearerAuth on the routes it protects, so only
 * handlers behind it may read them.
 */
export interface AppVariables {
  requestId: string;
  logger: Logger;
  auth: AuthContext;
  /** The apps row of the authenticated key (policy, salt, affiliate config). */
  app: AppRow;
}

/** The Hono environment of every route in this gateway: `new Hono<AppEnv>()`. */
export type AppEnv = { Variables: AppVariables };
