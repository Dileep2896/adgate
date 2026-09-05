import Link from 'next/link';

/** A report id that was never generated, or a stale link. */
const ReportNotFound = () => (
  <section>
    <h1 className="text-2xl font-semibold tracking-tight">No such report</h1>
    <p className="mt-2 text-sm text-stone-600">
      That report id has not been generated on this gateway.{' '}
      <Link href="/reports" className="underline underline-offset-2">
        Back to reports
      </Link>
      .
    </p>
  </section>
);

export default ReportNotFound;
