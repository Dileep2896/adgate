import Link from 'next/link';

import { formatCount, formatPercent, formatTimestamp } from '@/lib/format';
import { listReports } from '@/lib/report-queries';

/**
 * The reports that have been generated, newest first. A report is an artifact that was handed to
 * an advertiser, so the list is append only: nothing here edits or deletes one, and re-running a
 * period produces a new rep_ id beside the old one rather than replacing it.
 *
 * The headline numbers come from the stored document itself (reports.report), not from a fresh
 * query - a report says what it said on the day it was generated.
 */

export const dynamic = 'force-dynamic';

const ReportsPage = async () => {
  const reports = await listReports();

  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-stone-500">
            Verification reports: what ran for an advertiser, whether it was disclosed, and whether
            the chain still verifies.
          </p>
        </div>
        <Link
          href="/reports/new"
          data-testid="new-report"
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New report
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              {[
                'Generated',
                'Advertiser',
                'Period',
                'Records',
                'Impressions',
                'Disclosure',
                'Sensitive',
                'Chain',
              ].map((label) => (
                <th key={label} scope="col" className="table-head">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {reports.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-cell text-stone-400" data-testid="no-reports">
                  No reports generated yet.
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id} data-testid="report-row">
                  <td className="table-cell whitespace-nowrap">
                    <Link
                      href={`/reports/${report.id}`}
                      data-testid="report-link"
                      className="font-medium text-stone-900 underline-offset-2 hover:underline"
                    >
                      {formatTimestamp(report.createdAt)}
                    </Link>
                  </td>
                  <td className="table-cell">{report.advertiserName}</td>
                  <td className="table-cell whitespace-nowrap text-xs text-stone-500">
                    {report.periodStart.toISOString().slice(0, 10)} to{' '}
                    {new Date(report.periodEnd.getTime() - 1).toISOString().slice(0, 10)}
                  </td>
                  <td className="table-cell tabular-nums">
                    {formatCount(report.document.totals.records)}
                  </td>
                  <td className="table-cell tabular-nums">
                    {formatCount(report.document.totals.impressions)}
                  </td>
                  <td className="table-cell tabular-nums">
                    {formatPercent(report.document.disclosure_compliance.rate)}
                  </td>
                  <td className="table-cell tabular-nums">
                    {formatCount(report.document.sensitive_exposures.records)}
                  </td>
                  <td className="table-cell" data-testid="report-chain-status">
                    {report.document.chain_integrity.status}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ReportsPage;
