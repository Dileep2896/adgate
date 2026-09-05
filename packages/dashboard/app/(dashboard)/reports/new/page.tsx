import Link from 'next/link';

import { generateReportAction } from '@/app/(dashboard)/reports/actions';
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

const CONTROL =
  'rounded-md border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-900';
const LABEL = 'block text-xs font-medium text-stone-500 uppercase';

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New verification report</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every audit record referencing this advertiser&apos;s creatives in the period is loaded,
          verified with the signed chain, and aggregated into one report.
        </p>
      </div>

      {keyIssue === null ? null : (
        <p
          data-testid="report-key-issue"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Signatures cannot be checked: {keyIssue}. A report generated now will fail the signature
          check on every record and will say so.
        </p>
      )}

      {message === null ? null : (
        <p
          data-testid="report-form-error"
          className="rounded-md border border-stone-900 bg-stone-900 px-4 py-3 text-sm text-white"
        >
          {message}
        </p>
      )}

      {advertisers.length === 0 ? (
        <p data-testid="no-advertisers" className="card text-sm text-stone-500">
          There are no advertisers yet. Add a creative on{' '}
          <Link href="/creatives/new" className="underline underline-offset-2">
            /creatives
          </Link>{' '}
          first.
        </p>
      ) : (
        <form action={generateReportAction} className="card flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="advertiser" className={LABEL}>
              Advertiser
            </label>
            <select
              id="advertiser"
              name="advertiser"
              defaultValue={submitted.advertiserId}
              className={`mt-1 ${CONTROL}`}
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
            <label htmlFor="from" className={LABEL}>
              From (UTC)
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={submitted.from}
              className={`mt-1 ${CONTROL}`}
            />
          </div>

          <div>
            <label htmlFor="to" className={LABEL}>
              To (UTC, inclusive)
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={submitted.to}
              className={`mt-1 ${CONTROL}`}
            />
          </div>

          <button
            type="submit"
            data-testid="generate-report"
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            Generate
          </button>
          <Link
            href="/reports"
            className="pb-2 text-sm text-stone-600 underline-offset-2 hover:underline"
          >
            Cancel
          </Link>
        </form>
      )}
    </section>
  );
};

export default NewReportPage;
