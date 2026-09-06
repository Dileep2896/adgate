import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/** A report id that was never generated, or a stale link. */
const ReportNotFound = () => (
  <section>
    <PageHeader title="No such report" back={{ href: '/reports', label: 'All reports' }} />
    <EmptyState
      title="That report id has not been generated on this gateway."
      testId="report-not-found"
      actions={
        <>
          <Link href="/reports/new" className="ag-btn ag-btn-primary">
            Generate a report
          </Link>
          <Link href="/reports" className="ag-btn">
            All reports
          </Link>
        </>
      }
    >
      Reports are append only: re-running a period writes a new rep_ id beside the old one rather
      than replacing it, so an id that is not here was never generated here.
    </EmptyState>
  </section>
);

export default ReportNotFound;
