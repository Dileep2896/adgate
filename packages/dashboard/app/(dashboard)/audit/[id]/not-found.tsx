import Link from 'next/link';

/**
 * An audit id (or a `?version=` record_hash) that is not in the chain: a stale link, a typo, or
 * an id the gateway returned when it could not persist the record at all (S18 fail-closed path).
 */
const AuditNotFound = () => (
  <section>
    <h1 className="text-2xl font-semibold tracking-tight">No such audit record</h1>
    <p className="mt-2 text-sm text-stone-600">
      No stored record matches that id and version.{' '}
      <Link href="/audit" className="underline underline-offset-2">
        Back to audit
      </Link>
      .
    </p>
  </section>
);

export default AuditNotFound;
