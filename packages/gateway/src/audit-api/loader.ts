import { creativeContentHash } from '@adgateio/core';
import { and, eq, type SQL } from 'drizzle-orm';

import type { AuditRecordRow } from '../attest/store.js';
import type { Db } from '../db/client.js';
import { advertisers } from '../db/tables/apps.js';
import { auditRecords } from '../db/tables/audit.js';
import { creatives } from '../db/tables/catalog.js';
import { readRetentionState } from '../retention/queries.js';

/**
 * The reads behind GET /v1/audit/:id and GET /v1/verify/:id (docs/api.md): one version of an
 * audit id (the is_latest row, or the row whose record_hash is the requested ?version=) with
 * what authorization needs to know about it, and the neighbours verify needs (the app's row at
 * a chain position, a row by hash, the latest row of an id) plus the stored creative's content
 * hash. Read only; the routes never write.
 */
export interface AuditVersion {
  row: AuditRecordRow;
  /**
   * advertisers.id of the creatives row the record names (audit_records.creative_id joined to
   * creatives.advertiser_id); null for a suppress record or when the creatives row is gone.
   * An advertiser_read key may see the record only when this is its advertiser.
   */
  creativeAdvertiserId: string | null;
}

export interface AuditVersionQuery {
  auditId: string;
  /** A record_hash selecting one stored version of the id; undefined = the latest (is_latest). */
  version?: string | undefined;
}

/**
 * How far the retention job (S37) has pruned an app's chain: every position at or below
 * `prunedThroughSeq` was deleted on purpose, and every record it kept post-dates `prunedBefore`.
 * verify-context.ts needs both to tell a pruned predecessor from a missing one.
 */
export interface RetentionWatermark {
  prunedBefore: Date;
  prunedThroughSeq: number;
}

export interface AuditReader {
  findVersion(query: AuditVersionQuery): Promise<AuditVersion | null>;
  /** The is_latest row of an id, whichever app owns it. */
  findLatest(auditId: string): Promise<AuditRecordRow | null>;
  findByHash(recordHash: string): Promise<AuditRecordRow | null>;
  /** The app's row at a chain position; null when it was never written or has been deleted. */
  findBySeq(appId: string, seq: number): Promise<AuditRecordRow | null>;
  /** creativeContentHash over the stored creatives row joined with its advertiser; null when gone. */
  creativeHash(creativeId: string): Promise<string | null>;
  /** The app's retention watermark, or null when the job has never pruned it. */
  retentionWatermark(appId: string): Promise<RetentionWatermark | null>;
}

export const createAuditReader = (db: Db): AuditReader => {
  const one = async (condition: SQL | undefined): Promise<AuditRecordRow | null> => {
    const [row] = await db.select().from(auditRecords).where(condition).limit(1);
    return row ?? null;
  };
  return {
    findVersion: async ({ auditId, version }) => {
      const selector =
        version === undefined
          ? eq(auditRecords.isLatest, true)
          : eq(auditRecords.recordHash, version);
      const [row] = await db
        .select({ row: auditRecords, creativeAdvertiserId: creatives.advertiserId })
        .from(auditRecords)
        .leftJoin(creatives, eq(auditRecords.creativeId, creatives.id))
        .where(and(eq(auditRecords.id, auditId), selector))
        .limit(1);
      return row ?? null;
    },
    findLatest: (auditId) =>
      one(and(eq(auditRecords.id, auditId), eq(auditRecords.isLatest, true))),
    findByHash: (recordHash) => one(eq(auditRecords.recordHash, recordHash)),
    findBySeq: (appId, seq) => one(and(eq(auditRecords.appId, appId), eq(auditRecords.seq, seq))),
    retentionWatermark: async (appId) => {
      const row = await readRetentionState(db, appId);
      return row === null
        ? null
        : { prunedBefore: row.prunedBefore, prunedThroughSeq: row.prunedThroughSeq };
    },
    creativeHash: async (creativeId) => {
      const [row] = await db
        .select({ creative: creatives, advertiser: advertisers })
        .from(creatives)
        .innerJoin(advertisers, eq(creatives.advertiserId, advertisers.id))
        .where(eq(creatives.id, creativeId))
        .limit(1);
      if (row === undefined) {
        return null;
      }
      return creativeContentHash({
        advertiser: row.advertiser.name,
        advertiser_domain: row.advertiser.domain,
        headline: row.creative.headline,
        body: row.creative.body,
        cta: row.creative.cta,
        url_template: row.creative.urlTemplate,
      });
    },
  };
};
