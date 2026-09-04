import Link from 'next/link';

/** An app id that is not in the database - a stale bookmark, or an app someone deleted in SQL. */
const AppNotFound = () => (
  <section>
    <h1 className="text-2xl font-semibold tracking-tight">No such app</h1>
    <p className="mt-2 text-sm text-stone-600">
      That app id is not registered against this gateway.{' '}
      <Link href="/apps" className="underline underline-offset-2">
        Back to apps
      </Link>
      .
    </p>
  </section>
);

export default AppNotFound;
