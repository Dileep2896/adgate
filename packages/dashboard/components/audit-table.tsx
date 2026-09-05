import Link from 'next/link';

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
 */

export interface AuditTableProps {
  page: AuditPage;
  filters: AuditFilters;
  creatives: ReadonlyMap<string, AuditCreativeSummary>;
}

const decisionBadge = (row: AuditPageRow) =>
  row.decision === 'serve' ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      serve
    </span>
  ) : (
    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
      suppress
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
    return <span className="text-stone-400">-</span>;
  }
  if (creative === undefined) {
    // The creatives row is gone; the record still names it, and verify() will say so.
    return <span className="font-mono text-xs text-stone-500">{row.creativeId}</span>;
  }
  return (
    <>
      <span className="font-medium text-stone-900">{creative.advertiser}</span>
      <span className="block text-xs text-stone-500">{creative.headline}</span>
    </>
  );
};

export const AuditTable = ({ page, filters, creatives }: AuditTableProps) => {
  if (page.rows.length === 0) {
    return (
      <div className="card text-sm text-stone-600" data-testid="audit-empty">
        <p className="font-medium text-stone-900">No audit records match this search.</p>
        <p className="mt-1">
          Widen the date range, or clear the decision and reason filters. Records are written by the
          gateway on every{' '}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">POST /v1/evaluate</code>.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead className="border-b border-stone-200 bg-stone-50">
            <tr>
              <th className="table-head">Timestamp</th>
              <th className="table-head">App</th>
              <th className="table-head">Decision</th>
              <th className="table-head">Reason</th>
              <th className="table-head">Creative</th>
              <th className="table-head">Audit id</th>
              <th className="table-head">Seq</th>
              <th className="table-head">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {page.rows.map((row) => (
              <tr key={row.recordHash} data-testid="audit-row">
                <td className="table-cell whitespace-nowrap tabular-nums">
                  {formatTimestamp(row.ts)}
                </td>
                <td className="table-cell">
                  <Link
                    href={`/apps/${row.appId}`}
                    className="underline-offset-2 hover:underline"
                    title={row.appId}
                  >
                    {row.appName ?? row.appId}
                  </Link>
                </td>
                <td className="table-cell" data-testid="audit-decision">
                  {decisionBadge(row)}
                </td>
                <td className="table-cell">
                  {row.reason === null ? (
                    <span className="text-stone-400">-</span>
                  ) : (
                    formatReason(row.reason)
                  )}
                </td>
                <td className="table-cell">
                  <CreativeCell
                    row={row}
                    creative={row.creativeId === null ? undefined : creatives.get(row.creativeId)}
                  />
                </td>
                <td className="table-cell font-mono text-xs">
                  <Link
                    href={`/audit/${row.id}?version=${encodeURIComponent(row.recordHash)}`}
                    className="underline-offset-2 hover:underline"
                    data-testid="audit-link"
                  >
                    {row.id}
                  </Link>
                  <span className="block text-stone-400" title={row.recordHash}>
                    {truncateHash(row.recordHash)}
                  </span>
                </td>
                <td className="table-cell tabular-nums">{row.seq}</td>
                <td className="table-cell" data-testid="audit-version">
                  {row.isLatest ? (
                    <span className="text-xs font-medium text-stone-700">latest</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      superseded
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        className="mt-4 flex items-center justify-between text-sm"
        aria-label="Pagination"
        data-testid="audit-pagination"
      >
        {page.newer === null ? (
          <span className="text-stone-400">Newest records</span>
        ) : (
          <Link
            href={auditHref(filters, page.newer)}
            data-testid="audit-previous"
            className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50"
          >
            &larr; Newer
          </Link>
        )}
        <span className="text-xs text-stone-500">{page.rows.length} records on this page</span>
        {page.older === null ? (
          <span className="text-stone-400">Oldest records</span>
        ) : (
          <Link
            href={auditHref(filters, page.older)}
            data-testid="audit-next"
            className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50"
          >
            Older &rarr;
          </Link>
        )}
      </nav>
    </>
  );
};
