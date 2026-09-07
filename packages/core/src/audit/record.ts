import type {
  AppId,
  AuditCreative,
  AuditId,
  AuditRecord,
  AuditRecordBody,
  Candidate,
  Classification,
  Decision,
  DemandTrace,
  Disclosure,
  IsoTimestamp,
  OverrideRejection,
  PolicyDecision,
  PrevHash,
  Sha256Hash,
  Surface,
  SuppressReason,
  UnsignedAuditRecord,
} from '@adgateio/schemas';

import type { MediationResult } from '../demand/mediate.js';
import type { PolicyEvaluation } from '../policy/evaluate.js';
import { type AuditSigningKey, signRecord } from './chain.js';
import { creativeContentHash } from './content-hash.js';
import { conversationIdHash, userHash } from './privacy-hash.js';

/**
 * buildAuditRecord (docs/BUILD_GUIDE.md Phase 4) assembles the docs/audit.md record for one
 * /v1/evaluate call from what the pipeline produced: the classification, the policy result,
 * the mediation result, the disclosure the policy requires and the app metadata; then chains it
 * to the app's previous record and signs it. Pure: the id, timestamp, prev_hash and signing key
 * are injected, and nothing here reads a clock, the environment or a database.
 *
 * Every value is copied field by field (or structuredClone'd for the demand trace), so the
 * record never shares objects with the caller and never carries anything beyond the contract:
 * a RulesResult's `matches`, a Surface's max_creatives or a Candidate's copy and scores are
 * dropped. Raw conversation and user ids are replaced by their salted hashes.
 */

export interface AuditAppContext {
  app_id: AppId;
  /** The per-app secret the identity hashes are salted with. Never written into the record. */
  salt: string;
}

export interface AuditPolicyContext {
  policy_version: number;
  policy_hash: Sha256Hash;
  disclosure: Disclosure;
}

/** The policy engine's answer: PolicyEvaluation itself, or anything carrying its fields. */
export type AuditPolicyResult = Pick<PolicyEvaluation, 'allowed' | 'reason' | 'decisions'>;

/** What mediate() returned; selected_source is not needed (trace.selected names it). */
export type AuditMediation = Pick<MediationResult, 'selected' | 'trace'>;

export interface BuildAuditRecordInput {
  /** A fresh prefixedUlid('aud_'). */
  id: AuditId;
  app: AuditAppContext;
  conversation_id: string;
  /** The request's user.user_hash, if any (normalised by userHash). */
  user_hash?: string | null | undefined;
  turn_id: string;
  /** When the evaluation happened, ISO 8601 UTC. */
  ts: IsoTimestamp;
  surface: Surface;
  /** The persisted classification (a RulesResult's matches are dropped here anyway). */
  classification: Classification;
  policy: AuditPolicyContext;
  policyResult: AuditPolicyResult;
  /** mergeOverrides().rejected; omitted or undefined means none. */
  override_rejected?: readonly OverrideRejection[] | undefined;
  /** null when the policy suppressed the turn before demand ran. */
  mediation: AuditMediation | null;
  /** nextPrevHash(the app's latest record). */
  prev_hash: PrevHash;
  signing: AuditSigningKey;
}

/** The demand block of a record for which no source was queried. A fresh object each call. */
export const emptyDemandTrace = (): DemandTrace => ({
  requested: [],
  responses: [],
  excluded: [],
  selected: null,
});

const pickClassification = (classification: Classification): Classification => ({
  commercial_intent: classification.commercial_intent,
  categories: [...classification.categories],
  sensitive: [...classification.sensitive],
  confidence: classification.confidence,
  method: classification.method,
  prompt_version: classification.prompt_version,
});

const pickDecision = (decision: PolicyDecision): PolicyDecision =>
  decision.detail === undefined
    ? { rule: decision.rule, result: decision.result }
    : { rule: decision.rule, result: decision.result, detail: decision.detail };

const pickRejection = (rejection: OverrideRejection): OverrideRejection => ({
  path: rejection.path,
  reason: rejection.reason,
});

const auditCreative = (candidate: Candidate): AuditCreative => ({
  id: candidate.id,
  advertiser: candidate.advertiser,
  advertiser_domain: candidate.advertiser_domain,
  content_hash: creativeContentHash(candidate),
});

interface Outcome {
  decision: Decision;
  reason: SuppressReason | null;
  selected: Candidate | null;
}

/**
 * Fail closed at every step: a failed policy suppresses with its reason (or `error` when the
 * result carries none), a passed policy serves only when mediation selected a candidate and is
 * `no_fill` otherwise, including when demand never ran.
 */
const decide = (policyResult: AuditPolicyResult, mediation: AuditMediation | null): Outcome => {
  if (!policyResult.allowed) {
    return { decision: 'suppress', reason: policyResult.reason ?? 'error', selected: null };
  }
  const selected = mediation?.selected ?? null;
  if (selected === null) {
    return { decision: 'suppress', reason: 'no_fill', selected: null };
  }
  return { decision: 'serve', reason: null, selected };
};

/** The record content before chaining and signing (prev_hash, key_id, record_hash, signature). */
export const buildAuditBody = (input: BuildAuditRecordInput): AuditRecordBody => {
  const { decision, reason, selected } = decide(input.policyResult, input.mediation);
  const { disclosure } = input.policy;
  return {
    id: input.id,
    app_id: input.app.app_id,
    conversation_id_hash: conversationIdHash(input.app.salt, input.conversation_id),
    user_hash: userHash(input.app.salt, input.user_hash),
    turn_id: input.turn_id,
    ts: input.ts,
    surface: { type: input.surface.type, placement: input.surface.placement },
    classification: pickClassification(input.classification),
    policy_version: input.policy.policy_version,
    policy_hash: input.policy.policy_hash,
    policy_decisions: input.policyResult.decisions.map(pickDecision),
    override_rejected: (input.override_rejected ?? []).map(pickRejection),
    decision,
    reason,
    demand: input.mediation === null ? emptyDemandTrace() : structuredClone(input.mediation.trace),
    creative: selected === null ? null : auditCreative(selected),
    disclosure: { label: disclosure.label, position: disclosure.position, style: disclosure.style },
    model_output_hash: null,
    separation_attestation: false,
    attested_at: null,
    supersedes_hash: null,
  };
};

/** A complete, chained and signed AuditRecord. Throws only on inputs that break the types. */
export const buildAuditRecord = (input: BuildAuditRecordInput): AuditRecord => {
  const unsigned: UnsignedAuditRecord = {
    ...buildAuditBody(input),
    prev_hash: input.prev_hash,
    key_id: input.signing.key_id,
  };
  return signRecord(unsigned, input.signing);
};
