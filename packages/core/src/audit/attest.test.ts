import { AuditRecord } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { attest, AuditAttestError, isAttested, isUnattested } from './attest.js';
import { computeRecordHash, nextPrevHash } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { AuditKeyError } from './errors.js';
import {
  ATTESTED_AT,
  attestedPair,
  MODEL_OUTPUT_HASH,
  OTHER_SIGNING,
  RING,
  serveRecord,
  SIGNING,
  suppressRecord,
} from './verify.fixture.js';

/** Everything attestation and chaining leave untouched. */
const CHANGED_BY_ATTEST = new Set([
  'model_output_hash',
  'separation_attestation',
  'attested_at',
  'supersedes_hash',
  'prev_hash',
  'key_id',
  'record_hash',
  'signature',
]);
const copiedBody = (record: AuditRecord): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !CHANGED_BY_ATTEST.has(key)));

const catchAttestError = (fn: () => unknown): AuditAttestError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AuditAttestError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an AuditAttestError');
};

describe('attest', () => {
  const { original, attested } = attestedPair();

  it('returns a NEW signed record that copies the original (docs/audit.md)', () => {
    expect(attested).not.toBe(original);
    expect(AuditRecord.parse(attested)).toEqual(attested);
    expect(copiedBody(attested)).toEqual(copiedBody(original));
    expect(Object.keys(attested).sort()).toEqual(Object.keys(original).sort());
    expect(attested.model_output_hash).toBe(MODEL_OUTPUT_HASH);
    expect(attested.separation_attestation).toBe(true);
    expect(attested.attested_at).toBe(ATTESTED_AT);
    expect(attested.supersedes_hash).toBe(original.record_hash);
    expect(attested.prev_hash).toBe(original.record_hash);
    expect(attested.key_id).toBe(TEST_KEYS.key_id);
    expect(attested.record_hash).not.toBe(original.record_hash);
    expect(attested.signature).not.toBe(original.signature);
  });

  it('keeps the same id: the audit_id the SDK holds names both versions', () => {
    expect(attested.id).toBe(original.id);
    expect(attested.app_id).toBe(original.app_id);
    expect(attested.ts).toBe(original.ts);
  });

  it('re-hashes and re-signs so the S13 ring verifies the new record', () => {
    expect(computeRecordHash(attested)).toBe(attested.record_hash);
    expect(RING.verify(attested.record_hash, attested.signature, attested.key_id)).toEqual({
      ok: true,
      detail: `key_id=${TEST_KEYS.key_id}`,
    });
    expect(RING.verify(original.record_hash, original.signature, original.key_id).ok).toBe(true);
  });

  it('neither mutates the original nor shares nested objects with it', () => {
    const fresh = serveRecord();
    const before = structuredClone(fresh);
    const result = attest(fresh, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(fresh),
      signing: SIGNING,
    });
    expect(fresh).toEqual(before);
    expect(result.classification).not.toBe(fresh.classification);
    expect(result.demand).not.toBe(fresh.demand);
    expect(result.creative).not.toBe(fresh.creative);
    expect(result.disclosure).not.toBe(fresh.disclosure);
    expect(result.policy_decisions).not.toBe(fresh.policy_decisions);
  });

  it('chains at the position the caller supplies and signs under the current key (rotation)', () => {
    const latest = suppressRecord({ id: 'aud_01JLATERRECORD', prev_hash: nextPrevHash(original) });
    const rotated = attest(original, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(latest),
      signing: OTHER_SIGNING,
    });
    expect(rotated.prev_hash).toBe(latest.record_hash);
    expect(rotated.supersedes_hash).toBe(original.record_hash);
    expect(rotated.key_id).toBe(OTHER_KEYS.key_id);
    expect(RING.verify(rotated.record_hash, rotated.signature, 'k_other').ok).toBe(true);
    expect(computeRecordHash(rotated)).toBe(rotated.record_hash);
  });

  it('attests suppress records too: the SDK attests every turn', () => {
    const suppressed = suppressRecord();
    const result = attest(suppressed, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(suppressed),
      signing: SIGNING,
    });
    expect(result.decision).toBe('suppress');
    expect(result.creative).toBeNull();
    expect(result.separation_attestation).toBe(true);
    expect(AuditRecord.parse(result)).toEqual(result);
  });

  it('is deterministic', () => {
    expect(attestedPair(original).attested).toEqual(attested);
  });

  it('drops unknown keys and fills override_rejected from the parsed record', () => {
    const withoutRejected = Object.fromEntries(
      Object.entries(original).filter(([key]) => key !== 'override_rejected'),
    );
    expect(withoutRejected).not.toHaveProperty('override_rejected');
    const loaded = { ...withoutRejected, note: 'added by hand' } as unknown as AuditRecord;
    const result = attest(loaded, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(original),
      signing: SIGNING,
    });
    expect(result).not.toHaveProperty('note');
    expect(result.override_rejected).toEqual([]);
    expect(computeRecordHash(result)).toBe(result.record_hash);
  });
});

describe('attest rejections', () => {
  const { original, attested } = attestedPair();
  const opts = { prev_hash: nextPrevHash(original), signing: SIGNING };

  it('rejects double attestation with reason already_attested', () => {
    const error = catchAttestError(() => attest(attested, MODEL_OUTPUT_HASH, ATTESTED_AT, opts));
    expect(error.reason).toBe('already_attested');
    expect(error.name).toBe('AuditAttestError');
    expect(error.message).toContain(original.id);
  });

  it('treats any attestation field already set as attested', () => {
    const partials: Partial<AuditRecord>[] = [
      { model_output_hash: MODEL_OUTPUT_HASH },
      { separation_attestation: true },
      { attested_at: ATTESTED_AT },
      { supersedes_hash: sha256Prefixed('prior') },
    ];
    for (const patch of partials) {
      const partial = { ...original, ...patch };
      expect(isUnattested(partial), JSON.stringify(patch)).toBe(false);
      expect(
        catchAttestError(() => attest(partial, MODEL_OUTPUT_HASH, ATTESTED_AT, opts)).reason,
      ).toBe('already_attested');
    }
    expect(isUnattested(original)).toBe(true);
    expect(isAttested(original)).toBe(false);
    expect(isAttested(attested)).toBe(true);
    expect(isAttested({ ...original, separation_attestation: true })).toBe(false);
  });

  it('rejects a model_output_hash that is not sha256:<64 lowercase hex digits>', () => {
    const digest = MODEL_OUTPUT_HASH.slice('sha256:'.length);
    for (const bad of [
      '',
      'abc',
      'sha256:',
      'sha256:abc',
      'SHA256:abc',
      `SHA256:${digest}`,
      `sha256:${digest.toUpperCase()}`,
      `sha256:${digest}0`,
      digest,
      42,
      null,
      undefined,
    ]) {
      const error = catchAttestError(() =>
        attest(original, bad as unknown as string, ATTESTED_AT, opts),
      );
      expect(error.reason, String(bad)).toBe('invalid_model_output_hash');
    }
  });

  it('rejects an attested_at that is not an ISO 8601 UTC timestamp', () => {
    for (const bad of ['', '2026-09-02 18:04:13', '2026-09-02T18:04:13+02:00', 'now', 0, null]) {
      const error = catchAttestError(() =>
        attest(original, MODEL_OUTPUT_HASH, bad as unknown as string, opts),
      );
      expect(error.reason, String(bad)).toBe('invalid_attested_at');
    }
  });

  it('rejects a prev_hash that is malformed or genesis: an attestation is never the first record', () => {
    for (const bad of ['genesis', '', 'abc', 42, undefined]) {
      const error = catchAttestError(() =>
        attest(original, MODEL_OUTPUT_HASH, ATTESTED_AT, {
          prev_hash: bad as unknown as string,
          signing: SIGNING,
        }),
      );
      expect(error.reason, String(bad)).toBe('invalid_prev_hash');
    }
  });

  it('rejects a record that is not an AuditRecord with reason invalid_record', () => {
    const broken = { ...original, decision: 'serve', creative: null } as unknown as AuditRecord;
    for (const bad of [null, undefined, 'record', 42, {}, [], broken]) {
      const error = catchAttestError(() =>
        attest(bad as unknown as AuditRecord, MODEL_OUTPUT_HASH, ATTESTED_AT, opts),
      );
      expect(error.reason, String(bad)).toBe('invalid_record');
    }
  });

  it('lets an unusable signing key surface as AuditKeyError (config error, not attest input)', () => {
    expect(() =>
      attest(original, MODEL_OUTPUT_HASH, ATTESTED_AT, {
        prev_hash: nextPrevHash(original),
        signing: { key_id: 'k_test', private_pem: 'garbage' },
      }),
    ).toThrow(AuditKeyError);
  });
});
