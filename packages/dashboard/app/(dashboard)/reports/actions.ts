'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession, sessionOwnerId } from '@/lib/auth';
import { dashboardWriteDb } from '@/lib/db-write';
import { dashboardEnv } from '@/lib/env';
import { parseReportForm, readReportForm } from '@/lib/report-form';
import { generateReport } from '@/lib/report-generate';
import { listReportAdvertisers } from '@/lib/report-queries';
import { createReportWriter } from '@/lib/report-store';
import { visibleAppIds } from '@/lib/scope-queries';

/**
 * Generating a verification report. The third module allowed to import lib/db-write.ts
 * (lib/db-write-usage.test.ts holds the list): reading the records is the read-only handle's
 * job, and the single INSERT into `reports` is not.
 *
 * A server action is a POST to the page's own URL and does NOT render the layout, so
 * requireSession() in app/(dashboard)/layout.tsx does not protect it - this calls it itself.
 *
 * Generation is synchronous on purpose. It reads at most MAX_REPORT_RECORDS records and verifies
 * each one, which is a second or two of work, and adgate adds no queue (CLAUDE.md: no new
 * infrastructure). An operator waits for the page; nothing is left half written, because the
 * document is computed in full before the one INSERT that stores it.
 */

const back = (error: string, values: { advertiserId: string; from: string; to: string }): never => {
  const params = new URLSearchParams({
    error,
    advertiser: values.advertiserId,
    from: values.from,
    to: values.to,
  });
  redirect(`/reports/new?${params.toString()}`);
};

export const generateReportAction = async (formData: FormData): Promise<void> => {
  const session = await requireSession();
  const values = readReportForm(formData);
  const advertisers = await listReportAdvertisers();
  const parsed = parseReportForm(
    values,
    advertisers.map((advertiser) => advertiser.id),
  );
  if (!parsed.ok) {
    back(parsed.error, values);
    return;
  }

  const advertiser = advertisers.find((row) => row.id === parsed.range.advertiserId);
  if (advertiser === undefined) {
    back('advertiser_unknown', values);
    return;
  }

  let reportId: string;
  try {
    const result = await generateReport(
      {
        advertiser,
        since: parsed.range.since,
        until: parsed.range.until,
        // The records a MEMBER may report on are their own apps' - an advertiser's creatives can
        // have served somebody else's app too, and those turns are nobody else's business.
        appIds: await visibleAppIds(session.scope),
        ownerUserId: sessionOwnerId(session),
      },
      createReportWriter(dashboardWriteDb(dashboardEnv().databaseUrl)),
    );
    reportId = result.id;
  } catch {
    // Never the underlying error: it can name rows and connection strings.
    back('generate_failed', parsed.range.values);
    return;
  }

  revalidatePath('/reports');
  // The "advertisers with a generated report" number on /apps has just changed.
  revalidatePath('/apps');
  redirect(`/reports/${reportId}`);
};
