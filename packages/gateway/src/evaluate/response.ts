import { failClosedClassification } from '@adgate/core';
import {
  type AuditRecordBody,
  type Candidate,
  type Creative,
  type DemandSource,
  EvaluateResponse,
} from '@adgate/schemas';

/**
 * The EvaluateResponse (docs/api.md) derived from the audit record, so the API answer and the
 * signed record can never disagree on decision, reason, classification or audit_id. The
 * creative copy comes from the winning candidate; its url is always the gateway click redirect
 * built from PUBLIC_BASE_URL, never the advertiser. The result is validated against the
 * contract schema before it is sent.
 */

export const CLICK_PATH = '/c/';

export const clickUrl = (publicBaseUrl: string, auditId: string): string =>
  `${publicBaseUrl.replace(/\/+$/, '')}${CLICK_PATH}${auditId}`;

export interface CreativeResponseInput {
  candidate: Candidate;
  source: DemandSource;
  auditId: string;
  publicBaseUrl: string;
  disclosureLabel: string;
}

export const toCreative = (input: CreativeResponseInput): Creative => ({
  id: input.candidate.id,
  advertiser: input.candidate.advertiser,
  headline: input.candidate.headline,
  body: input.candidate.body,
  cta: input.candidate.cta,
  url: clickUrl(input.publicBaseUrl, input.auditId),
  source: input.source,
  disclosure_label: input.disclosureLabel,
});

export interface EvaluateResponseInput {
  /** The audit record (or its unsigned body) the response must agree with. */
  record: Pick<AuditRecordBody, 'id' | 'decision' | 'reason' | 'classification'>;
  selected: Candidate | null;
  selectedSource: DemandSource | null;
  publicBaseUrl: string;
  disclosureLabel: string;
  latencyMs: number;
}

/** Throws (ZodError) when the assembled response breaks the contract: the caller fails closed. */
export const buildEvaluateResponse = (input: EvaluateResponseInput): EvaluateResponse => {
  const { record } = input;
  const creative =
    record.decision === 'serve' && input.selected !== null
      ? toCreative({
          candidate: input.selected,
          source: input.selectedSource ?? input.selected.source,
          auditId: record.id,
          publicBaseUrl: input.publicBaseUrl,
          disclosureLabel: input.disclosureLabel,
        })
      : null;
  return EvaluateResponse.parse({
    decision: record.decision,
    reason: record.reason,
    classification: record.classification,
    creative,
    audit_id: record.id,
    latency_ms: input.latencyMs,
  });
};

/** docs/api.md error behaviour: HTTP 200, suppress, reason error, a zeroed classification. */
export const errorEvaluateResponse = (auditId: string, latencyMs: number): EvaluateResponse => ({
  decision: 'suppress',
  reason: 'error',
  classification: failClosedClassification(),
  creative: null,
  audit_id: auditId,
  latency_ms: latencyMs,
});
