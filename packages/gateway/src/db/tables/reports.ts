import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { advertisers } from './apps.js';
import { createdAt, timestamptz } from './columns.js';

/**
 * Verification reports generated for an advertiser (docs/BUILD_GUIDE.md Phase 8, story S35).
 *
 * The table exists from S32 because the dashboard's global header counts "advertisers with at
 * least one generated report" - one of the six numbers the project tracks - and a metric backed
 * by a table that does not exist is not a metric. S32 only ever reads it
 * (`select count(distinct advertiser_id) from reports`); S35 owns the writes and the shape of
 * the `report` document, which is deliberately an opaque jsonb here so that story can define it
 * without a migration.
 *
 * Ids are prefixed ULIDs: `rep_`.
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    advertiserId: text('advertiser_id')
      .notNull()
      .references(() => advertisers.id),
    /** Inclusive start of the reported window. */
    periodStart: timestamptz('period_start').notNull(),
    /** Exclusive end of the reported window. */
    periodEnd: timestamptz('period_end').notNull(),
    /** The generated report document. S35 defines its contract; nothing here reads inside it. */
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('reports_advertiser_id_created_at_idx').on(table.advertiserId, table.createdAt),
  ],
);

/** A row of `reports` as SELECT returns it. */
export type ReportRow = typeof reports.$inferSelect;
