import { z } from 'zod';

import { Classification } from './classification.js';
import { AppId, AuditId, CreativeId, IsoTimestamp, Sha256Hash, Surface } from './common.js';
import { DemandTrace } from './demand-trace.js';
import { Decision } from './evaluate.js';
import { Ed25519Signature, KeyId } from './keys.js';
import { PolicyDecision } from './policy-decision.js';
import { OverrideRejection } from './policy-overrides.js';
import {
  AdvertiserDomain,
  DisclosureLabel,
  DisclosurePosition,
  DisclosureStyle,
} from './policy-parts.js';
import { SuppressReason } from './suppress-reason.js';

/**
 * The audit record (docs/audit.md): one per /v1/evaluate call, suppressions included. The
 * records of an app form a hash chain through prev_hash and each one is signed with Ed25519
 * (signature, key_id). Building, hashing and signing live in @adgateio/core (audit/record.ts and
 * audit/chain.ts); this module is the on-the-wire shape only. Nothing in a record is message
 * text or a raw identifier: conversation ids and user ids appear as salted hashes.
 *
 * Fields are declared in the docs/audit.md order (key_id last) so the JSON Schema reads like the
 * contract. override_rejected is the one addition: docs/policy.md says loosening overrides are
 * "noted in the audit record as override_rejected"; it defaults to [] so the docs example, which
 * omits it, still parses.
 */

/** prev_hash of the first record of an app (docs/audit.md). */
export const GENESIS_PREV_HASH = 'genesis';

export const PrevHash = z.union([Sha256Hash, z.literal(GENESIS_PREV_HASH)]).meta({
  title: 'PrevHash',
  description:
    'The record_hash of the previous record for the same app_id, or the literal genesis for the first record.',
});
export type PrevHash = z.infer<typeof PrevHash>;

export const AuditSurface = Surface.pick({ type: true, placement: true }).meta({
  title: 'AuditSurface',
  description: 'Where the slot would have rendered: the request surface without max_creatives.',
});
export type AuditSurface = z.infer<typeof AuditSurface>;

export const AuditCreative = z
  .object({
    id: CreativeId,
    advertiser: z.string().min(1).describe('Advertiser display name.'),
    advertiser_domain: AdvertiserDomain.describe('Advertiser domain, e.g. example.com.'),
    content_hash: Sha256Hash.describe(
      'sha256 over the canonical JSON of the creative content (advertiser, advertiser_domain, headline, body, cta, url_template). Verification compares it with the stored creative.',
    ),
  })
  .meta({
    title: 'AuditCreative',
    description: 'The served creative as recorded: identity plus a content hash, never the copy.',
  });
export type AuditCreative = z.infer<typeof AuditCreative>;

export const AuditDisclosure = z
  .object({
    label: DisclosureLabel,
    position: DisclosurePosition,
    style: DisclosureStyle,
  })
  .meta({
    title: 'AuditDisclosure',
    description:
      'The disclosure the policy required for this turn. No defaults: signed as written.',
  });
export type AuditDisclosure = z.infer<typeof AuditDisclosure>;

const shape = z.object({
  id: AuditId,
  app_id: AppId,
  conversation_id_hash: Sha256Hash.describe(
    'sha256(app_salt + conversation_id). Raw conversation ids are never stored.',
  ),
  user_hash: Sha256Hash.nullable().describe(
    'The app-supplied user hash normalised to sha256:<hex>, or null when the request carried none.',
  ),
  turn_id: z.string().min(1),
  ts: IsoTimestamp.describe('When the evaluation happened.'),
  surface: AuditSurface,
  classification: Classification,
  policy_version: z.number().int().min(1).describe('The version field of the policy applied.'),
  policy_hash: Sha256Hash.describe('policy_hash of the policy applied (docs/policy.md).'),
  policy_decisions: z
    .array(PolicyDecision)
    .describe('One entry per rule in docs/policy.md rule order, pass or fail.'),
  override_rejected: z
    .array(OverrideRejection)
    .default(() => [])
    .describe(
      'policy_overrides values that would have loosened the policy and were ignored (docs/policy.md Overrides). Empty when none.',
    ),
  decision: Decision,
  reason: SuppressReason.nullable().describe('null when decision is serve.'),
  demand: DemandTrace,
  creative: AuditCreative.nullable().describe('null when decision is suppress.'),
  disclosure: AuditDisclosure,
  model_output_hash: Sha256Hash.nullable().describe(
    'Set by attestation: the hash of the model output the SDK rendered the slot after.',
  ),
  separation_attestation: z
    .boolean()
    .describe('true only on a record produced by attestation (POST /v1/attest).'),
  attested_at: IsoTimestamp.nullable(),
  supersedes_hash: Sha256Hash.nullable().describe(
    'On an attestation record: the record_hash of the record it supersedes. Both stay in the chain.',
  ),
  prev_hash: PrevHash,
  record_hash: Sha256Hash.describe(
    'sha256 over the canonical JSON of the record without record_hash and signature, concatenated with prev_hash.',
  ),
  signature: Ed25519Signature.describe('Ed25519 over the record_hash string, by key_id.'),
  key_id: KeyId,
});

export const AuditRecord = shape
  .refine(
    (record) => record.decision !== 'serve' || (record.creative !== null && record.reason === null),
    { message: 'serve requires a creative and a null reason', path: ['decision'] },
  )
  .refine(
    (record) =>
      record.decision !== 'suppress' || (record.creative === null && record.reason !== null),
    { message: 'suppress requires a null creative and a reason', path: ['decision'] },
  )
  .meta({
    title: 'AuditRecord',
    description:
      'A signed audit record (docs/audit.md): one per /v1/evaluate call, chained per app through prev_hash. Body of GET /v1/audit/:id.',
    // The two refinements above, expressed for JSON Schema consumers.
    allOf: [
      {
        if: { properties: { decision: { const: 'serve' } } },
        then: { properties: { creative: { type: 'object' }, reason: { type: 'null' } } },
      },
      {
        if: { properties: { decision: { const: 'suppress' } } },
        then: { properties: { creative: { type: 'null' }, reason: { type: 'string' } } },
      },
    ],
  });
export type AuditRecord = z.infer<typeof AuditRecord>;

/** What record_hash is computed over (plus prev_hash): the record before hashing and signing. */
export const UnsignedAuditRecord = shape.omit({ record_hash: true, signature: true }).meta({
  title: 'UnsignedAuditRecord',
  description: 'An audit record without record_hash and signature: the input of the hash chain.',
});
export type UnsignedAuditRecord = z.infer<typeof UnsignedAuditRecord>;

/** The record content that depends on the evaluation alone, not on chain position or key. */
export const AuditRecordBody = shape
  .omit({ prev_hash: true, key_id: true, record_hash: true, signature: true })
  .meta({
    title: 'AuditRecordBody',
    description:
      'An audit record before it is chained (prev_hash) and signed (key_id, record_hash, signature).',
  });
export type AuditRecordBody = z.infer<typeof AuditRecordBody>;
