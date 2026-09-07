import { advertisers, apps, auditRecords, creatives } from '@adgateio/gateway/schema';
import { asc, eq, inArray } from 'drizzle-orm';

import { type DashboardDb, dashboardDb } from './db';

/**
 * The small by-id reads the audit pages need around the search itself: the creatives a page of
 * results points at, every stored version of one audit id, and an app's name. Reads only
 * (lib/db.ts). The search query, which is the one with an obligation about its plan, lives next
 * door in lib/audit-queries.ts.
 */

/* -------------------------------------------------------------- creatives of a page --- */

export interface AuditCreativeSummary {
  id: string;
  headline: string;
  advertiser: string;
  advertiserDomain: string;
  contentHash: string;
}

/**
 * The creatives the rows on this page point at, by id. A separate small query rather than a
 * join on the paged one: the search must stay a plain indexed walk of audit_records, and this
 * looks up at most one row per rendered line.
 */
export const listAuditCreatives = async (
  ids: readonly string[],
  db: DashboardDb = dashboardDb(),
): Promise<Map<string, AuditCreativeSummary>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: creatives.id,
      headline: creatives.headline,
      advertiser: advertisers.name,
      advertiserDomain: advertisers.domain,
      contentHash: creatives.contentHash,
    })
    .from(creatives)
    .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
    .where(inArray(creatives.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
};

/* ------------------------------------------------------------- versions of one id --- */

export interface AuditVersionSummary {
  recordHash: string;
  seq: number;
  isLatest: boolean;
  supersedesHash: string | null;
  ts: Date;
  attestRendered: boolean | null;
}

/**
 * Every stored version of one audit id, oldest first. Attestation writes a SECOND row with the
 * same id (S19), so an id has one or two of these and the detail page offers a switcher.
 * Reached through audit_records_id_idx.
 */
export const listAuditVersions = async (
  auditId: string,
  db: DashboardDb = dashboardDb(),
): Promise<AuditVersionSummary[]> =>
  db
    .select({
      recordHash: auditRecords.recordHash,
      seq: auditRecords.seq,
      isLatest: auditRecords.isLatest,
      supersedesHash: auditRecords.supersedesHash,
      ts: auditRecords.ts,
      attestRendered: auditRecords.attestRendered,
    })
    .from(auditRecords)
    .where(eq(auditRecords.id, auditId))
    .orderBy(asc(auditRecords.seq));

/** One app's name, for the detail header. */
export const appNameOf = async (
  appId: string,
  db: DashboardDb = dashboardDb(),
): Promise<string | null> => {
  const [row] = await db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId)).limit(1);
  return row?.name ?? null;
};
