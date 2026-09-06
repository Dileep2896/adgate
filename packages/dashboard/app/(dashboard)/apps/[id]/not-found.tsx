import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/** An app id that is not in the database - a stale bookmark, or an app someone deleted in SQL. */
const AppNotFound = () => (
  <section>
    <PageHeader title="No such app" back={{ href: '/apps', label: 'All apps' }} />
    <EmptyState
      title="That app id is not registered against this gateway."
      testId="app-not-found"
      actions={
        <Link href="/apps" className="ag-btn ag-btn-primary">
          Back to apps
        </Link>
      }
    >
      Either the link is stale, or the row was removed in SQL. Nothing has been changed: an app id
      that is gone still appears inside every audit record that named it, and those records still
      verify.
    </EmptyState>
  </section>
);

export default AppNotFound;
