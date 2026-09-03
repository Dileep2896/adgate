import { describe, expect, it } from 'vitest';

import {
  AuditRecord,
  AuditRecordBody,
  GENESIS_PREV_HASH,
  PrevHash,
  UnsignedAuditRecord,
} from './audit-record.js';
import { CONTRACT_SCHEMAS, toJsonSchemaObject } from './json-schema.js';

/**
 * The docs/audit.md example, copied verbatim. Two values that are prose in the doc are written
 * in their valid form: `user_hash` ("sha256:... or null") and `signature` ("ed25519:base64...",
 * whose dots are outside the base64 alphabet). Every field name, order and enum is the doc's.
 * Keep it in sync by hand when the contract doc changes (a human decision, see CLAUDE.md).
 */
export const AUDIT_RECORD_EXAMPLE = {
  id: 'aud_01J...',
  app_id: 'app_01J...',
  conversation_id_hash: 'sha256:...',
  user_hash: 'sha256:...',
  turn_id: 'turn_7',
  ts: '2026-09-02T18:04:11Z',
  surface: { type: 'chat', placement: 'after_answer' },
  classification: {
    commercial_intent: 0.84,
    categories: ['software.devtools.database'],
    sensitive: [],
    confidence: 0.91,
    method: 'llm',
    prompt_version: 'sha256:...',
  },
  policy_version: 1,
  policy_hash: 'sha256:...',
  policy_decisions: [
    { rule: 'serve_to_tiers', result: 'pass' },
    { rule: 'regions', result: 'pass' },
    { rule: 'blocked_categories', result: 'pass' },
    { rule: 'min_confidence', result: 'pass' },
    { rule: 'min_commercial_intent', result: 'pass' },
    { rule: 'frequency_caps', result: 'pass', detail: 'session=0/1 day=1/3 turns_since=9' },
    { rule: 'competitor_exclusions', result: 'pending' },
  ],
  decision: 'serve',
  reason: null,
  demand: {
    requested: ['direct', 'affiliate'],
    responses: [
      { source: 'direct', candidates: 2, latency_ms: 38 },
      { source: 'affiliate', candidates: 0, latency_ms: 61 },
    ],
    excluded: [],
    selected: 'direct',
  },
  creative: {
    id: 'cr_01J...',
    advertiser: 'Example DB Cloud',
    advertiser_domain: 'example.com',
    content_hash: 'sha256:...',
  },
  disclosure: { label: 'Sponsored', position: 'after_answer', style: 'separate_block' },
  model_output_hash: null,
  separation_attestation: false,
  attested_at: null,
  supersedes_hash: null,
  prev_hash: 'sha256:...',
  record_hash: 'sha256:...',
  signature: `ed25519:${'A'.repeat(86)}==`,
  key_id: 'k_2026_09',
};

/** The example with the override_rejected default applied: what AuditRecord.parse returns. */
const PARSED_EXAMPLE = { ...AUDIT_RECORD_EXAMPLE, override_rejected: [] };

const SUPPRESS_EXAMPLE = {
  ...AUDIT_RECORD_EXAMPLE,
  decision: 'suppress',
  reason: 'no_fill',
  demand: { ...AUDIT_RECORD_EXAMPLE.demand, selected: null },
  creative: null,
};

const DOC_FIELD_ORDER = [
  'id',
  'app_id',
  'conversation_id_hash',
  'user_hash',
  'turn_id',
  'ts',
  'surface',
  'classification',
  'policy_version',
  'policy_hash',
  'policy_decisions',
  'override_rejected',
  'decision',
  'reason',
  'demand',
  'creative',
  'disclosure',
  'model_output_hash',
  'separation_attestation',
  'attested_at',
  'supersedes_hash',
  'prev_hash',
  'record_hash',
  'signature',
  'key_id',
];

const without = <K extends keyof typeof PARSED_EXAMPLE>(...keys: K[]) => {
  const copy: Record<string, unknown> = { ...PARSED_EXAMPLE };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
};

describe('AuditRecord', () => {
  it('parses the docs/audit.md example verbatim, defaulting override_rejected to []', () => {
    expect(AuditRecord.parse(AUDIT_RECORD_EXAMPLE)).toEqual(PARSED_EXAMPLE);
    expect(AuditRecord.parse(PARSED_EXAMPLE)).toEqual(PARSED_EXAMPLE);
  });

  it('keeps the docs field order, with override_rejected next to policy_decisions', () => {
    expect(Object.keys(AuditRecord.shape)).toEqual(DOC_FIELD_ORDER);
    const json = toJsonSchemaObject('AuditRecord');
    expect(Object.keys(json['properties'] as object)).toEqual(DOC_FIELD_ORDER);
    expect(json['allOf']).toHaveLength(2);
  });

  it('parses a suppress record (creative null, a reason, no selected source)', () => {
    expect(AuditRecord.parse(SUPPRESS_EXAMPLE)).toEqual({
      ...SUPPRESS_EXAMPLE,
      override_rejected: [],
    });
    const beforeDemand = {
      ...SUPPRESS_EXAMPLE,
      reason: 'paid_user',
      demand: { requested: [], responses: [], excluded: [], selected: null },
    };
    expect(AuditRecord.safeParse(beforeDemand).success).toBe(true);
  });

  it('parses an attested record and a user_hash of null', () => {
    const attested = {
      ...PARSED_EXAMPLE,
      user_hash: null,
      model_output_hash: 'sha256:abc',
      separation_attestation: true,
      attested_at: '2026-09-02T18:04:12Z',
      supersedes_hash: 'sha256:def',
    };
    expect(AuditRecord.parse(attested)).toEqual(attested);
  });

  it('carries override_rejected entries with a path and a reason', () => {
    const rejected = [{ path: 'frequency_caps.per_session', reason: 'cannot raise' }];
    expect(
      AuditRecord.parse({ ...PARSED_EXAMPLE, override_rejected: rejected }).override_rejected,
    ).toEqual(rejected);
    expect(
      AuditRecord.safeParse({ ...PARSED_EXAMPLE, override_rejected: [{ path: 'x' }] }).success,
    ).toBe(false);
  });

  it('requires a creative and a null reason on serve, and the reverse on suppress', () => {
    expect(AuditRecord.safeParse({ ...PARSED_EXAMPLE, creative: null }).success).toBe(false);
    expect(AuditRecord.safeParse({ ...PARSED_EXAMPLE, reason: 'no_fill' }).success).toBe(false);
    expect(AuditRecord.safeParse({ ...SUPPRESS_EXAMPLE, reason: null }).success).toBe(false);
    expect(
      AuditRecord.safeParse({ ...SUPPRESS_EXAMPLE, creative: AUDIT_RECORD_EXAMPLE.creative })
        .success,
    ).toBe(false);
  });

  it('accepts genesis or a sha256 prev_hash and nothing else', () => {
    expect(AuditRecord.parse({ ...PARSED_EXAMPLE, prev_hash: 'genesis' }).prev_hash).toBe(
      'genesis',
    );
    expect(PrevHash.parse(GENESIS_PREV_HASH)).toBe('genesis');
    expect(PrevHash.parse('sha256:abc')).toBe('sha256:abc');
    for (const bad of ['', 'Genesis', 'sha256:', 'abc', null, 0]) {
      expect(PrevHash.safeParse(bad).success, String(bad)).toBe(false);
      expect(AuditRecord.safeParse({ ...PARSED_EXAMPLE, prev_hash: bad }).success).toBe(false);
    }
  });

  it('requires every chain and signature field', () => {
    for (const key of ['prev_hash', 'record_hash', 'signature', 'key_id'] as const) {
      expect(AuditRecord.safeParse(without(key)).success, key).toBe(false);
    }
    for (const key of [
      'id',
      'app_id',
      'conversation_id_hash',
      'user_hash',
      'ts',
      'demand',
    ] as const) {
      expect(AuditRecord.safeParse(without(key)).success, key).toBe(false);
    }
  });

  it('rejects values outside the contract', () => {
    const bad: Record<string, unknown>[] = [
      { id: 'ev_01J' },
      { app_id: 'my-chat-app' },
      { conversation_id_hash: 'conv_abc' },
      { user_hash: 'user_42' },
      { turn_id: '' },
      { ts: '2026-09-02T18:04:11+02:00' },
      { surface: { type: 'chat', placement: 'inline' } },
      { surface: { type: 'web', placement: 'after_answer' } },
      { classification: { ...AUDIT_RECORD_EXAMPLE.classification, categories: ['nope'] } },
      { policy_version: 0 },
      { policy_version: 1.5 },
      { policy_hash: 'abc' },
      { policy_decisions: [{ rule: 'made_up', result: 'pass' }] },
      { decision: 'maybe' },
      { decision: 'suppress', creative: null, reason: 'nope' },
      { demand: { ...AUDIT_RECORD_EXAMPLE.demand, requested: ['adsense'] } },
      { creative: { ...AUDIT_RECORD_EXAMPLE.creative, content_hash: 'abc' } },
      { disclosure: { label: '', position: 'after_answer', style: 'separate_block' } },
      { disclosure: { label: 'Sponsored', position: 'inline', style: 'separate_block' } },
      { model_output_hash: 'abc' },
      { separation_attestation: 'yes' },
      { attested_at: 'yesterday' },
      { supersedes_hash: 'genesis' },
      { record_hash: 'genesis' },
      { signature: 'ed25519:base64...' },
      { signature: `sha256:${'A'.repeat(86)}==` },
      { key_id: 'k 1' },
      { key_id: '' },
    ];
    for (const patch of bad) {
      const result = AuditRecord.safeParse({ ...PARSED_EXAMPLE, ...patch });
      expect(result.success, JSON.stringify(patch)).toBe(false);
    }
  });

  it('is a contract schema with its own JSON Schema file', () => {
    expect(CONTRACT_SCHEMAS.AuditRecord).toBe(AuditRecord);
  });
});

describe('UnsignedAuditRecord and AuditRecordBody', () => {
  it('UnsignedAuditRecord is the record without record_hash and signature', () => {
    const unsigned = without('record_hash', 'signature');
    expect(UnsignedAuditRecord.parse(unsigned)).toEqual(unsigned);
    expect(Object.keys(UnsignedAuditRecord.shape)).toEqual(
      DOC_FIELD_ORDER.filter((key) => key !== 'record_hash' && key !== 'signature'),
    );
    expect(
      UnsignedAuditRecord.safeParse(without('record_hash', 'signature', 'prev_hash')).success,
    ).toBe(false);
    expect(
      UnsignedAuditRecord.safeParse(without('record_hash', 'signature', 'key_id')).success,
    ).toBe(false);
  });

  it('AuditRecordBody drops the chain and signing fields as well', () => {
    const body = without('record_hash', 'signature', 'prev_hash', 'key_id');
    expect(AuditRecordBody.parse(body)).toEqual(body);
    expect(Object.keys(AuditRecordBody.shape)).toEqual(
      DOC_FIELD_ORDER.filter(
        (key) => !['record_hash', 'signature', 'prev_hash', 'key_id'].includes(key),
      ),
    );
    expect(
      AuditRecordBody.safeParse(without('record_hash', 'signature', 'prev_hash', 'key_id', 'ts'))
        .success,
    ).toBe(false);
  });
});
