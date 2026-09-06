import Link from 'next/link';

import type { AuditDetail, ChainNeighbour } from '@/lib/audit-detail';
import { formatTimestamp, truncateHash } from '@/lib/format';

/**
 * Where this record sits: its neighbours in the app's chain (the record at seq - 1 and the one
 * at seq + 1) and, when the turn was attested, the other version of the same audit id.
 *
 * The version switcher uses the same `?version=<record_hash>` parameter as the gateway's
 * GET /v1/audit/:id, so a link copied from here selects the same version through the API.
 * Attestation writes a second record rather than editing the first (docs/audit.md), and both
 * remain in the chain and both verify - so both have to be reachable.
 *
 * Both ends of the chain have a real empty state rather than a blank card, because "there is
 * nothing before this" and "the record before this is missing" mean opposite things: the first
 * is a healthy genesis record, the second is a hole in the chain.
 */

const versionHref = (auditId: string, recordHash: string): string =>
  `/audit/${auditId}?version=${encodeURIComponent(recordHash)}`;

const NeighbourCard = ({
  title,
  neighbour,
  emptyLabel,
}: {
  title: string;
  neighbour: ChainNeighbour | null;
  emptyLabel: string;
}) => (
  <div className="card min-w-0 flex-1">
    <h3 className="ag-label">{title}</h3>
    {neighbour === null ? (
      <p className="ag-hint">{emptyLabel}</p>
    ) : (
      <p className="mt-2">
        <Link
          href={versionHref(neighbour.auditId, neighbour.recordHash)}
          className="ag-link ag-mono-2xs"
        >
          {neighbour.auditId}
        </Link>
        <span className="ag-hint block">
          seq {neighbour.seq} - {neighbour.decision}
          {neighbour.reason === null ? '' : ` (${neighbour.reason})`} -{' '}
          {formatTimestamp(neighbour.ts)}
        </span>
      </p>
    )}
  </div>
);

export interface AuditChainProps {
  detail: AuditDetail;
}

export const AuditChain = ({ detail }: AuditChainProps) => (
  <div className="space-y-4" data-testid="audit-chain">
    {detail.versions.length > 1 ? (
      <div className="card" data-testid="version-switcher">
        <h3 className="ag-label">Versions of {detail.auditId}</h3>
        <p className="ag-hint">
          Attestation appends a new signed record instead of editing this one. Both stay in the
          chain and both verify.
        </p>
        <ul className="mt-3 space-y-2">
          {detail.versions.map((version) => {
            const current = version.recordHash === detail.recordHash;
            return (
              <li key={version.recordHash}>
                <Link
                  href={versionHref(detail.auditId, version.recordHash)}
                  aria-current={current ? 'page' : undefined}
                  data-testid="version-option"
                  data-current={current ? 'true' : 'false'}
                  className={`ag-btn w-full justify-start${current ? ' ag-btn-primary' : ''}`}
                >
                  <span className="ag-mono-2xs">{truncateHash(version.recordHash)}</span>
                  <span className="ag-mono-2xs">
                    seq {version.seq} - {formatTimestamp(version.ts)} -{' '}
                    {version.isLatest ? 'latest' : 'superseded'}
                    {version.supersedesHash === null ? '' : ' - attestation'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null}

    <div className="flex flex-wrap gap-4">
      <NeighbourCard
        title="Previous in chain (seq - 1)"
        neighbour={detail.previous}
        emptyLabel={
          detail.seq <= 1
            ? 'This is the first record of the app: prev_hash is genesis.'
            : 'The record at seq - 1 is missing, so the chain cannot be checked here.'
        }
      />
      <NeighbourCard
        title="Next in chain (seq + 1)"
        neighbour={detail.next}
        emptyLabel="This is the newest record of the app."
      />
    </div>

    {detail.superseded === null && detail.supersededBy === null ? null : (
      <div className="flex flex-wrap gap-4">
        {detail.superseded === null ? null : (
          <NeighbourCard title="Supersedes" neighbour={detail.superseded} emptyLabel="none" />
        )}
        {detail.supersededBy === null ? null : (
          <NeighbourCard title="Superseded by" neighbour={detail.supersededBy} emptyLabel="none" />
        )}
      </div>
    )}
  </div>
);
