import { apiKeys, apps, creatives } from '@adgate/gateway/schema';
import { count, desc, eq, isNotNull } from 'drizzle-orm';

import { type DashboardDb, dashboardDb } from './db';
import type { MetricsWindow } from './metrics';
import { appLastTurnsQuery, appWindowCountsQuery, defaultMetricsWindow } from './metrics-queries';

/**
 * The dashboard's reads. SELECT only (see lib/db.ts): writes go through the admin server
 * actions and their own handle (lib/db-write.ts). Each function takes the handle so a test can
 * pass its own. Rows come back as plain data; page components format, they do not query.
 *
 * The overview metrics have their own module, lib/metrics-queries.ts, because their queries
 * carry an obligation this file's do not - every one of them must reach audit_records through
 * an index - and an integration test EXPLAINs each. Add a metric query there, not here.
 */

export interface AppSummary {
  id: string;
  name: string;
  policyHash: string;
  policyVersion: number;
  createdAt: Date;
  /** Creatives scoped to this app. The shared global catalog (app_id null) is not counted. */
  creativeCount: number;
  /**
   * Audit records in the SAME window the /apps header counts (lib/metrics-queries.ts's
   * defaultMetricsWindow: whole UTC days), counting each turn once. Two windows on one page
   * that disagreed - a rolling 30 x 24 h here, whole days above - could never add up, and an
   * operator has no way to tell which is which.
   */
  auditCount30d: number;
  /** Timestamp of the app's most recent audit record, or null when it has none yet. */
  lastTurnAt: Date | null;
}

/**
 * Apps with their catalog and audit counts, newest first. Four plain SELECTs joined in memory
 * rather than one query with two joins: counting through a join fans the rows out and the
 * operator list is small.
 *
 * The two audit_records columns come from lib/metrics-queries.ts: `group by app_id` with no
 * app_id predicate can only be answered by reading the whole chain, so both are a lateral per
 * app instead, and the EXPLAIN test covers them there.
 */
export const listAppsWithCounts = async (
  window: MetricsWindow = defaultMetricsWindow(),
  db: DashboardDb = dashboardDb(),
): Promise<AppSummary[]> => {
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
    appWindowCountsQuery(db, window),
    appLastTurnsQuery(db),
  ]);

  const creativesByApp = new Map(creativeCounts.map((row) => [row.appId, row.total]));
  const recentByApp = new Map(recentCounts.map((row) => [row.appId, row.turns]));
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
