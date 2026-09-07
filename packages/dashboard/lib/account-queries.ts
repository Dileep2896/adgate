import { type AccountUser, listUsers } from '@adgate/gateway/admin';

import { type DashboardDb, dashboardDb } from './db';

/**
 * The operator's read over the accounts table. It is the ONLY module in the dashboard that reads
 * `users` for display, and it is reachable from the admin surface alone (/admin, behind
 * requireAdmin and, when it is set, DASHBOARD_ALLOWED_IPS).
 *
 * `AccountUser` is the gateway's own shape and deliberately carries no password_hash: the hash
 * is read exactly once per request by the session check (lib/auth.ts) and is never part of
 * anything a page renders.
 */

export type { AccountUser };

export const listAccounts = (db: DashboardDb = dashboardDb()): Promise<AccountUser[]> =>
  listUsers(db);
