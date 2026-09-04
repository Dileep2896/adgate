import { apiKeys, apps, auditRecords, creatives } from '@adgate/gateway/schema';
import { and, count, desc, eq, gte, isNotNull, max } from 'drizzle-orm';

import { type DashboardDb, dashboardDb } from './db';

/**
 * Every read the dashboard makes, in one module. SELECT only (see lib/db.ts): writes go
 * through the admin server actions and their own handle (lib/db-write.ts). Each function takes
 * the handle so a test can pass its own. Rows come back as plain data; page components format,
 * they do not query.
 */

/** The window the app list counts audit records over. */
export const AUDIT_WINDOW_DAYS = 30;

export const windowStart = (now: Date = new Date(), days = AUDIT_WINDOW_DAYS): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export interface AppSummary {
  id: string;
  name: string;
  policyHash: string;
  policyVersion: number;
  createdAt: Date;
  /** Creatives scoped to this app. The shared global catalog (app_id null) is not counted. */
  creativeCount: number;
  /** Audit records written in the last AUDIT_WINDOW_DAYS days, counting each turn once. */
  auditCount30d: number;
  /** Timestamp of the app's most recent audit record, or null when it has none yet. */
  lastTurnAt: Date | null;
}

/**
 * Apps with their catalog and audit counts, newest first. Four plain SELECTs joined in memory
 * rather than one query with two joins: counting through a join fans the rows out and the
 * operator list is small.
 */
export const listAppsWithCounts = async (
  db: DashboardDb = dashboardDb(),
  now: Date = new Date(),
): Promise<AppSummary[]> => {
  const since = windowStart(now);
  const [appRows, creativeCounts, recentCounts, lastTurns] = await Promise.all([
    db
      .select({
        id: apps.id,
        name: apps.name,
        policyHash: apps.policyHash,
        policyVersion: apps.policyVersion,
        createdAt: apps.createdAt,
      })
      .from(apps)
      .orderBy(desc(apps.createdAt), desc(apps.id)),
    db
      .select({ appId: creatives.appId, total: count() })
      .from(creatives)
      .where(isNotNull(creatives.appId))
      .groupBy(creatives.appId),
    db
      .select({ appId: auditRecords.appId, total: count() })
      .from(auditRecords)
      .where(and(eq(auditRecords.isLatest, true), gte(auditRecords.ts, since)))
      .groupBy(auditRecords.appId),
    db
      .select({ appId: auditRecords.appId, lastTs: max(auditRecords.ts) })
      .from(auditRecords)
      .where(eq(auditRecords.isLatest, true))
      .groupBy(auditRecords.appId),
  ]);

  const creativesByApp = new Map(creativeCounts.map((row) => [row.appId, row.total]));
  const recentByApp = new Map(recentCounts.map((row) => [row.appId, row.total]));
  const lastTurnByApp = new Map(lastTurns.map((row) => [row.appId, row.lastTs]));

  return appRows.map((app) => ({
    ...app,
    creativeCount: creativesByApp.get(app.id) ?? 0,
    auditCount30d: recentByApp.get(app.id) ?? 0,
    lastTurnAt: lastTurnByApp.get(app.id) ?? null,
  }));
};

export interface AppDetail {
  id: string;
  name: string;
  /** The stored policy document, exactly as it was written. */
  policyYaml: string;
  policyHash: string;
  policyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One app by id, or null. `salt` is never selected: it is a per-app secret. */
export const getApp = async (
  id: string,
  db: DashboardDb = dashboardDb(),
): Promise<AppDetail | null> => {
  const [row] = await db
    .select({
      id: apps.id,
      name: apps.name,
      policyYaml: apps.policyYaml,
      policyHash: apps.policyHash,
      policyVersion: apps.policyVersion,
      createdAt: apps.createdAt,
      updatedAt: apps.updatedAt,
    })
    .from(apps)
    .where(eq(apps.id, id))
    .limit(1);
  return row ?? null;
};

export interface ApiKeySummary {
  keyId: string;
  role: string;
  advertiserId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * An app's API keys. hashed_key and key_prefix are deliberately NOT selected: the hash must
 * never leave the gateway process and the prefix is half of a key. A key value is shown once,
 * by the action that mints it, and is never readable afterwards.
 */
export const listApiKeys = async (
  appId: string,
  db: DashboardDb = dashboardDb(),
): Promise<ApiKeySummary[]> =>
  db
    .select({
      keyId: apiKeys.id,
      role: apiKeys.role,
      advertiserId: apiKeys.advertiserId,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.appId, appId))
    // Postgres sorts NULLs first on DESC, so active keys (revoked_at null) come first and
    // revoked ones follow, most recently revoked at the top of their group.
    .orderBy(desc(apiKeys.revokedAt), desc(apiKeys.createdAt));
