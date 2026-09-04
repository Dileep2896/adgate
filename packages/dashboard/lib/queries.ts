import { apps, auditRecords, creatives } from '@adgate/gateway/schema';
import { count, desc, eq, isNotNull, max } from 'drizzle-orm';

import { type DashboardDb, dashboardDb } from './db';

/**
 * Every read the dashboard makes, in one module. SELECT only (see lib/db.ts): the gateway owns
 * every write to this database. Each function takes the handle so a test can pass its own.
 * Rows come back as plain data; page components format, they do not query.
 */

export interface AppSummary {
  id: string;
  name: string;
  policyHash: string;
  policyVersion: number;
  createdAt: Date;
  /** Creatives scoped to this app. The shared global catalog (app_id null) is not counted. */
  creativeCount: number;
  /** Audit records for this app, counting each turn once (attested rows supersede in place). */
  turnCount: number;
  /** Timestamp of the app's most recent audit record, or null when it has none yet. */
  lastTurnAt: Date | null;
}

/**
 * Apps with their catalog and audit counts, newest first. Three plain SELECTs joined in
 * memory rather than one query with two joins: counting through a join fans the rows out and
 * the operator list is small.
 */
export const listAppsWithCounts = async (
  db: DashboardDb = dashboardDb(),
): Promise<AppSummary[]> => {
  const [appRows, creativeCounts, turnCounts] = await Promise.all([
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
      .select({ appId: auditRecords.appId, total: count(), lastTs: max(auditRecords.ts) })
      .from(auditRecords)
      .where(eq(auditRecords.isLatest, true))
      .groupBy(auditRecords.appId),
  ]);

  const creativesByApp = new Map(creativeCounts.map((row) => [row.appId, row.total]));
  const turnsByApp = new Map(turnCounts.map((row) => [row.appId, row]));

  return appRows.map((app) => {
    const turns = turnsByApp.get(app.id);
    return {
      ...app,
      creativeCount: creativesByApp.get(app.id) ?? 0,
      turnCount: turns?.total ?? 0,
      lastTurnAt: turns?.lastTs ?? null,
    };
  });
};
