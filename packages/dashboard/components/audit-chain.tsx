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
  <div className="card flex-1">
    <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">{title}</h3>
    {neighbour === null ? (
      <p className="mt-2 text-sm text-stone-500">{emptyLabel}</p>
    ) : (
      <p className="mt-2 text-sm">
        <Link
          href={versionHref(neighbour.auditId, neighbour.recordHash)}
          className="font-mono text-xs underline-offset-2 hover:underline"
        >
          {neighbour.auditId}
        </Link>
        <span className="mt-1 block text-xs text-stone-500">
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
        <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">
          Versions of {detail.auditId}
        </h3>
        <p className="mt-1 text-xs text-stone-500">
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
                  className={`block rounded-md border px-3 py-2 text-sm ${
                    current
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  <span className="font-mono text-xs">{truncateHash(version.recordHash)}</span>
                  <span className={`ml-2 text-xs ${current ? 'text-stone-300' : 'text-stone-500'}`}>
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
