import { prefixedUlid } from '@adgate/core';
import type { Db } from '@adgate/gateway/admin';
import { reports } from '@adgate/gateway/schema';

import type { ReportDocument } from './report';

/**
 * The one write /reports makes: an INSERT into `reports` (the table S32 added so the
 * "advertisers with a generated report" metric on /apps counts something real).
 *
 * It is a PORT, like lib/creative-store.ts: the pure generator (lib/report-generate.ts) talks to
 * a ReportWriter and nothing else, so it can be exercised without a database, and the read-write
 * handle (lib/db-write.ts) stays reachable only from the server action.
 *
 * A report is APPEND ONLY. Nothing updates or deletes a row here: a generated report is an
 * artifact that was handed to an advertiser, and re-running the same period writes a new one
 * with its own rep_ id and created_at rather than rewriting history.
 */

export interface SaveReportInput {
  advertiserId: string;
  /** Inclusive start of the period. */
  periodStart: Date;
  /** Exclusive end of the period. */
  periodEnd: Date;
  document: ReportDocument;
}

export interface ReportWriter {
  /** Stores one report and returns its rep_ id. */
  save(input: SaveReportInput): Promise<string>;
}

export const createReportWriter = (db: Db): ReportWriter => ({
  save: async (input) => {
    const id = prefixedUlid('rep_');
    await db.insert(reports).values({
      id,
      advertiserId: input.advertiserId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      report: input.document as unknown as Record<string, unknown>,
    });
    return id;
  },
});
