import { AuditFiltersForm } from '@/components/audit-filters';
import { AuditTable } from '@/components/audit-table';
import { parseAuditCursor, parseAuditFilters } from '@/lib/audit-filters';
import { listAuditCreatives } from '@/lib/audit-lookups';
import { listAuditPage, listAuditReasons } from '@/lib/audit-queries';
import { listAppOptions } from '@/lib/creative-queries';

/**
 * The audit search: every signed record the gateway wrote, filtered by app, date range,
 * decision and reason, newest first. Every filter and the page position live in the query
 * string (lib/audit-filters.ts), so the view is a shareable URL.
 *
 * Paging is keyset on (ts, record_hash), never OFFSET: audit_records is the table that grows
 * without bound and an operator paging through it must not pay for the rows already read, nor
 * see a row twice because the gateway wrote one while they were reading (lib/audit-queries.ts).
 *
 * Reads only. Nothing on this page can change a record - the whole point of the chain is that
 * nobody can.
 */

export const dynamic = 'force-dynamic';

const AuditPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const cursor = parseAuditCursor(params);

  const [page, apps, reasons] = await Promise.all([
    listAuditPage(filters, cursor),
    listAppOptions(),
    listAuditReasons(filters),
  ]);
  const creatives = await listAuditCreatives(
    page.rows.flatMap((row) => (row.creativeId === null ? [] : [row.creativeId])),
  );

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
        <p className="mt-1 text-sm text-stone-500">
          Signed records for every evaluated turn. Open one to verify it against the chain.
        </p>
      </div>

      <div className="mb-6">
        <AuditFiltersForm filters={filters} apps={apps} reasons={reasons} />
      </div>

      <AuditTable page={page} filters={filters} creatives={creatives} />
    </section>
  );
};

export default AuditPage;
