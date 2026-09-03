import { AuditRecord, PrevHash, type UnsignedAuditRecord } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { canonicalize } from '../canonical/canonicalize.js';
import { computeRecordHash, GENESIS, nextPrevHash, signRecord, unsignedOf } from './chain.js';
import { sha256Prefixed, verifySignature } from './crypto.js';
import { EC_KEYS, OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { AuditKeyError } from './errors.js';
import { buildAuditRecord } from './record.js';
import { serveInput } from './record.fixture.js';

const SIGNING = { key_id: TEST_KEYS.key_id, private_pem: TEST_KEYS.private_pem };
const record = buildAuditRecord(serveInput());

describe('GENESIS and nextPrevHash', () => {
  it('GENESIS is the literal genesis, a valid PrevHash', () => {
    expect(GENESIS).toBe('genesis');
    expect(PrevHash.parse(GENESIS)).toBe('genesis');
  });

  it('nextPrevHash is genesis without a previous record, else its record_hash', () => {
    expect(nextPrevHash(null)).toBe('genesis');
    expect(nextPrevHash(undefined)).toBe('genesis');
    expect(nextPrevHash(record)).toBe(record.record_hash);
    expect(nextPrevHash({ record_hash: 'sha256:abc' })).toBe('sha256:abc');
  });
});

describe('unsignedOf', () => {
  it('removes record_hash and signature and nothing else', () => {
    const unsigned = unsignedOf(record);
    expect(unsigned).not.toHaveProperty('record_hash');
    expect(unsigned).not.toHaveProperty('signature');
    expect(Object.keys(unsigned).sort()).toEqual(
      Object.keys(record)
        .filter((key) => key !== 'record_hash' && key !== 'signature')
        .sort(),
    );
    expect(unsignedOf(unsigned)).toEqual(unsigned);
  });

  it('keeps an added field, so an extra key changes the hash (the record is hashed as given)', () => {
    const extra = { ...record, note: 'added later' };
    expect(unsignedOf(extra)).toHaveProperty('note', 'added later');
    expect(computeRecordHash(extra)).not.toBe(record.record_hash);
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(record);
    unsignedOf(copy);
    expect(copy).toEqual(record);
  });
});

describe('computeRecordHash', () => {
  it('is sha256(canonical JSON without record_hash and signature + prev_hash), literally', () => {
    const expected = sha256Prefixed(`${canonicalize(unsignedOf(record))}${record.prev_hash}`);
    expect(computeRecordHash(record)).toBe(expected);
    expect(record.record_hash).toBe(expected);
    expect(computeRecordHash(unsignedOf(record))).toBe(expected);
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('ignores key order and whitespace concerns entirely (canonical JSON)', () => {
    const shuffled = Object.fromEntries(Object.entries(record).reverse()) as typeof record;
    expect(Object.keys(shuffled)[0]).not.toBe(Object.keys(record)[0]);
    expect(computeRecordHash(shuffled)).toBe(record.record_hash);
  });

  it('covers prev_hash: the same body under another prev_hash hashes differently', () => {
    const moved: UnsignedAuditRecord = { ...unsignedOf(record), prev_hash: sha256Prefixed('x') };
    expect(computeRecordHash(moved)).not.toBe(record.record_hash);
  });

  it('throws for a record that is not JSON (never a silently altered hash)', () => {
    const broken = { ...record, ts: new Date(0) } as unknown as typeof record;
    expect(() => computeRecordHash(broken)).toThrow(TypeError);
  });
});

describe('signRecord', () => {
  const unsigned = unsignedOf(record);

  it('adds record_hash and a signature that verifies under the signing key', () => {
    const signed = signRecord(unsigned, SIGNING);
    expect(signed).toEqual(record);
    expect(signed.record_hash).toBe(computeRecordHash(unsigned));
    expect(verifySignature(signed.record_hash, signed.signature, TEST_KEYS.public_pem)).toBe(true);
    expect(verifySignature(signed.record_hash, signed.signature, OTHER_KEYS.public_pem)).toBe(
      false,
    );
    expect(AuditRecord.parse(signed)).toEqual(signed);
  });

  it('signs under signing.key_id, replacing the key_id in the record (rotation, attestation)', () => {
    const rotated = signRecord(unsigned, {
      key_id: OTHER_KEYS.key_id,
      private_pem: OTHER_KEYS.private_pem,
    });
    expect(rotated.key_id).toBe('k_other');
    expect(rotated.record_hash).not.toBe(record.record_hash);
    expect(computeRecordHash(rotated)).toBe(rotated.record_hash);
    expect(verifySignature(rotated.record_hash, rotated.signature, OTHER_KEYS.public_pem)).toBe(
      true,
    );
  });

  it('discards a stale record_hash and signature when given an already signed record', () => {
    const stale = { ...record, ts: '2026-09-02T18:04:12Z' };
    const resigned = signRecord(stale, SIGNING);
    expect(resigned.record_hash).not.toBe(record.record_hash);
    expect(resigned.record_hash).toBe(computeRecordHash(resigned));
    expect(resigned.signature).not.toBe(record.signature);
  });

  it('is deterministic', () => {
    expect(signRecord(unsigned, SIGNING)).toEqual(signRecord(unsigned, SIGNING));
  });

  it('throws AuditKeyError for an unusable private key or a malformed key_id', () => {
    expect(() => signRecord(unsigned, { key_id: 'k_test', private_pem: 'garbage' })).toThrow(
      AuditKeyError,
    );
    expect(() =>
      signRecord(unsigned, { key_id: 'k_test', private_pem: TEST_KEYS.public_pem }),
    ).toThrow(AuditKeyError);
    expect(() =>
      signRecord(unsigned, { key_id: 'k_test', private_pem: EC_KEYS.privateKey }),
    ).toThrow(AuditKeyError);
    expect(() =>
      signRecord(unsigned, { key_id: 'k test', private_pem: SIGNING.private_pem }),
    ).toThrow(AuditKeyError);
    expect(() => signRecord(unsigned, { key_id: '', private_pem: SIGNING.private_pem })).toThrow(
      AuditKeyError,
    );
  });
});
