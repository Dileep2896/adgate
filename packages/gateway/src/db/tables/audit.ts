import type { AuditRecord, Decision, EventType } from '@adgate/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { apps } from './apps.js';
import { createdAt, sqlList, timestamptz } from './columns.js';

/**
 * The signed audit log (docs/audit.md). The signed JSON is the source of truth in `record`;
 * the other columns are copies for lookups and reports and must never be edited on their
 * own. Attestation writes a SECOND row with the same `id` and a new record_hash (S15), so the
 * primary key is record_hash and `is_latest` marks the version the API serves. `seq` is the
 * record's position in its app's chain (1, 2, 3...; attested rows take the next one too): the
 * positional predecessor verify() needs is the row at seq - 1, and the latest record is the
 * highest seq. Appends are serialised per app by locking the apps row (evaluate/audit-store.ts).
 *
 * Table modules import @adgate/schemas as types only: drizzle-kit loads them through a CJS
 * hook that cannot resolve the ESM-only workspace packages. The value lists below mirror the
 * contract enums and schema.test.ts pins them to Decision.options and EventType.options.
 */

export const AUDIT_DECISIONS = ['serve', 'suppress'] as const satisfies readonly Decision[];
export const EVENT_TYPES = [
  'impression',
  'click',
  'dismiss',
  'conversion',
] as const satisfies readonly EventType[];

export const auditRecords = pgTable(
  'audit_records',
  {
    recordHash: text('record_hash').primaryKey(),
    /** The aud_ id. Not unique: an attested record shares it with the row it supersedes. */
    id: text('id').notNull(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    /** 1-based position in the app's chain; unique per app. The predecessor is seq - 1. */
    seq: integer('seq').notNull(),
    /** record_hash of the previous record for the app, or the literal genesis. */
    prevHash: text('prev_hash').notNull(),
    supersedesHash: text('supersedes_hash'),
    isLatest: boolean('is_latest').notNull().default(true),
    decision: text('decision', { enum: AUDIT_DECISIONS }).notNull(),
    reason: text('reason'),
    creativeId: text('creative_id'),
    advertiserId: text('advertiser_id'),
    ts: timestamptz('ts').notNull(),
    record: jsonb('record').$type<AuditRecord>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_records_app_id_ts_idx').on(table.appId, table.ts),
    index('audit_records_id_idx').on(table.id),
    index('audit_records_app_id_is_latest_idx').on(table.appId, table.isLatest),
    index('audit_records_advertiser_id_ts_idx').on(table.advertiserId, table.ts),
    uniqueIndex('audit_records_one_latest_per_id_uidx')
      .on(table.id)
      .where(sql`is_latest = true`),
    uniqueIndex('audit_records_app_id_seq_uidx').on(table.appId, table.seq),
    check('audit_records_decision_check', sql`${table.decision} in (${sqlList(AUDIT_DECISIONS)})`),
  ],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    /** The aud_ id the event belongs to (no FK: audit_records is keyed by record_hash). */
    auditId: text('audit_id').notNull(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    ts: timestamptz('ts').notNull(),
    meta: jsonb('meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (table) => [
    index('events_audit_id_idx').on(table.auditId),
    index('events_app_id_ts_idx').on(table.appId, table.ts),
    // docs/api.md: duplicate impressions for the same audit_id are ignored.
    uniqueIndex('events_one_impression_per_audit_uidx')
      .on(table.auditId)
      .where(sql`type = 'impression'`),
    check('events_type_check', sql`${table.type} in (${sqlList(EVENT_TYPES)})`),
  ],
);

/**
 * Conversation text, only when policy.privacy.store_raw_text is true (docs/audit.md: kept
 * outside the signed record). Retention (retain_days) deletes from here first.
 */
export const rawText = pgTable('raw_text', {
  auditId: text('audit_id').primaryKey(),
  appId: text('app_id')
    .notNull()
    .references(() => apps.id),
  text: text('text').notNull(),
  createdAt: createdAt(),
});
