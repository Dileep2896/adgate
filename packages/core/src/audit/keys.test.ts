import { PublicKeyPem } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { sign, verifySignature } from './crypto.js';
import {
  catchAuditKeyError,
  EC_KEYS,
  flipLastHexDigit,
  OTHER_KEYS,
  RECORD_HASH,
  tamperSignature,
  TEST_KEYS,
} from './crypto.fixture.js';
import { AuditKeyError } from './errors.js';
import {
  createKeyRing,
  defaultKeyId,
  derivePublicPem,
  generateKeypair,
  isKeyId,
  KEY_ID_PREFIX,
  parsePublicKeysJson,
} from './keys.js';

/** The docs/audit.md example timestamp: 2026-09-02T18:04:11Z. */
const SEPT_2026 = () => Date.UTC(2026, 8, 2, 18, 4, 11);
const PEM_BODY = TEST_KEYS.public_pem.split('\n')[1] ?? 'missing';

describe('generateKeypair', () => {
  it('returns PKCS#8 private and SPKI public PEM strings', () => {
    const pair = generateKeypair({ now: SEPT_2026 });
    expect(pair.private_pem).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n$/,
    );
    expect(pair.public_pem).toMatch(
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n$/,
    );
    expect(PublicKeyPem.safeParse(pair.public_pem).success).toBe(true);
    expect(Object.keys(pair).sort()).toEqual(['key_id', 'private_pem', 'public_pem']);
  });

  it('defaults key_id to k_<YYYY>_<MM> in UTC from the injected clock (docs example k_2026_09)', () => {
    expect(generateKeypair({ now: SEPT_2026 }).key_id).toBe('k_2026_09');
    expect(generateKeypair({ now: () => Date.UTC(2027, 0, 1) }).key_id).toBe('k_2027_01');
    expect(defaultKeyId(() => Date.UTC(2026, 11, 31, 23, 59, 59))).toBe('k_2026_12');
    expect(defaultKeyId(() => Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('k_2026_01');
    expect(defaultKeyId()).toMatch(/^k_\d{4}_\d{2}$/);
    expect(KEY_ID_PREFIX).toBe('k_');
  });

  it('accepts a custom key_id and rejects one that is not a KeyId', () => {
    expect(generateKeypair({ keyId: 'k_dev' }).key_id).toBe('k_dev');
    expect(generateKeypair({ keyId: 'k_dev', now: SEPT_2026 }).key_id).toBe('k_dev');
    const error = catchAuditKeyError(() => generateKeypair({ keyId: 'k dev' }));
    expect(error.reason).toBe('invalid_key_id');
    expect(error.key_id).toBe('k dev');
    expect(() => generateKeypair({ keyId: '' })).toThrow(AuditKeyError);
    expect(() => generateKeypair({ keyId: 'k=1' })).toThrow(AuditKeyError);
    expect(() => generateKeypair({ now: () => Number.NaN })).toThrow(AuditKeyError);
    expect(isKeyId('k_2026_09')).toBe(true);
    expect(isKeyId(7)).toBe(false);
  });

  it('generates a distinct pair each time, and each pair round trips on its own only', () => {
    const a = generateKeypair({ now: SEPT_2026 });
    const b = generateKeypair({ now: SEPT_2026 });
    expect(a.key_id).toBe(b.key_id);
    expect(a.private_pem).not.toBe(b.private_pem);
    expect(a.public_pem).not.toBe(b.public_pem);
    const signature = sign(RECORD_HASH, a.private_pem);
    expect(verifySignature(RECORD_HASH, signature, a.public_pem)).toBe(true);
    expect(verifySignature(RECORD_HASH, signature, b.public_pem)).toBe(false);
  });

  it('derivePublicPem gives the public half of a private PEM', () => {
    expect(derivePublicPem(TEST_KEYS.private_pem)).toBe(TEST_KEYS.public_pem);
    expect(() => derivePublicPem(TEST_KEYS.public_pem)).toThrow(AuditKeyError);
    expect(() => derivePublicPem(EC_KEYS.privateKey)).toThrow(AuditKeyError);
  });
});

describe('createKeyRing', () => {
  const ring = createKeyRing({
    k_2026_03: OTHER_KEYS.public_pem,
    k_2026_09: TEST_KEYS.public_pem,
  });
  const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);

  it('reports key_id=<id> on success, the docs/api.md verify detail', () => {
    expect(ring.verify(RECORD_HASH, signature, 'k_2026_09')).toEqual({
      ok: true,
      detail: 'key_id=k_2026_09',
    });
    expect(ring.key_ids).toEqual(['k_2026_03', 'k_2026_09']);
    expect(Object.isFrozen(ring.key_ids)).toBe(true);
    expect(ring.has('k_2026_09')).toBe(true);
    expect(ring.has('k_2027_01')).toBe(false);
  });

  it('reports unknown_key_id for a key_id the ring does not hold', () => {
    expect(ring.verify(RECORD_HASH, signature, 'k_2027_01')).toEqual({
      ok: false,
      detail: 'unknown_key_id',
    });
    expect(ring.verify(RECORD_HASH, signature, '')).toEqual({
      ok: false,
      detail: 'unknown_key_id',
    });
  });

  it('reports bad_signature for the wrong key, a tampered hash or a malformed signature', () => {
    const bad = { ok: false, detail: 'bad_signature' };
    expect(ring.verify(RECORD_HASH, signature, 'k_2026_03')).toEqual(bad);
    expect(ring.verify(flipLastHexDigit(RECORD_HASH), signature, 'k_2026_09')).toEqual(bad);
    expect(ring.verify(RECORD_HASH, tamperSignature(signature), 'k_2026_09')).toEqual(bad);
    expect(ring.verify(RECORD_HASH, signature.slice(0, -4), 'k_2026_09')).toEqual(bad);
    expect(ring.verify(RECORD_HASH, 'garbage', 'k_2026_09')).toEqual(bad);
  });

  it('never throws on garbage inputs', () => {
    const garbage: unknown[][] = [
      [undefined, undefined, undefined],
      [RECORD_HASH, signature, 42],
      [RECORD_HASH, {}, 'k_2026_09'],
      [null, signature, 'k_2026_09'],
      [RECORD_HASH, signature, '__proto__'],
      [RECORD_HASH, signature, 'constructor'],
      [RECORD_HASH, signature, 'toString'],
    ];
    for (const args of garbage) {
      const [hash, sig, keyId] = args as [string, string, string];
      expect(ring.verify(hash, sig, keyId).ok, JSON.stringify(args)).toBe(false);
    }
  });

  it('supports rotation: a record signed under a retired key still verifies by its key_id', () => {
    const retired = generateKeypair({ keyId: 'k_2025_01' });
    const current = generateKeypair({ keyId: 'k_2026_09' });
    const oldSignature = sign(RECORD_HASH, retired.private_pem);
    const rotated = createKeyRing({
      [retired.key_id]: retired.public_pem,
      [current.key_id]: current.public_pem,
    });
    expect(rotated.verify(RECORD_HASH, oldSignature, 'k_2025_01')).toEqual({
      ok: true,
      detail: 'key_id=k_2025_01',
    });
    expect(rotated.verify(RECORD_HASH, oldSignature, 'k_2026_09')).toEqual({
      ok: false,
      detail: 'bad_signature',
    });
    const newSignature = sign(RECORD_HASH, current.private_pem);
    expect(rotated.verify(RECORD_HASH, newSignature, 'k_2026_09').ok).toBe(true);
    expect(rotated.verify(RECORD_HASH, newSignature, 'k_2025_01').ok).toBe(false);
  });

  it('accepts an empty ring (the .env.example default) that knows no key', () => {
    const empty = createKeyRing({});
    expect(empty.key_ids).toEqual([]);
    expect(empty.verify(RECORD_HASH, signature, 'k_2026_09').detail).toBe('unknown_key_id');
  });

  it('throws AuditKeyError at construction for an unusable entry, naming its key_id', () => {
    const garbage = catchAuditKeyError(() =>
      createKeyRing({ k_ok: TEST_KEYS.public_pem, k_bad: 'garbage' }),
    );
    expect(garbage.reason).toBe('invalid_public_key');
    expect(garbage.key_id).toBe('k_bad');
    expect(garbage.message).toContain('key_id=k_bad');
    const asPrivate = catchAuditKeyError(() => createKeyRing({ k_p: TEST_KEYS.private_pem }));
    expect(asPrivate.reason).toBe('invalid_public_key');
    const ec = catchAuditKeyError(() => createKeyRing({ k_ec: EC_KEYS.publicKey }));
    expect(ec.reason).toBe('invalid_public_key');
    const badId = catchAuditKeyError(() => createKeyRing({ 'k 1': TEST_KEYS.public_pem }));
    expect(badId.reason).toBe('invalid_key_id');
    expect(badId.key_id).toBe('k 1');
    for (const value of [null, [], 'x', 1, undefined]) {
      const shape = catchAuditKeyError(() =>
        createKeyRing(value as unknown as Record<string, string>),
      );
      expect(shape.reason, String(value)).toBe('invalid_shape');
    }
  });
});

describe('parsePublicKeysJson', () => {
  it('parses the ADGATE_PUBLIC_KEYS_JSON shape and feeds createKeyRing', () => {
    const json = JSON.stringify({
      k_2026_09: TEST_KEYS.public_pem,
      k_2026_03: OTHER_KEYS.public_pem,
    });
    expect(json).toContain('\\n');
    const keys = parsePublicKeysJson(json);
    expect(keys).toEqual({ k_2026_09: TEST_KEYS.public_pem, k_2026_03: OTHER_KEYS.public_pem });
    const ring = createKeyRing(keys);
    const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);
    expect(ring.verify(RECORD_HASH, signature, 'k_2026_09')).toEqual({
      ok: true,
      detail: 'key_id=k_2026_09',
    });
    expect(parsePublicKeysJson('{}')).toEqual({});
  });

  it('throws AuditKeyError with reason invalid_json for text that is not JSON', () => {
    for (const text of ['', ' ', 'not json', '{', '{"k":', "{'k_1': 'x'}"]) {
      expect(catchAuditKeyError(() => parsePublicKeysJson(text)).reason, text).toBe('invalid_json');
    }
    const notString = catchAuditKeyError(() => parsePublicKeysJson(undefined as unknown as string));
    expect(notString.reason).toBe('invalid_json');
  });

  it('throws invalid_shape for non-objects, bad key ids and values that are not public PEMs', () => {
    const malformed = [
      '[]',
      '"x"',
      'null',
      '1',
      JSON.stringify({ 'k 1': TEST_KEYS.public_pem }),
      JSON.stringify({ k_1: 'garbage' }),
      JSON.stringify({ k_1: TEST_KEYS.private_pem }),
      JSON.stringify({ k_1: TEST_KEYS.public_pem.replace(/\n/g, '') }),
      JSON.stringify({ k_1: 5 }),
      JSON.stringify({ k_1: null }),
    ];
    for (const text of malformed) {
      expect(catchAuditKeyError(() => parsePublicKeysJson(text)).reason, text).toBe(
        'invalid_shape',
      );
    }
    const error = catchAuditKeyError(() =>
      parsePublicKeysJson(JSON.stringify({ k_good: TEST_KEYS.public_pem, k_bad: 'garbage' })),
    );
    expect(error.message).toContain('k_bad');
    expect(error.message).not.toContain('k_good');
  });

  it('throws invalid_public_key for a PEM that is not an Ed25519 public key', () => {
    const ec = catchAuditKeyError(() =>
      parsePublicKeysJson(JSON.stringify({ k_ec: EC_KEYS.publicKey })),
    );
    expect(ec.reason).toBe('invalid_public_key');
    expect(ec.key_id).toBe('k_ec');
    const broken = `-----BEGIN PUBLIC KEY-----\n${PEM_BODY.slice(0, 20)}\n-----END PUBLIC KEY-----\n`;
    const undecodable = catchAuditKeyError(() =>
      parsePublicKeysJson(JSON.stringify({ k_2026_09: broken })),
    );
    expect(undecodable.reason).toBe('invalid_public_key');
    expect(undecodable.key_id).toBe('k_2026_09');
  });

  it('never includes key material in an error message', () => {
    const attempts = [
      () => parsePublicKeysJson(JSON.stringify({ k_1: TEST_KEYS.private_pem })),
      () => parsePublicKeysJson(JSON.stringify({ k_1: EC_KEYS.publicKey })),
      () => parsePublicKeysJson(JSON.stringify({ 'k 1': TEST_KEYS.public_pem })),
      () => createKeyRing({ k_1: TEST_KEYS.private_pem }),
    ];
    const privateBody = TEST_KEYS.private_pem.split('\n')[1] ?? 'missing';
    const ecBody = EC_KEYS.publicKey.split('\n')[1] ?? 'missing';
    for (const attempt of attempts) {
      const error = catchAuditKeyError(attempt);
      expect(error.message).not.toContain(privateBody);
      expect(error.message).not.toContain(ecBody);
      expect(error.message).not.toContain(PEM_BODY);
    }
  });
});
