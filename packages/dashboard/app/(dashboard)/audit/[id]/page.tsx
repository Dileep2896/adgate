import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AuditChain } from '@/components/audit-chain';
import { AuditRecordView } from '@/components/audit-record-view';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { VerifyChecks } from '@/components/verify-checks';
import { loadAuditDetail } from '@/lib/audit-detail';
import { requireSession } from '@/lib/auth';
import { formatTimestamp, truncateHash } from '@/lib/format';

/**
 * One audit record: the signed document, where it sits in its app's chain, and the LIVE result
 * of core's verify() over it - all eight docs/audit.md checks, computed on this request against
 * the record exactly as it is stored.
 *
 * `?version=<record_hash>` selects one stored version of the id, the same parameter the
 * gateway's GET /v1/audit/:id takes. Without it the latest version is shown.
 *
 * Everything here happens on the server: @adgateio/core is a Node package and the components
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

  // A record of another account's app answers null, which is the same not-found an audit id that
  // was never written gets: the id space says nothing about what exists.
  const session = await requireSession(`/audit/${id}`);
  const detail = await loadAuditDetail({ auditId: id, version, scope: session.scope });
  if (detail === null) {
    notFound();
  }

  return (
    <section className="space-y-8">
      <PageHeader
        title={detail.auditId}
        titleTestId="audit-id"
        mono
        back={{ href: '/audit', label: 'All audit records' }}
        meta={
          <>
            <span>{formatTimestamp(detail.ts)}</span>
            <span>
              app{' '}
              <Link href={`/apps/${detail.appId}`} className="ag-link-quiet">
                {detail.appName ?? detail.appId}
              </Link>
            </span>
            <span>seq {detail.seq}</span>
            <span
              data-testid="version-state"
              className={detail.isLatest ? 'ag-badge' : 'ag-badge ag-badge-warn'}
            >
              {detail.isLatest ? 'latest version' : 'superseded version'}
            </span>
            <span className="ag-mono-2xs" title={detail.recordHash}>
              {truncateHash(detail.recordHash)}
            </span>
            <CopyButton value={detail.recordHash} label="Copy record_hash" />
            {detail.attestRendered === null ? null : (
              <span>
                rendered: {detail.attestRendered ? 'yes' : 'no'} (reported at attestation)
              </span>
            )}
          </>
        }
      />

      <VerifyChecks verification={detail.verification} />

      <AuditChain detail={detail} />

      {detail.record === null ? (
        <div className="ag-note ag-note-danger" data-testid="record-unparseable">
          <p className="ag-note-strong">
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
        <summary className="ag-section-title cursor-pointer">Raw signed JSON</summary>
        <p className="ag-hint">The stored document, exactly as verify() hashed it.</p>
        <div className="ag-well mt-3">
          <p className="ag-well-bar">
            <span className="ag-well-file">{detail.auditId}.json</span>
            <span>as stored, as hashed</span>
          </p>
          <pre data-testid="raw-record">{detail.recordJson}</pre>
        </div>
      </details>
    </section>
  );
};

export default AuditDetailPage;
