import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReportView } from '@/components/report-view';
import { requireSession } from '@/lib/auth';
import { getReport } from '@/lib/report-queries';

/**
 * One stored verification report, in a form that prints.
 *
 * Everything that is not the report itself - the rail, the footer, this toolbar - carries
 * `no-print` (app/globals.css), so Cmd+P produces the document and nothing else, and
 * tokens.css forces the palette back to ink on white for the print medium so an operator
 * working in dark mode still prints a readable sheet. There is no page header here on
 * purpose: the report carries its own, and two <h1>s on one document is one too many.
 *
 * The JSON bundle is a plain link to a route handler rather than a button: it works with
 * JavaScript disabled and the browser saves it as a file (Content-Disposition), which is what
 * an auditor is going to feed to scripts/verify-bundle.ts.
 */

export const dynamic = 'force-dynamic';

const ReportPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  // Another account's report id answers null, and this page renders the same not-found as an id
  // that was never generated.
  const session = await requireSession(`/reports/${id}`);
  const report = await getReport(session.scope, id);
  if (report === null) {
    notFound();
  }

  return (
    <section className="space-y-4">
      <div className="ag-pageheader no-print">
        <Link href="/reports" className="ag-back">
          <span aria-hidden="true">&larr;</span>
          All reports
        </Link>
        <div className="ag-pageheader-actions">
          <a
            href={`/api/reports/${report.id}/bundle`}
            download={`${report.id}.json`}
            data-testid="download-bundle"
            className="ag-btn"
          >
            Download JSON bundle
          </a>
        </div>
      </div>

      <ReportView report={report.document} reportId={report.id} />

      <p className="ag-hint no-print">
        The JSON bundle contains this report, the underlying audit records with the neighbours their
        checks read (a predecessor that belongs to another advertiser is carried as its record_hash
        and app_id only), the creative content behind every content_hash, and the public keys.
        Re-verify it offline with{' '}
        <span className="ag-code">tsx scripts/verify-bundle.ts &lt;file&gt;</span>. Run on its own
        that recomputes every hash and signature against the keys the bundle carries, which shows
        the file is internally consistent - it is not proof that adgate produced it. Add{' '}
        <span className="ag-code">--keys &lt;file&gt;</span> with the operator&apos;s published
        public keys to check that too.
      </p>
    </section>
  );
};

export default ReportPage;
