import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AuditChain } from '@/components/audit-chain';
import { AuditRecordView } from '@/components/audit-record-view';
import { CopyButton } from '@/components/copy-button';
import { VerifyChecks } from '@/components/verify-checks';
import { loadAuditDetail } from '@/lib/audit-detail';
import { formatTimestamp, truncateHash } from '@/lib/format';

/**
 * One audit record: the signed document, where it sits in its app's chain, and the LIVE result
 * of core's verify() over it - all eight docs/audit.md checks, computed on this request against
 * the record exactly as it is stored.
 *
 * `?version=<record_hash>` selects one stored version of the id, the same parameter the
 * gateway's GET /v1/audit/:id takes. Without it the latest version is shown.
 *
 * Everything here happens on the server: @adgate/core is a Node package and the components
 * receive plain computed data (lib/audit-detail.ts).
 */

export const dynamic = 'force-dynamic';

const AuditDetailPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { id } = await params;
  const query = await searchParams;
  const requested = query['version'];
  const version = Array.isArray(requested) ? requested[0] : requested;

  const detail = await loadAuditDetail({ auditId: id, version });
  if (detail === null) {
    notFound();
  }

  return (
    <section className="space-y-8">
      <div>
        <Link href="/audit" className="text-sm text-stone-500 underline-offset-2 hover:underline">
          &larr; Audit
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight" data-testid="audit-id">
          {detail.auditId}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <span className="text-xs">{formatTimestamp(detail.ts)}</span>
          <span className="text-xs">
            app{' '}
            <Link href={`/apps/${detail.appId}`} className="underline-offset-2 hover:underline">
              {detail.appName ?? detail.appId}
            </Link>
          </span>
          <span className="text-xs">seq {detail.seq}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              detail.isLatest ? 'bg-stone-100 text-stone-700' : 'bg-amber-50 text-amber-800'
            }`}
            data-testid="version-state"
          >
            {detail.isLatest ? 'latest version' : 'superseded version'}
          </span>
          <span className="font-mono text-xs" title={detail.recordHash}>
            {truncateHash(detail.recordHash)}
          </span>
          <CopyButton value={detail.recordHash} label="Copy record_hash" />
          {detail.attestRendered === null ? null : (
            <span className="text-xs">
              rendered: {detail.attestRendered ? 'yes' : 'no'} (reported at attestation)
            </span>
          )}
        </p>
      </div>

      <VerifyChecks verification={detail.verification} />

      <AuditChain detail={detail} />

      {detail.record === null ? (
        <div
          className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="record-unparseable"
        >
          <p className="font-semibold">
            This stored record no longer satisfies the AuditRecord contract.
          </p>
          <p className="mt-1">
            The raw document is below. Treat this as an integrity alarm: the gateway answers 500 for
            such a record on GET /v1/audit/:id.
          </p>
        </div>
      ) : (
        <AuditRecordView record={detail.record} />
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold text-stone-900">
          Raw signed JSON
        </summary>
        <p className="mt-2 text-xs text-stone-500">
          The stored document, exactly as verify() hashed it.
        </p>
        <pre
          className="mt-3 max-h-[32rem] overflow-auto rounded-md bg-stone-50 p-3 font-mono text-xs text-stone-800"
          data-testid="raw-record"
        >
          {detail.recordJson}
        </pre>
      </details>
    </section>
  );
};

export default AuditDetailPage;
