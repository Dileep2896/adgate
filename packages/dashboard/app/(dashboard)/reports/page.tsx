import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/auth';
import { formatCount, formatDate, formatPercent, formatTimestamp } from '@/lib/format';
import { listReports } from '@/lib/report-queries';

/**
 * The reports that have been generated, newest first. A report is an artifact that was handed to
 * an advertiser, so the list is append only: nothing here edits or deletes one, and re-running a
 * period produces a new rep_ id beside the old one rather than replacing it.
 *
 * The headline numbers come from the stored document itself (reports.report), not from a fresh
 * query - a report says what it said on the day it was generated.
 *
 * With no reports the table is replaced outright rather than shown with one grey row across
 * eight empty columns: "no reports generated yet" is not a row of data, and an operator who has
 * never generated one needs to be told what a report is and where the button is.
 */

export const dynamic = 'force-dynamic';

const HEAD = [
  'Generated',
  'Advertiser',
  'Period',
  'Records',
  'Impressions',
  'Disclosure',
  'Sensitive',
  'Chain',
] as const;

const ReportsPage = async () => {
  // A report belongs to the account that generated it, not to the advertiser it names: a member's
  // report covers only their own apps' records, so it is a different document from an operator's
  // about the same advertiser and period, and each account sees only its own.
  const session = await requireSession('/reports');
  const reports = await listReports(session.scope);

  return (
    <section>
      <PageHeader
        title="Reports"
        lede="What ran for an advertiser, whether it was disclosed, and whether the chain still verifies."
        actions={
          <Link href="/reports/new" data-testid="new-report" className="ag-btn ag-btn-primary">
            New report
          </Link>
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          title="No reports generated yet."
          testId="no-reports"
          actions={
            <Link href="/reports/new" className="ag-btn ag-btn-primary">
              Generate the first report
            </Link>
          }
        >
          A verification report is the artifact an advertiser can check: every audit record naming
          their creatives in a period, re-verified against the signed chain, with the disclosure and
          separation rates and any sensitive exposure stated in words. It is generated from the
          records, never from a summary table, and it downloads as a JSON bundle anyone can
          re-verify offline.
        </EmptyState>
      ) : (
        <div className="ag-table-scroll">
          <table className="ag-table">
            <thead>
              <tr>
                {HEAD.map((label) => (
                  <th key={label} scope="col" className="table-head">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} data-testid="report-row">
                  <td className="table-cell table-cell-strong table-cell-nowrap">
                    <Link
                      href={`/reports/${report.id}`}
                      data-testid="report-link"
                      className="ag-link-quiet"
                    >
                      {formatTimestamp(report.createdAt)}
                    </Link>
                  </td>
                  <td className="table-cell">
                    <span className="ag-truncate" title={report.advertiserName}>
                      {report.advertiserName}
                    </span>
                  </td>
                  <td className="table-cell ag-mono-2xs table-cell-nowrap">
                    {formatDate(report.periodStart)} to{' '}
                    {formatDate(new Date(report.periodEnd.getTime() - 1))}
                  </td>
                  <td className="table-cell">{formatCount(report.document.totals.records)}</td>
                  <td className="table-cell">{formatCount(report.document.totals.impressions)}</td>
                  <td className="table-cell">
                    {formatPercent(report.document.disclosure_compliance.rate)}
                  </td>
                  <td className="table-cell">
                    {formatCount(report.document.sensitive_exposures.records)}
                  </td>
                  <td className="table-cell" data-testid="report-chain-status">
                    {report.document.chain_integrity.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ReportsPage;
