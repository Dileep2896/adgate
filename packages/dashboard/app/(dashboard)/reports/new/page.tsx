import Link from 'next/link';

import { generateReportAction } from '@/app/(dashboard)/reports/actions';
import { DocRef } from '@/components/doc-ref';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { defaultReportForm, reportFormMessage, type ReportFormValues } from '@/lib/report-form';
import { listReportAdvertisers } from '@/lib/report-queries';
import { verifyKeys } from '@/lib/verify-keys';

/**
 * Generate a verification report: pick an advertiser and a period.
 *
 * A plain form posting to a server action - no client component, no JavaScript - because the
 * work happens on the server anyway and the result is a redirect to the stored report. A refusal
 * comes back as `?error=` with the submitted values, so nothing an operator typed is lost.
 */

export const dynamic = 'force-dynamic';

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const NewReportPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  const advertisers = await listReportAdvertisers();
  // Said BEFORE the operator generates: with no public keys every record fails the signature
  // check and the report reads BROKEN for a configuration reason (lib/verify-keys.ts). The
  // generated document repeats it, so a report that is sent on carries the caveat with it.
  const keyIssue = verifyKeys().issue;
  const defaults = defaultReportForm();
  const submitted: ReportFormValues = {
    advertiserId: one(params['advertiser']),
    from: one(params['from']) || defaults.from,
    to: one(params['to']) || defaults.to,
  };
  const message = reportFormMessage(one(params['error']) || null);

  return (
    <section className="space-y-6">
      <PageHeader
        title="New verification report"
        back={{ href: '/reports', label: 'All reports' }}
        lede="Every audit record referencing this advertiser’s creatives in the period is loaded, verified against the signed chain, and aggregated into one document."
      />

      {keyIssue === null ? null : (
        <p data-testid="report-key-issue" className="ag-note ag-note-warn">
          <span className="ag-badge ag-badge-warn">Keys</span>{' '}
          <strong className="ag-note-strong">Signatures cannot be checked</strong>: {keyIssue}. A
          report generated now will fail the signature check on every record and will say so.
          Configuring the public keys is in <DocRef doc="deploy" />.
        </p>
      )}

      {message === null ? null : (
        <p data-testid="report-form-error" role="alert" className="ag-note ag-note-danger">
          {message}
        </p>
      )}

      {advertisers.length === 0 ? (
        <EmptyState
          title="There are no advertisers yet."
          testId="no-advertisers"
          actions={
            <Link href="/creatives/new" className="ag-btn ag-btn-primary">
              Add a creative
            </Link>
          }
        >
          An advertiser is created by the first creative that names it, and a report is always about
          one advertiser: their creatives, their records, their period. Add a creative first and
          this form will have something to report on.
        </EmptyState>
      ) : (
        <form action={generateReportAction} className="card ag-filters">
          <div>
            <label htmlFor="advertiser" className="ag-label">
              Advertiser
            </label>
            <select
              id="advertiser"
              name="advertiser"
              defaultValue={submitted.advertiserId}
              className="ag-input ag-input-auto mt-1"
            >
              <option value="">Choose an advertiser</option>
              {advertisers.map((advertiser) => (
                <option key={advertiser.id} value={advertiser.id}>
                  {advertiser.name} ({advertiser.domain})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="from" className="ag-label">
              From (UTC)
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={submitted.from}
              className="ag-input ag-input-auto mt-1"
            />
          </div>

          <div>
            <label htmlFor="to" className="ag-label">
              To (UTC, inclusive)
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={submitted.to}
              className="ag-input ag-input-auto mt-1"
            />
          </div>

          <div className="ag-filters-actions">
            <button type="submit" data-testid="generate-report" className="ag-btn ag-btn-primary">
              Generate
            </button>
            <Link href="/reports" className="ag-link-quiet text-xs">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </section>
  );
};

export default NewReportPage;
