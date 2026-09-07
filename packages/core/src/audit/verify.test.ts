import { VerifyResponse } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { attest } from './attest.js';
import { nextPrevHash } from './chain.js';
import { OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { createKeyRing } from './keys.js';
import { verify } from './verify.js';
import { VERIFY_DETAIL } from './verify-checks.js';
import {
  ATTESTED_AT,
  attestedPair,
  CHECK_NAMES,
  checkOf,
  failedNames,
  MODEL_OUTPUT_HASH,
  OTHER_SIGNING,
  RING,
  serveRecord,
  SIGNING,
  STORED_CREATIVE_HASH,
  suppressRecord,
} from './verify.fixture.js';

describe('verify on intact records', () => {
  it('an attested serve record at the head of its chain is valid on every check', () => {
    const { original, attested } = attestedPair();
    const result = verify(attested, RING, {
      prevRecord: original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: { prevRecord: null, storedCreativeHash: STORED_CREATIVE_HASH },
    });
    expect(result.valid).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(checkOf(result, 'signature').detail).toBe(`key_id=${TEST_KEYS.key_id}`);
    expect(checkOf(result, 'supersedes').detail).toBe(VERIFY_DETAIL.superseded_verified);
    expect(VerifyResponse.parse(result)).toEqual(result);
  });

  it('reports the docs/api.md shape: ok checks without detail except signature', () => {
    const { original, attested } = attestedPair();
    const result = verify(attested, RING, {
      prevRecord: original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: { storedCreativeHash: STORED_CREATIVE_HASH },
    });
    expect(result.checks.slice(0, 7)).toEqual([
      { name: 'schema', ok: true },
      { name: 'record_hash', ok: true },
      { name: 'chain', ok: true },
      { name: 'signature', ok: true, detail: 'key_id=k_test' },
      { name: 'creative_hash', ok: true },
      { name: 'disclosure_present', ok: true },
      { name: 'separation_attested', ok: true },
    ]);
  });

  it('a genesis suppress record is valid on its own (separation and creative not applicable)', () => {
    const result = verify(suppressRecord(), RING, { prevRecord: null });
    expect(result.valid).toBe(true);
    expect(checkOf(result, 'chain').detail).toBe(VERIFY_DETAIL.genesis);
    expect(checkOf(result, 'creative_hash').detail).toBe(VERIFY_DETAIL.not_applicable);
    expect(checkOf(result, 'separation_attested').detail).toBe(VERIFY_DETAIL.not_applicable);
    expect(checkOf(result, 'supersedes').detail).toBe(VERIFY_DETAIL.not_applicable);
  });

  it('an unattested serve record fails only separation_attested (true only if attested)', () => {
    const result = verify(serveRecord(), RING, { storedCreativeHash: STORED_CREATIVE_HASH });
    expect(failedNames(result)).toEqual(['separation_attested']);
    expect(checkOf(result, 'separation_attested').detail).toBe(VERIFY_DETAIL.not_attested);
    expect(result.valid).toBe(false);
  });

  it('is valid on exactly { prevRecord, storedCreativeHash, supersededRecord, superseded: { prevRecord } }', () => {
    const { original, attested } = attestedPair();
    const result = verify(attested, RING, {
      prevRecord: original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: { prevRecord: null },
    });
    expect(result.valid).toBe(true);
    expect(failedNames(result)).toEqual([]);
  });

  it('is pure: the same inputs give the same report and the record is untouched', () => {
    const record = suppressRecord();
    const before = structuredClone(record);
    const first = verify(record, RING, {});
    const second = verify(record, RING, {});
    expect(first).toEqual(second);
    expect(record).toEqual(before);
  });
});

describe('verify across a key rotation', () => {
  const old = suppressRecord({ id: 'aud_01JOLDKEY' });
  const current = suppressRecord({
    id: 'aud_01JNEWKEY',
    prev_hash: nextPrevHash(old),
    signing: OTHER_SIGNING,
  });

  it('verifies a record under the retired key and one under the new key with one ring', () => {
    const oldResult = verify(old, RING, { prevRecord: null });
    const newResult = verify(current, RING, { prevRecord: old });
    expect(oldResult.valid).toBe(true);
    expect(newResult.valid).toBe(true);
    expect(checkOf(oldResult, 'signature').detail).toBe(`key_id=${TEST_KEYS.key_id}`);
    expect(checkOf(newResult, 'signature').detail).toBe(`key_id=${OTHER_KEYS.key_id}`);
  });

  it('dropping the retired key fails only the old record, with unknown_key_id', () => {
    const newOnly = createKeyRing({ [OTHER_KEYS.key_id]: OTHER_KEYS.public_pem });
    const oldResult = verify(old, newOnly, { prevRecord: null });
    expect(failedNames(oldResult)).toEqual(['signature']);
    expect(checkOf(oldResult, 'signature').detail).toBe('unknown_key_id');
    expect(verify(current, newOnly, { prevRecord: old }).valid).toBe(true);
  });
});

describe('verify after attestation', () => {
  it('the attested record verifies and its superseded record still verifies', () => {
    const { original, attested } = attestedPair();
    const originalCtx = { prevRecord: null, storedCreativeHash: STORED_CREATIVE_HASH };
    const attestedResult = verify(attested, RING, {
      prevRecord: original,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: originalCtx,
    });
    expect(attestedResult.valid).toBe(true);
    // The original stays intact: handed its superseding attestation (supersededBy, which the
    // gateway passes when it verifies an older version) it is fully valid.
    const originalResult = verify(original, RING, { ...originalCtx, supersededBy: attested });
    expect(originalResult.valid).toBe(true);
    expect(checkOf(originalResult, 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: true,
      detail: VERIFY_DETAIL.attested_by_superseding,
    });
    // Without it, only its separation is not attested; every integrity check still passes.
    const alone = verify(original, RING, originalCtx);
    expect(failedNames(alone)).toEqual(['separation_attested']);
    expect(checkOf(alone, 'separation_attested').detail).toBe(VERIFY_DETAIL.not_attested);
    for (const name of ['record_hash', 'chain', 'signature', 'creative_hash'] as const) {
      expect(checkOf(alone, name).ok, name).toBe(true);
    }
  });

  it('an attested suppress record and its original are both fully valid', () => {
    const { original, attested } = attestedPair(suppressRecord());
    expect(verify(original, RING, { prevRecord: null }).valid).toBe(true);
    const result = verify(attested, RING, {
      prevRecord: original,
      supersededRecord: original,
      superseded: { prevRecord: null },
    });
    expect(result.valid).toBe(true);
    expect(checkOf(result, 'separation_attested')).toEqual({
      name: 'separation_attested',
      ok: true,
    });
  });

  it('an attestation chained after later records verifies with that record as prevRecord', () => {
    const original = serveRecord({ id: 'aud_01JORIGINAL' });
    const later = suppressRecord({ id: 'aud_01JLATER', prev_hash: nextPrevHash(original) });
    // The gateway chains the attestation after the app's latest record, not after the original.
    const attested = attest(original, MODEL_OUTPUT_HASH, ATTESTED_AT, {
      prev_hash: nextPrevHash(later),
      signing: SIGNING,
    });
    expect(attested.prev_hash).toBe(later.record_hash);
    expect(attested.supersedes_hash).toBe(original.record_hash);
    const result = verify(attested, RING, {
      prevRecord: later,
      storedCreativeHash: STORED_CREATIVE_HASH,
      supersededRecord: original,
      superseded: { prevRecord: null, storedCreativeHash: STORED_CREATIVE_HASH },
    });
    expect(result.valid).toBe(true);
    expect(verify(later, RING, { prevRecord: original }).valid).toBe(true);
    // Handing it the original as prevRecord instead is a chain break.
    const wrongPrev = verify(attested, RING, { prevRecord: original });
    expect(checkOf(wrongPrev, 'chain').detail).toBe(VERIFY_DETAIL.previous_mismatch);
  });
});
