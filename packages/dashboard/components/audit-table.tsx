import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { type AuditFilters, auditHref } from '@/lib/audit-filters';
import type { AuditCreativeSummary } from '@/lib/audit-lookups';
import type { AuditPage, AuditPageRow } from '@/lib/audit-queries';
import { formatReason, formatTimestamp, truncateHash } from '@/lib/format';

/**
 * The audit search results, newest first, with keyset Previous/Next links. Each row links to
 * its own detail page, where verify() runs live.
 *
 * The "latest" column is not decoration: attestation writes a SECOND record for the same audit
 * id (docs/audit.md), and only one of them is the version the API serves. A superseded row is
 * marked so an operator never reads an old version thinking it is the current one.
 *
 * COLUMN PRIORITY. Timestamp, decision, reason, the audit id and whether it is the latest
 * version ARE the search, so those five never leave. The app qualifies it at 48rem; the
 * creative and the sequence number only at 96rem. The id and the record hash truncate with
 * the whole value on the title attribute - the detail page is one click away and copies both -
 * so a row is always one line and the page body never moves sideways.
 */

export interface AuditTableProps {
  page: AuditPage;
  filters: AuditFilters;
  creatives: ReadonlyMap<string, AuditCreativeSummary>;
}

const decisionBadge = (row: AuditPageRow) => (
  <span className={row.decision === 'serve' ? 'ag-badge ag-badge-accent' : 'ag-badge'}>
    {row.decision}
  </span>
);

const CreativeCell = ({
  row,
  creative,
}: {
  row: AuditPageRow;
  creative: AuditCreativeSummary | undefined;
}) => {
  if (row.creativeId === null) {
    return <span aria-hidden="true">-</span>;
  }
  if (creative === undefined) {
    // The creatives row is gone; the record still names it, and verify() will say so.
    return <span className="ag-mono-2xs">{row.creativeId}</span>;
  }
  return (
    <>
      <span className="table-cell-strong ag-truncate" title={creative.advertiser}>
        {creative.advertiser}
      </span>
      <span className="ag-truncate text-xs" title={creative.headline}>
        {creative.headline}
      </span>
    </>
  );
};

export const AuditTable = ({ page, filters, creatives }: AuditTableProps) => {
  if (page.rows.length === 0) {
    return (
      <EmptyState
        title="No audit records match this search."
        testId="audit-empty"
        actions={
          <Link href="/audit" className="ag-btn">
            Clear the filters
          </Link>
        }
      >
        Widen the date range, or clear the decision and reason filters above. The gateway writes one
        record on every <span className="ag-code">POST /v1/evaluate</span>, suppressions included -
        so a range with nothing in it means no turns were evaluated then, not that the records were
        lost. An app that has never been called has no records at all; its page says so under
        Integration.
      </EmptyState>
    );
  }
  return (
    <>
      <div className="ag-table-scroll">
        <table className="ag-table">
          <thead>
            <tr>
              <th scope="col" className="table-head">
                Timestamp
              </th>
              <th scope="col" className="table-head max-md:hidden">
                App
              </th>
              <th scope="col" className="table-head">
                Decision
              </th>
              <th scope="col" className="table-head">
                Reason
              </th>
              <th scope="col" className="table-head max-2xl:hidden">
                Creative
              </th>
              <th scope="col" className="table-head">
                Audit id
              </th>
              <th scope="col" className="table-head max-2xl:hidden">
                Seq
              </th>
              <th scope="col" className="table-head">
                Version
              </th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.recordHash} data-testid="audit-row">
                <td className="table-cell ag-mono-2xs table-cell-nowrap">
                  {formatTimestamp(row.ts)}
                </td>
                <td className="table-cell max-md:hidden">
                  <Link href={`/apps/${row.appId}`} className="ag-link-quiet" title={row.appId}>
                    <span className="ag-truncate ag-truncate-sm">{row.appName ?? row.appId}</span>
                  </Link>
                </td>
                <td className="table-cell" data-testid="audit-decision">
                  {decisionBadge(row)}
                </td>
                <td className="table-cell">
                  {row.reason === null ? (
                    <span aria-hidden="true">-</span>
                  ) : (
                    <span className="ag-truncate ag-truncate-sm" title={row.reason}>
                      {formatReason(row.reason)}
                    </span>
                  )}
                </td>
                <td className="table-cell max-2xl:hidden">
                  <CreativeCell
                    row={row}
                    creative={row.creativeId === null ? undefined : creatives.get(row.creativeId)}
                  />
                </td>
                <td className="table-cell ag-mono-2xs">
                  <Link
                    href={`/audit/${row.id}?version=${encodeURIComponent(row.recordHash)}`}
                    className="ag-link-quiet"
                    data-testid="audit-link"
                  >
                    <span className="ag-truncate ag-truncate-sm" title={row.id}>
                      {row.id}
                    </span>
                  </Link>
                  <span className="ag-truncate ag-truncate-sm" title={row.recordHash}>
                    {truncateHash(row.recordHash)}
                  </span>
                </td>
                <td className="table-cell max-2xl:hidden">{row.seq}</td>
                <td className="table-cell" data-testid="audit-version">
                  {row.isLatest ? (
                    <span className="ag-badge">latest</span>
                  ) : (
                    <span className="ag-badge ag-badge-warn">superseded</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        className="mt-4 flex flex-wrap items-center justify-between gap-3"
        aria-label="Pagination"
        data-testid="audit-pagination"
      >
        {page.newer === null ? (
          <span className="ag-section-hint">Newest records</span>
        ) : (
          <Link
            href={auditHref(filters, page.newer)}
            data-testid="audit-previous"
            className="ag-btn"
          >
            <span aria-hidden="true">&larr;</span> Newer
          </Link>
        )}
        <span className="ag-section-hint">{page.rows.length} records on this page</span>
        {page.older === null ? (
          <span className="ag-section-hint">Oldest records</span>
        ) : (
          <Link href={auditHref(filters, page.older)} data-testid="audit-next" className="ag-btn">
            Older <span aria-hidden="true">&rarr;</span>
          </Link>
        )}
      </nav>
    </>
  );
};
