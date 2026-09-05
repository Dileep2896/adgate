import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReportView } from '@/components/report-view';
import { getReport } from '@/lib/report-queries';

/**
 * One stored verification report, in a form that prints.
 *
 * Everything that is not the report itself - the nav, the footer, this toolbar - carries
 * `no-print` (app/globals.css), so Cmd+P produces the document and nothing else. The JSON bundle
 * is a plain link to a route handler rather than a button: it works with JavaScript disabled and
 * the browser saves it as a file (Content-Disposition), which is what an auditor is going to
 * feed to scripts/verify-bundle.ts.
 */

export const dynamic = 'force-dynamic';

const BUTTON =
  'rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:border-stone-900 hover:text-stone-900';

const ReportPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const report = await getReport(id);
  if (report === null) {
    notFound();
  }

  return (
    <section className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/reports" className="text-sm text-stone-500 underline-offset-2 hover:underline">
          &larr; All reports
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={`/api/reports/${report.id}/bundle`}
            download={`${report.id}.json`}
            data-testid="download-bundle"
            className={BUTTON}
          >
            Download JSON bundle
          </a>
        </div>
      </div>

      <ReportView report={report.document} reportId={report.id} />

      <p className="no-print text-xs text-stone-400">
        The JSON bundle contains this report, the underlying audit records with the neighbours their
        checks read, the creative content behind every content_hash, and the public keys. Re-verify
        it offline with <code className="font-mono">tsx scripts/verify-bundle.ts &lt;file&gt;</code>
        .
      </p>
    </section>
  );
};

export default ReportPage;
