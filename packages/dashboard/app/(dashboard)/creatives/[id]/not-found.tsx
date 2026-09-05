import Link from 'next/link';

/** A creative id that is not in the catalog - a stale bookmark, or a row removed in SQL. */
const CreativeNotFound = () => (
  <section>
    <h1 className="text-2xl font-semibold tracking-tight">No such creative</h1>
    <p className="mt-2 text-sm text-stone-600">
      That creative id is not in this gateway&apos;s catalog.{' '}
      <Link href="/creatives" className="underline underline-offset-2">
        Back to creatives
      </Link>
      .
    </p>
  </section>
);

export default CreativeNotFound;
