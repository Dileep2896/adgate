import { apiKeys, apps, creatives } from '@adgateio/gateway/schema';
import type { AffiliateConfig } from '@adgateio/schemas';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';

import type { AppScope } from './app-scope';
import { type DashboardDb, dashboardDb } from './db';
import type { MetricsWindow } from './metrics';
import { appLastTurnsQuery, appWindowCountsQuery, defaultMetricsWindow } from './metrics-queries';
import { appScopeCondition } from './scope-queries';

/**
 * The dashboard's reads. SELECT only (see lib/db.ts): writes go through the admin server
 * actions and their own handle (lib/db-write.ts). Each function takes the handle so a test can
 * pass its own. Rows come back as plain data; page components format, they do not query.
 *
 * EVERY FUNCTION HERE TAKES AN AppScope, and none of them defaults it (lib/app-scope.ts). A
 * member sees the apps whose owner_user_id is their user id; an admin sees every app, including
 * the null-owner ones the `create-app` CLI wrote. Getting the argument wrong is a type error
 * rather than a leak.
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
  /** The account that owns it, or null for an app the operator created from the CLI. */
  ownerUserId: string | null;
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
 * app instead, and the EXPLAIN test covers them there. All four are scoped on `apps`, which is
 * the one table every one of them starts from.
 */
export const listAppsWithCounts = async (
  scope: AppScope,
  window: MetricsWindow = defaultMetricsWindow(),
  db: DashboardDb = dashboardDb(),
): Promise<AppSummary[]> => {
  const owned = appScopeCondition(scope);
  const appList = db
    .select({
      id: apps.id,
      name: apps.name,
      policyHash: apps.policyHash,
      policyVersion: apps.policyVersion,
      createdAt: apps.createdAt,
      ownerUserId: apps.ownerUserId,
    })
    .from(apps);
  const [appRows, creativeCounts, recentCounts, lastTurns] = await Promise.all([
    (owned === undefined ? appList : appList.where(owned)).orderBy(
      desc(apps.createdAt),
      desc(apps.id),
    ),
    // Joined to `apps` rather than grouped on creatives alone, so the same owner predicate that
    // scopes the app list scopes the count beside it.
    db
      .select({ appId: creatives.appId, total: count() })
      .from(creatives)
      .innerJoin(apps, eq(creatives.appId, apps.id))
      .where(and(isNotNull(creatives.appId), owned))
      .groupBy(creatives.appId),
    appWindowCountsQuery(db, scope, window),
    appLastTurnsQuery(db, scope),
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
  ownerUserId: string | null;
  /**
   * The app owner's own affiliate identifiers, or null when no network is configured. Safe to
   * render back: docs/decisions.md item 6 - these are the PUBLIC ids that already appear in a
   * tracked link, never a credential, which is exactly why this column behaves nothing like
   * api_keys.hashed_key.
   */
  affiliateConfig: AffiliateConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One app by id, or null. `salt` is never selected: it is a per-app secret.
 *
 * A MEMBER ASKING FOR SOMEBODY ELSE'S APP GETS THE SAME null AS FOR AN APP THAT DOES NOT EXIST,
 * because the owner predicate is part of the query rather than a check on the row afterwards.
 * The page turns that into the ordinary not-found, so the id space says nothing.
 */
export const getApp = async (
  scope: AppScope,
  id: string,
  db: DashboardDb = dashboardDb(),
): Promise<AppDetail | null> => {
  // `and(condition, undefined)` drops the undefined, so an admin gets the plain id lookup.
  const owned = appScopeCondition(scope);
  const [row] = await db
    .select({
      id: apps.id,
      name: apps.name,
      policyYaml: apps.policyYaml,
      policyHash: apps.policyHash,
      policyVersion: apps.policyVersion,
      ownerUserId: apps.ownerUserId,
      affiliateConfig: apps.affiliateConfig,
      createdAt: apps.createdAt,
      updatedAt: apps.updatedAt,
    })
    .from(apps)
    .where(and(eq(apps.id, id), owned))
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
 *
 * The join on `apps` is the scope: an app id a member does not own returns no rows at all,
 * rather than the key list of somebody else's app.
 */
export const listApiKeys = async (
  scope: AppScope,
  appId: string,
  db: DashboardDb = dashboardDb(),
): Promise<ApiKeySummary[]> => {
  const owned = appScopeCondition(scope);
  return (
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
      .innerJoin(apps, eq(apiKeys.appId, apps.id))
      .where(and(eq(apiKeys.appId, appId), owned))
      // Postgres sorts NULLs first on DESC, so active keys (revoked_at null) come first and
      // revoked ones follow, most recently revoked at the top of their group.
      .orderBy(desc(apiKeys.revokedAt), desc(apiKeys.createdAt))
  );
};
