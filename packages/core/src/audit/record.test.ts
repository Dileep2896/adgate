import { AuditRecord, type Classification } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonical/canonicalize.js';
import { creativeContentHash } from './content-hash.js';
import { sha256Prefixed } from './crypto.js';
import { TEST_KEYS } from './crypto.fixture.js';
import { AuditKeyError } from './errors.js';
import { conversationIdHash, userHash } from './privacy-hash.js';
import { buildAuditBody, buildAuditRecord, emptyDemandTrace } from './record.js';
import {
  APP,
  CONVERSATION_ID,
  DISCLOSURE,
  EXAMPLE_CANDIDATE,
  NO_FILL_TRACE,
  PAID_USER_DECISIONS,
  POLICY_HASH,
  RAW_USER_ID,
  SERVE_CLASSIFICATION,
  SERVE_DECISIONS,
  SERVE_TRACE,
  serveInput,
  suppressInput,
  TS,
} from './record.fixture.js';

describe('buildAuditRecord on a serve', () => {
  const record = buildAuditRecord(serveInput());

  it('produces a record that validates against AuditRecord', () => {
    expect(AuditRecord.parse(record)).toEqual(record);
  });

  it('copies the identifiers, timestamp, surface and policy context', () => {
    expect(record.id).toBe('aud_01JFIRSTRECORD');
    expect(record.app_id).toBe(APP.app_id);
    expect(record.turn_id).toBe('turn_7');
    expect(record.ts).toBe(TS);
    expect(record.surface).toEqual({ type: 'chat', placement: 'after_answer' });
    expect(record.policy_version).toBe(1);
    expect(record.policy_hash).toBe(POLICY_HASH);
    expect(record.disclosure).toEqual(DISCLOSURE);
    expect(record.key_id).toBe(TEST_KEYS.key_id);
    expect(record.prev_hash).toBe('genesis');
  });

  it('decides serve with a null reason and the selected creative with its content hash', () => {
    expect(record.decision).toBe('serve');
    expect(record.reason).toBeNull();
    expect(record.creative).toEqual({
      id: EXAMPLE_CANDIDATE.id,
      advertiser: 'Example DB Cloud',
      advertiser_domain: 'example.com',
      content_hash: creativeContentHash(EXAMPLE_CANDIDATE),
    });
    expect(record.creative).not.toHaveProperty('headline');
    expect(record.creative).not.toHaveProperty('resolved_url');
  });

  it('copies every policy decision and the demand trace verbatim, as independent copies', () => {
    expect(record.policy_decisions).toEqual(SERVE_DECISIONS);
    expect(record.policy_decisions).not.toBe(SERVE_DECISIONS);
    expect(record.policy_decisions[5]).not.toBe(SERVE_DECISIONS[5]);
    expect(record.demand).toEqual(SERVE_TRACE);
    expect(record.demand).not.toBe(SERVE_TRACE);
    expect(record.demand.responses).not.toBe(SERVE_TRACE.responses);
  });

  it('starts unattested: model_output_hash, attested_at and supersedes_hash null', () => {
    expect(record.model_output_hash).toBeNull();
    expect(record.separation_attestation).toBe(false);
    expect(record.attested_at).toBeNull();
    expect(record.supersedes_hash).toBeNull();
    expect(record.override_rejected).toEqual([]);
  });

  it('keeps only the six Classification fields, dropping rule matches or anything else', () => {
    const leaky = {
      ...SERVE_CLASSIFICATION,
      matches: { sensitive: [], commercial: [{ term: 'postgres' }] },
    } as Classification;
    const built = buildAuditRecord(serveInput({ classification: leaky }));
    expect(built.classification).toEqual(SERVE_CLASSIFICATION);
    expect(built.classification).not.toHaveProperty('matches');
    expect(canonicalize(built)).not.toContain('matches');
  });

  it('records the request surface without max_creatives', () => {
    expect(record.surface).not.toHaveProperty('max_creatives');
    const cli = buildAuditRecord(
      serveInput({ surface: { type: 'cli', placement: 'after_answer' } }),
    );
    expect(cli.surface).toEqual({ type: 'cli', placement: 'after_answer' });
  });
});

describe('buildAuditRecord privacy', () => {
  it('stores conversation_id only as sha256(salt + conversation_id)', () => {
    const record = buildAuditRecord(serveInput());
    expect(record.conversation_id_hash).toBe(conversationIdHash(APP.salt, CONVERSATION_ID));
    expect(record.conversation_id_hash).toBe(sha256Prefixed(`${APP.salt}${CONVERSATION_ID}`));
  });

  it('never lets the raw conversation id, raw user id or salt into the record', () => {
    const record = buildAuditRecord(serveInput({ user_hash: RAW_USER_ID }));
    for (const text of [canonicalize(record), JSON.stringify(record)]) {
      expect(text).not.toContain(CONVERSATION_ID);
      expect(text).not.toContain(RAW_USER_ID);
      expect(text).not.toContain(APP.salt);
    }
    expect(record.user_hash).toBe(userHash(APP.salt, RAW_USER_ID));
  });

  it('normalises an app-supplied digest and records null when there is none', () => {
    const digest = sha256Prefixed('user-1').slice('sha256:'.length);
    expect(buildAuditRecord(serveInput({ user_hash: digest })).user_hash).toBe(`sha256:${digest}`);
    expect(buildAuditRecord(serveInput({ user_hash: `sha256:${digest}` })).user_hash).toBe(
      `sha256:${digest}`,
    );
    expect(buildAuditRecord(serveInput()).user_hash).toBeNull();
    expect(buildAuditRecord(serveInput({ user_hash: undefined })).user_hash).toBeNull();
    expect(buildAuditRecord(serveInput({ user_hash: null })).user_hash).toBeNull();
    expect(buildAuditRecord(serveInput({ user_hash: '' })).user_hash).toBeNull();
  });
});

describe('buildAuditRecord on a suppress', () => {
  it('before demand: the policy reason, creative null and an empty demand trace', () => {
    const record = buildAuditRecord(suppressInput('paid_user'));
    expect(AuditRecord.parse(record)).toEqual(record);
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('paid_user');
    expect(record.creative).toBeNull();
    expect(record.demand).toEqual({ requested: [], responses: [], excluded: [], selected: null });
    expect(record.demand.requested).toHaveLength(0);
    expect(record.policy_decisions).toEqual(PAID_USER_DECISIONS);
    expect(emptyDemandTrace()).toEqual(record.demand);
    expect(emptyDemandTrace()).not.toBe(emptyDemandTrace());
  });

  it('carries every documented reason through unchanged', () => {
    for (const reason of [
      'region_blocked',
      'sensitive_category:health',
      'low_confidence',
      'low_commercial_intent',
      'frequency_cap',
      'error',
    ] as const) {
      const record = buildAuditRecord(suppressInput(reason));
      expect(record.reason).toBe(reason);
      expect(record.creative).toBeNull();
    }
  });

  it('after demand with nothing selected: reason no_fill and the trace as mediation left it', () => {
    const record = buildAuditRecord(
      serveInput({ mediation: { selected: null, trace: NO_FILL_TRACE } }),
    );
    expect(AuditRecord.parse(record)).toEqual(record);
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('no_fill');
    expect(record.creative).toBeNull();
    expect(record.demand).toEqual(NO_FILL_TRACE);
  });

  it('policy allowed but demand never ran: no_fill with an empty trace', () => {
    const record = buildAuditRecord(serveInput({ mediation: null }));
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('no_fill');
    expect(record.demand.requested).toEqual([]);
  });

  it('fails closed: a failed policy without a reason is recorded as error', () => {
    const record = buildAuditRecord(suppressInput(null));
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('error');
    expect(AuditRecord.parse(record)).toEqual(record);
  });

  it('a failed policy never serves, even when a candidate is handed in', () => {
    const record = buildAuditRecord(
      suppressInput('frequency_cap', PAID_USER_DECISIONS, {
        mediation: { selected: EXAMPLE_CANDIDATE, trace: SERVE_TRACE },
      }),
    );
    expect(record.decision).toBe('suppress');
    expect(record.reason).toBe('frequency_cap');
    expect(record.creative).toBeNull();
    expect(record.demand).toEqual(SERVE_TRACE);
  });

  it('an error path with no decisions at all still produces a valid record', () => {
    const record = buildAuditRecord(suppressInput('error', []));
    expect(AuditRecord.parse(record)).toEqual(record);
    expect(record.policy_decisions).toEqual([]);
  });
});

describe('buildAuditRecord overrides and inputs', () => {
  it('copies override_rejected entries and defaults them to []', () => {
    const rejected = [
      { path: 'frequency_caps.per_session', reason: 'cannot raise per_session from 1 to 2' },
      { path: 'demand[0]', reason: 'cannot enable demand source koah' },
    ];
    const record = buildAuditRecord(serveInput({ override_rejected: rejected }));
    expect(record.override_rejected).toEqual(rejected);
    expect(record.override_rejected).not.toBe(rejected);
    expect(AuditRecord.parse(record)).toEqual(record);
    expect(
      buildAuditRecord(serveInput({ override_rejected: undefined })).override_rejected,
    ).toEqual([]);
  });

  it('does not mutate its input and does not share objects with it', () => {
    const input = serveInput({ override_rejected: [{ path: 'x', reason: 'y' }] });
    const before = structuredClone(input);
    const record = buildAuditRecord(input);
    expect(input).toEqual(before);
    SERVE_TRACE.responses[0]!.latency_ms += 1;
    SERVE_DECISIONS[0]!.result = 'fail';
    try {
      expect(record.demand.responses[0]?.latency_ms).toBe(38);
      expect(record.policy_decisions[0]?.result).toBe('pass');
    } finally {
      SERVE_TRACE.responses[0]!.latency_ms -= 1;
      SERVE_DECISIONS[0]!.result = 'pass';
    }
  });

  it('buildAuditBody is the record without prev_hash, key_id, record_hash and signature', () => {
    const input = serveInput();
    const body = buildAuditBody(input);
    const record = buildAuditRecord(input);
    const { prev_hash, key_id, record_hash, signature, ...rest } = record;
    expect(body).toEqual(rest);
    expect(prev_hash).toBe('genesis');
    expect(key_id).toBe(TEST_KEYS.key_id);
    expect(record_hash).toMatch(/^sha256:/);
    expect(signature).toMatch(/^ed25519:/);
  });

  it('throws for a missing conversation id, salt or an unusable signing key', () => {
    expect(() => buildAuditRecord(serveInput({ conversation_id: '' }))).toThrow(TypeError);
    expect(() => buildAuditRecord(serveInput({ app: { app_id: APP.app_id, salt: '' } }))).toThrow(
      TypeError,
    );
    expect(() =>
      buildAuditRecord(serveInput({ signing: { key_id: 'k_test', private_pem: 'garbage' } })),
    ).toThrow(AuditKeyError);
  });
});
