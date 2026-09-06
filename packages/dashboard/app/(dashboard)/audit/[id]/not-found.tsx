import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/**
 * An audit id (or a `?version=` record_hash) that is not in the chain: a stale link, a typo, or
 * an id the gateway returned when it could not persist the record at all (S18 fail-closed path).
 */
const AuditNotFound = () => (
  <section>
    <PageHeader
      title="No such audit record"
      back={{ href: '/audit', label: 'All audit records' }}
    />
    <EmptyState
      title="No stored record matches that id and version."
      testId="audit-not-found"
      actions={
        <Link href="/audit" className="ag-btn ag-btn-primary">
          Search the audit chain
        </Link>
      }
    >
      Three things look like this: a stale link, a mistyped{' '}
      <span className="ag-code">?version=</span> record hash, and an audit id the gateway handed
      back on a turn it could not persist at all - the fail-closed path, where the ad was suppressed
      and no record was written. Searching for the app and the minute is the quickest way to tell
      them apart.
    </EmptyState>
  </section>
);

export default AuditNotFound;
