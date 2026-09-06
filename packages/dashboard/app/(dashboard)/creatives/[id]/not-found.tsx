import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/** A creative id that is not in the catalog - a stale bookmark, or a row removed in SQL. */
const CreativeNotFound = () => (
  <section>
    <PageHeader title="No such creative" back={{ href: '/creatives', label: 'All creatives' }} />
    <EmptyState
      title="That creative id is not in this gateway’s catalog."
      testId="creative-not-found"
      actions={
        <Link href="/creatives" className="ag-btn ag-btn-primary">
          Back to creatives
        </Link>
      }
    >
      A creative is never deleted by the dashboard, only deactivated, because audit records name
      creative ids and verification recomputes the content hash of the stored row. A row that has
      gone anyway leaves those records unverifiable on the creative_hash check.
    </EmptyState>
  </section>
);

export default CreativeNotFound;
