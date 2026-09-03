import { type AuditRecord, VerifyResponse } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { attest } from './attest.js';
import { nextPrevHash } from './chain.js';
import { sha256Prefixed } from './crypto.js';
import { flipLastHexDigit, OTHER_KEYS, tamperSignature, TEST_KEYS } from './crypto.fixture.js';
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

  it('is pure: the same inputs give the same report and the record is untouched', () => {
    const record = suppressRecord();
    const before = structuredClone(record);
    const first = verify(record, RING, {});
    const second = verify(record, RING, {});
    expect(first).toEqual(second);
    expect(record).toEqual(before);
  });
});

type Tamper = (record: AuditRecord) => void;

/** Field -> mutation -> the checks that must fail (every other check must still pass). */
const TAMPER_MATRIX: { field: string; tamper: Tamper; fails: string[] }[] = [
  {
    field: 'classification',
    tamper: (r) => {
      r.classification = { ...r.classification, sensitive: ['health'] };
    },
    fails: ['record_hash'],
  },
  {
    field: 'creative.content_hash',
    tamper: (r) => {
      if (r.creative !== null) {
        r.creative = { ...r.creative, content_hash: flipLastHexDigit(r.creative.content_hash) };
      }
    },
    fails: ['record_hash', 'creative_hash'],
  },
  {
    field: 'disclosure.label (blank)',
    tamper: (r) => {
      r.disclosure = { ...r.disclosure, label: ' ' };
    },
    fails: ['record_hash', 'disclosure_present'],
  },
  {
    field: 'disclosure.label (renamed)',
    tamper: (r) => {
      r.disclosure = { ...r.disclosure, label: 'Ad' };
    },
    fails: ['record_hash'],
  },
  {
    field: 'prev_hash',
    tamper: (r) => {
      r.prev_hash = sha256Prefixed('elsewhere');
    },
    fails: ['record_hash', 'chain'],
  },
  {
    field: 'signature',
    tamper: (r) => {
      r.signature = tamperSignature(r.signature);
    },
    fails: ['signature'],
  },
  {
    field: 'record_hash',
    tamper: (r) => {
      r.record_hash = flipLastHexDigit(r.record_hash);
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'key_id (another ring key)',
    tamper: (r) => {
      r.key_id = OTHER_KEYS.key_id;
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'key_id (unknown)',
    tamper: (r) => {
      r.key_id = 'k_unknown';
    },
    fails: ['record_hash', 'signature'],
  },
  {
    field: 'decision (serve to suppress with a creative)',
    tamper: (r) => {
      r.decision = 'suppress';
      r.reason = 'no_fill';
    },
    fails: ['schema'],
  },
];

describe('verify tamper matrix', () => {
  const first = suppressRecord({ id: 'aud_01JFIRST' });
  const { original, attested } = attestedPair(
    serveRecord({ id: 'aud_01JSECOND', prev_hash: nextPrevHash(first) }),
  );
  const ctx = {
    prevRecord: original,
    storedCreativeHash: STORED_CREATIVE_HASH,
    supersededRecord: original,
    superseded: { prevRecord: first, storedCreativeHash: STORED_CREATIVE_HASH },
  };

  it('starts from a fully valid attested record', () => {
    expect(verify(attested, RING, ctx).valid).toBe(true);
  });

  it.each(TAMPER_MATRIX)('changing $field fails exactly $fails', ({ tamper, fails }) => {
    const tampered = structuredClone(attested);
    tamper(tampered);
    const result = verify(tampered, RING, ctx);
    expect(result.valid).toBe(false);
    expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
    if (fails[0] === 'schema') {
      expect(failedNames(result)).toEqual(CHECK_NAMES);
    } else {
      expect(failedNames(result)).toEqual(fails);
    }
  });

  it('names the ring failure on the signature check', () => {
    const wrongKey = { ...attested, key_id: OTHER_KEYS.key_id };
    expect(checkOf(verify(wrongKey, RING, ctx), 'signature').detail).toBe('bad_signature');
    const unknown = { ...attested, key_id: 'k_unknown' };
    expect(checkOf(verify(unknown, RING, ctx), 'signature').detail).toBe('unknown_key_id');
  });

  it('an added field breaks record_hash: the record is hashed as loaded', () => {
    const extra = { ...attested, note: 'edited via SQL' };
    const result = verify(extra, RING, ctx);
    expect(failedNames(result)).toEqual(['record_hash']);
    expect(checkOf(result, 'schema').ok).toBe(true);
    expect(checkOf(result, 'record_hash').detail).toBe(VERIFY_DETAIL.hash_mismatch);
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
    // The original stays intact and verifiable on its own; only its separation is not yet
    // attested, which is exactly what the superseding record proves.
    const originalResult = verify(original, RING, originalCtx);
    expect(failedNames(originalResult)).toEqual(['separation_attested']);
    expect(checkOf(originalResult, 'separation_attested').detail).toBe(VERIFY_DETAIL.not_attested);
    for (const name of ['record_hash', 'chain', 'signature', 'creative_hash'] as const) {
      expect(checkOf(originalResult, name).ok, name).toBe(true);
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
