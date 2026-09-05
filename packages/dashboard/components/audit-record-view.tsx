import type { AuditRecord } from '@adgate/schemas';

import { CopyButton } from '@/components/copy-button';
import { formatPercent, formatReason, truncateHash } from '@/lib/format';

/**
 * The signed record itself, laid out so an operator can read it: what the classifier decided,
 * which policy rule passed, failed or is still pending, which demand sources answered, which
 * creative was chosen, what disclosure was required, and the attestation and chain fields.
 *
 * Everything shown here comes from the RECORD, not from the copy columns beside it in
 * audit_records: the signed JSON is the source of truth and the only thing verify() hashes.
 * The raw document is one <details> away at the bottom for anyone who needs the bytes.
 */

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-baseline gap-2 py-1">
    <span className="w-52 shrink-0 text-xs font-medium tracking-wide text-stone-500 uppercase">
      {label}
    </span>
    <span className="min-w-0 text-sm break-all text-stone-800">{children}</span>
  </div>
);

const Hash = ({ value }: { value: string }) => (
  <span className="inline-flex items-center gap-2">
    <span className="font-mono text-xs" title={value}>
      {truncateHash(value)}
    </span>
    <CopyButton value={value} label="Copy" />
  </span>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card">
    <h2 className="mb-3 text-sm font-semibold text-stone-900">{title}</h2>
    {children}
  </div>
);

const RESULT_STYLES: Record<string, string> = {
  pass: 'bg-emerald-50 text-emerald-700',
  fail: 'bg-red-100 text-red-800',
  pending: 'bg-amber-50 text-amber-800',
};

export interface AuditRecordViewProps {
  record: AuditRecord;
}

export const AuditRecordView = ({ record }: AuditRecordViewProps) => (
  <div className="space-y-6">
    <Section title="Turn">
      <Row label="audit id">
        <span className="font-mono text-xs">{record.id}</span>
      </Row>
      <Row label="app_id">
        <span className="font-mono text-xs">{record.app_id}</span>
      </Row>
      <Row label="turn_id">{record.turn_id}</Row>
      <Row label="ts">{record.ts}</Row>
      <Row label="conversation_id_hash">
        <Hash value={record.conversation_id_hash} />
      </Row>
      <Row label="user_hash">
        {record.user_hash === null ? (
          <span className="text-stone-400">null</span>
        ) : (
          <Hash value={record.user_hash} />
        )}
      </Row>
      <Row label="surface">
        {record.surface.type} / {record.surface.placement}
      </Row>
      <Row label="decision">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            record.decision === 'serve'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-stone-100 text-stone-700'
          }`}
        >
          {record.decision}
        </span>
        {record.reason === null ? null : (
          <span className="ml-2 text-sm">{formatReason(record.reason)}</span>
        )}
      </Row>
    </Section>

    <Section title="Classification">
      <Row label="commercial_intent">{formatPercent(record.classification.commercial_intent)}</Row>
      <Row label="confidence">{formatPercent(record.classification.confidence)}</Row>
      <Row label="categories">
        {record.classification.categories.length === 0
          ? '-'
          : record.classification.categories.join(', ')}
      </Row>
      <Row label="sensitive">
        {record.classification.sensitive.length === 0 ? (
          <span className="text-stone-500">none</span>
        ) : (
          <span className="font-medium text-amber-800">
            {record.classification.sensitive.join(', ')}
          </span>
        )}
      </Row>
      <Row label="method">{record.classification.method}</Row>
      <Row label="prompt_version">
        <Hash value={record.classification.prompt_version} />
      </Row>
    </Section>

    <Section title="Policy">
      <Row label="policy_version">v{record.policy_version}</Row>
      <Row label="policy_hash">
        <Hash value={record.policy_hash} />
      </Row>
      <table className="mt-3 w-full border-collapse" data-testid="policy-decisions">
        <thead className="border-b border-stone-200">
          <tr>
            <th className="table-head">Rule</th>
            <th className="table-head">Result</th>
            <th className="table-head">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {record.policy_decisions.map((decision) => (
            <tr key={decision.rule}>
              <td className="table-cell font-mono text-xs">{decision.rule}</td>
              <td className="table-cell">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    RESULT_STYLES[decision.result] ?? 'bg-stone-100 text-stone-700'
                  }`}
                >
                  {decision.result}
                </span>
              </td>
              <td className="table-cell text-xs text-stone-600">{decision.detail ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {record.override_rejected.length === 0 ? null : (
        <ul className="mt-3 list-disc pl-5 text-xs text-amber-800">
          {record.override_rejected.map((rejection) => (
            <li key={`${rejection.path}:${rejection.reason}`}>
              override rejected: <code>{rejection.path}</code> - {rejection.reason}
            </li>
          ))}
        </ul>
      )}
    </Section>

    <Section title="Demand">
      <Row label="requested">
        {record.demand.requested.length === 0 ? (
          <span className="text-stone-500">no source was asked</span>
        ) : (
          record.demand.requested.join(', ')
        )}
      </Row>
      <Row label="selected">{record.demand.selected ?? '-'}</Row>
      {record.demand.responses.length === 0 ? null : (
        <table className="mt-3 w-full border-collapse" data-testid="demand-trace">
          <thead className="border-b border-stone-200">
            <tr>
              <th className="table-head">Source</th>
              <th className="table-head">Candidates</th>
              <th className="table-head">Latency</th>
              <th className="table-head">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {record.demand.responses.map((response, index) => (
              <tr key={`${response.source}-${index}`}>
                <td className="table-cell font-mono text-xs">{response.source}</td>
                <td className="table-cell tabular-nums">{response.candidates}</td>
                <td className="table-cell tabular-nums">{response.latency_ms} ms</td>
                <td className="table-cell text-xs text-stone-600">{response.error ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {record.demand.excluded.length === 0 ? null : (
        <ul className="mt-3 list-disc pl-5 text-xs text-stone-600">
          {record.demand.excluded.map((excluded) => (
            <li key={excluded.creative_id}>
              {excluded.advertiser_domain} excluded from {excluded.source}: {excluded.reason}
            </li>
          ))}
        </ul>
      )}
    </Section>

    <Section title="Creative and disclosure">
      {record.creative === null ? (
        <p className="text-sm text-stone-500">
          Nothing was served, so the record names no creative.
        </p>
      ) : (
        <>
          <Row label="creative id">
            <span className="font-mono text-xs">{record.creative.id}</span>
          </Row>
          <Row label="advertiser">
            {record.creative.advertiser} ({record.creative.advertiser_domain})
          </Row>
          <Row label="content_hash">
            <Hash value={record.creative.content_hash} />
          </Row>
        </>
      )}
      <Row label="disclosure label">{record.disclosure.label}</Row>
      <Row label="position">{record.disclosure.position}</Row>
      <Row label="style">{record.disclosure.style}</Row>
    </Section>

    <Section title="Attestation and chain">
      <Row label="separation_attestation">
        {record.separation_attestation ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            true
          </span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
            false
          </span>
        )}
      </Row>
      <Row label="attested_at">{record.attested_at ?? '-'}</Row>
      <Row label="model_output_hash">
        {record.model_output_hash === null ? '-' : <Hash value={record.model_output_hash} />}
      </Row>
      <Row label="supersedes_hash">
        {record.supersedes_hash === null ? '-' : <Hash value={record.supersedes_hash} />}
      </Row>
      <Row label="prev_hash">
        {record.prev_hash === 'genesis' ? (
          <span className="font-mono text-xs">genesis</span>
        ) : (
          <Hash value={record.prev_hash} />
        )}
      </Row>
      <Row label="record_hash">
        <Hash value={record.record_hash} />
      </Row>
      <Row label="key_id">
        <span className="font-mono text-xs">{record.key_id}</span>
      </Row>
      <Row label="signature">
        <Hash value={record.signature} />
      </Row>
    </Section>
  </div>
);
