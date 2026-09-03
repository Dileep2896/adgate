import { createPublicKey, verify as nodeVerify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  decodeSignature,
  ED25519_SIGNATURE_BYTES,
  loadPrivateKey,
  loadPublicKey,
  sha256Hex,
  sha256Prefixed,
  sign,
  SIGNATURE_PREFIX,
  verifySignature,
} from './crypto.js';
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

const SIGNATURE_FORMAT = /^ed25519:[A-Za-z0-9+/]+={0,2}$/;
const rawBytes = (signature: string) =>
  Buffer.from(signature.slice(SIGNATURE_PREFIX.length), 'base64');

describe('sha256', () => {
  it('matches the published SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the UTF-8 encoding of a string, and raw bytes as given', () => {
    // sha256 of the bytes c3 a9 (U+00E9 in UTF-8).
    const expected = '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c';
    expect(sha256Hex('é')).toBe(expected);
    expect(sha256Hex(new Uint8Array([0xc3, 0xa9]))).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode('é'))).toBe(expected);
    expect(sha256Hex(new Uint8Array(0))).toBe(sha256Hex(''));
  });

  it('prefixes with sha256: for the wire form', () => {
    expect(sha256Prefixed('abc')).toBe(`sha256:${sha256Hex('abc')}`);
    expect(sha256Prefixed('abc')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256Prefixed(new TextEncoder().encode('abc'))).toBe(sha256Prefixed('abc'));
  });
});

describe('sign', () => {
  it('returns exactly ed25519: followed by base64 of the 64 raw signature bytes', () => {
    const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);
    expect(signature).toMatch(SIGNATURE_FORMAT);
    expect(signature.startsWith(SIGNATURE_PREFIX)).toBe(true);
    expect(rawBytes(signature)).toHaveLength(ED25519_SIGNATURE_BYTES);
    expect(signature).toHaveLength(SIGNATURE_PREFIX.length + 88);
    expect(signature.endsWith('==')).toBe(true);
  });

  it('signs the UTF-8 bytes of the record_hash string exactly as given, prefix included', () => {
    const raw = rawBytes(sign(RECORD_HASH, TEST_KEYS.private_pem));
    const publicKey = createPublicKey(TEST_KEYS.public_pem);
    expect(nodeVerify(null, Buffer.from(RECORD_HASH, 'utf8'), publicKey, raw)).toBe(true);
    const bareHex = RECORD_HASH.slice('sha256:'.length);
    expect(nodeVerify(null, Buffer.from(bareHex, 'utf8'), publicKey, raw)).toBe(false);
    expect(nodeVerify(null, Buffer.from(bareHex, 'hex'), publicKey, raw)).toBe(false);
  });

  it('is deterministic for one hash and key, and differs per hash and per key', () => {
    const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);
    expect(sign(RECORD_HASH, TEST_KEYS.private_pem)).toBe(signature);
    expect(sign(flipLastHexDigit(RECORD_HASH), TEST_KEYS.private_pem)).not.toBe(signature);
    expect(sign(RECORD_HASH, OTHER_KEYS.private_pem)).not.toBe(signature);
  });

  it('throws AuditKeyError for a key that is not an Ed25519 PKCS#8 PEM', () => {
    const truncated = `${TEST_KEYS.private_pem.slice(0, 44)}\n-----END PRIVATE KEY-----\n`;
    for (const pem of ['', 'garbage', TEST_KEYS.public_pem, EC_KEYS.privateKey, truncated]) {
      expect(() => sign(RECORD_HASH, pem), pem).toThrow(AuditKeyError);
    }
    const error = catchAuditKeyError(() => sign(RECORD_HASH, EC_KEYS.privateKey));
    expect(error.reason).toBe('invalid_private_key');
    expect(error.message).toContain('ec');
    expect(error.name).toBe('AuditKeyError');
  });

  it('throws TypeError for a missing or empty hash', () => {
    expect(() => sign('', TEST_KEYS.private_pem)).toThrow(TypeError);
    expect(() => sign(undefined as unknown as string, TEST_KEYS.private_pem)).toThrow(TypeError);
  });
});

describe('verifySignature', () => {
  const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);

  it('round trips', () => {
    expect(verifySignature(RECORD_HASH, signature, TEST_KEYS.public_pem)).toBe(true);
  });

  it('fails when one hex character of the hash is tampered with', () => {
    expect(verifySignature(flipLastHexDigit(RECORD_HASH), signature, TEST_KEYS.public_pem)).toBe(
      false,
    );
    const bareHex = RECORD_HASH.slice('sha256:'.length);
    expect(verifySignature(bareHex, signature, TEST_KEYS.public_pem)).toBe(false);
    expect(verifySignature(RECORD_HASH.toUpperCase(), signature, TEST_KEYS.public_pem)).toBe(false);
    expect(verifySignature(`${RECORD_HASH} `, signature, TEST_KEYS.public_pem)).toBe(false);
  });

  it('fails when the signature bytes are tampered with', () => {
    const tampered = tamperSignature(signature);
    expect(tampered).not.toBe(signature);
    expect(tampered).toMatch(SIGNATURE_FORMAT);
    expect(verifySignature(RECORD_HASH, tampered, TEST_KEYS.public_pem)).toBe(false);
  });

  it('returns false, never throws, for a malformed signature', () => {
    const body = signature.slice(SIGNATURE_PREFIX.length);
    const malformed = [
      `sha256:${body}`,
      `ED25519:${body}`,
      body,
      `ed25519:${body.slice(0, 40)}`,
      `ed25519:${body.slice(0, -2)}`,
      `ed25519:${body}==`,
      `ed25519:${body}A`,
      `ed25519:${body} `,
      `ed25519:${body.slice(0, -2)}=A`,
      `ed25519:${'A'.repeat(88)}`,
      `ed25519:${'A'.repeat(86)}==`,
      'ed25519:',
      'ed25519',
      '',
    ];
    for (const candidate of malformed) {
      expect(verifySignature(RECORD_HASH, candidate, TEST_KEYS.public_pem), candidate).toBe(false);
    }
    for (const candidate of [42, null, undefined, {}, [signature]]) {
      const value = candidate as unknown as string;
      expect(verifySignature(RECORD_HASH, value, TEST_KEYS.public_pem)).toBe(false);
    }
  });

  it("returns false for another key's public PEM, a non-Ed25519 key and garbage PEM", () => {
    expect(verifySignature(RECORD_HASH, signature, OTHER_KEYS.public_pem)).toBe(false);
    expect(verifySignature(RECORD_HASH, signature, EC_KEYS.publicKey)).toBe(false);
    const garbage = [
      '',
      'garbage',
      '-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----\n',
      TEST_KEYS.private_pem,
      TEST_KEYS.public_pem.replace(/\n/g, ''),
      undefined as unknown as string,
      42 as unknown as string,
    ];
    for (const pem of garbage) {
      expect(verifySignature(RECORD_HASH, signature, pem), String(pem)).toBe(false);
    }
  });

  it('returns false for a non-string or empty hash', () => {
    expect(verifySignature('', signature, TEST_KEYS.public_pem)).toBe(false);
    expect(verifySignature(undefined as unknown as string, signature, TEST_KEYS.public_pem)).toBe(
      false,
    );
    expect(verifySignature(1 as unknown as string, signature, TEST_KEYS.public_pem)).toBe(false);
  });

  it('works with keys serialised to PEM strings and re-loaded from JSON, as they come from env', () => {
    const env = JSON.stringify({
      ADGATE_SIGNING_KEY_PEM: TEST_KEYS.private_pem,
      ADGATE_PUBLIC_KEYS_JSON: JSON.stringify({ [TEST_KEYS.key_id]: TEST_KEYS.public_pem }),
    });
    expect(env).toContain('\\n');
    const loaded = JSON.parse(env) as Record<string, string>;
    const publicKeys = JSON.parse(loaded['ADGATE_PUBLIC_KEYS_JSON'] ?? '') as Record<
      string,
      string
    >;
    const reSigned = sign(RECORD_HASH, loaded['ADGATE_SIGNING_KEY_PEM'] ?? '');
    expect(reSigned).toBe(signature);
    expect(verifySignature(RECORD_HASH, reSigned, publicKeys[TEST_KEYS.key_id] ?? '')).toBe(true);
    expect(verifySignature(RECORD_HASH, reSigned, `${TEST_KEYS.public_pem.trimEnd()}`)).toBe(true);
  });
});

describe('decodeSignature', () => {
  it('returns the 64 raw bytes for a well-formed signature and null otherwise', () => {
    const signature = sign(RECORD_HASH, TEST_KEYS.private_pem);
    const bytes = decodeSignature(signature);
    expect(bytes).not.toBeNull();
    expect(bytes).toHaveLength(64);
    expect(Buffer.from(bytes ?? []).equals(rawBytes(signature))).toBe(true);
    expect(decodeSignature(signature.slice(0, -1))).toBeNull();
    expect(decodeSignature(`sha256:${signature.slice(SIGNATURE_PREFIX.length)}`)).toBeNull();
    expect(decodeSignature(`ed25519:${'A'.repeat(88)}`)).toBeNull();
    expect(decodeSignature(`ed25519:${'A'.repeat(86)}==`)).toHaveLength(64);
    expect(decodeSignature(null as unknown as string)).toBeNull();
  });
});

describe('loadPublicKey and loadPrivateKey', () => {
  it('load Ed25519 PEMs and refuse the other kind, other algorithms and garbage', () => {
    expect(loadPublicKey(TEST_KEYS.public_pem).asymmetricKeyType).toBe('ed25519');
    expect(loadPrivateKey(TEST_KEYS.private_pem).asymmetricKeyType).toBe('ed25519');
    // node:crypto would derive a public key from a private PEM; the header check refuses it.
    expect(() => loadPublicKey(TEST_KEYS.private_pem)).toThrow(AuditKeyError);
    expect(() => loadPrivateKey(TEST_KEYS.public_pem)).toThrow(AuditKeyError);
    expect(() => loadPublicKey(EC_KEYS.publicKey)).toThrow(AuditKeyError);
    expect(() => loadPrivateKey(EC_KEYS.privateKey)).toThrow(AuditKeyError);
    expect(() => loadPublicKey('garbage')).toThrow(AuditKeyError);
    expect(() => loadPublicKey(undefined as unknown as string)).toThrow(AuditKeyError);
  });

  it('names the key_id in the error and never echoes key material', () => {
    const body = TEST_KEYS.public_pem.split('\n')[1] ?? 'missing';
    const broken = `-----BEGIN PUBLIC KEY-----\n${body.slice(0, 20)}\n-----END PUBLIC KEY-----\n`;
    const error = catchAuditKeyError(() => loadPublicKey(broken, 'k_x'));
    expect(error.reason).toBe('invalid_public_key');
    expect(error.key_id).toBe('k_x');
    expect(error.message).toContain('key_id=k_x');
    expect(error.message).not.toContain(body.slice(0, 20));
    const ecError = catchAuditKeyError(() => loadPublicKey(EC_KEYS.publicKey, 'k_ec'));
    expect(ecError.message).toContain('not ed25519');
    expect(ecError.key_id).toBe('k_ec');
    const privateError = catchAuditKeyError(() => loadPrivateKey('garbage'));
    expect(privateError.key_id).toBeUndefined();
    expect(privateError.message).not.toContain('garbage');
  });
});
