import { describe, expect, it } from 'vitest';

import { CONTRACT_SCHEMAS } from './json-schema.js';
import {
  ED25519_SIGNATURE_PATTERN,
  Ed25519Signature,
  KEY_ID_PATTERN,
  KeyId,
  PUBLIC_KEY_PEM_PATTERN,
  PublicKeyPem,
  PublicKeysJson,
} from './keys.js';

// A real Ed25519 SPKI PEM (32-byte key, 44 base64 characters), as node:crypto exports it.
const PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAgyT4t5R2ed1ozS2OVWj8Lo5E/mmPqaqV9QkBu1ZKBqA=\n-----END PUBLIC KEY-----\n';
const PRIVATE_PEM =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIGy/7UtOICum6iNK5bfNZk5wJZX+wEkWYo8xGkl5eWML\n-----END PRIVATE KEY-----\n';

describe('KeyId', () => {
  it('accepts the docs example and the dev default', () => {
    expect(KeyId.safeParse('k_2026_09').success).toBe(true);
    expect(KeyId.safeParse('k_dev').success).toBe(true);
    expect(KeyId.safeParse('2026-09.a').success).toBe(true);
  });

  it('rejects empty, whitespace, "=" and over-long ids', () => {
    expect(KeyId.safeParse('').success).toBe(false);
    expect(KeyId.safeParse('k 2026').success).toBe(false);
    expect(KeyId.safeParse('k=2026').success).toBe(false);
    expect(KeyId.safeParse('_k').success).toBe(false);
    expect(KeyId.safeParse(`k${'0'.repeat(64)}`).success).toBe(false);
    expect(KeyId.safeParse(42).success).toBe(false);
    expect(KEY_ID_PATTERN.test('k_2026_09')).toBe(true);
  });
});

describe('Ed25519Signature', () => {
  it('requires the ed25519: prefix and a base64 body', () => {
    const body = 'A'.repeat(86);
    expect(Ed25519Signature.safeParse(`ed25519:${body}==`).success).toBe(true);
    expect(Ed25519Signature.safeParse(`ed25519:${body}`).success).toBe(true);
    expect(Ed25519Signature.safeParse('ed25519:').success).toBe(false);
    expect(Ed25519Signature.safeParse(`sha256:${body}==`).success).toBe(false);
    expect(Ed25519Signature.safeParse(`ed25519:${body}-_`).success).toBe(false);
    expect(Ed25519Signature.safeParse(`ed25519:${body}===`).success).toBe(false);
    expect(ED25519_SIGNATURE_PATTERN.test('ed25519:AQ==')).toBe(true);
  });
});

describe('PublicKeyPem', () => {
  it('accepts an SPKI PEM with LF or CRLF line breaks, with or without a trailing newline', () => {
    expect(PublicKeyPem.safeParse(PEM).success).toBe(true);
    expect(PublicKeyPem.safeParse(PEM.trimEnd()).success).toBe(true);
    expect(PublicKeyPem.safeParse(PEM.replace(/\n/g, '\r\n')).success).toBe(true);
    expect(PUBLIC_KEY_PEM_PATTERN.test(PEM)).toBe(true);
  });

  it('rejects private keys, one-line PEMs and anything that is not a PEM', () => {
    expect(PublicKeyPem.safeParse(PRIVATE_PEM).success).toBe(false);
    expect(PublicKeyPem.safeParse(PEM.replace(/\n/g, '')).success).toBe(false);
    expect(PublicKeyPem.safeParse(PEM.replace(/\n/g, ' ')).success).toBe(false);
    expect(PublicKeyPem.safeParse(' ' + PEM).success).toBe(false);
    expect(PublicKeyPem.safeParse('MCowBQYDK2VwAyEA').success).toBe(false);
    expect(PublicKeyPem.safeParse('').success).toBe(false);
  });
});

describe('PublicKeysJson', () => {
  it('is a key_id -> PEM map and accepts the empty .env.example default', () => {
    expect(PublicKeysJson.parse({})).toEqual({});
    expect(PublicKeysJson.parse({ k_2026_09: PEM, k_2026_03: PEM })).toEqual({
      k_2026_09: PEM,
      k_2026_03: PEM,
    });
  });

  it('rejects bad key ids, non-PEM values and non-objects', () => {
    expect(PublicKeysJson.safeParse({ 'k 1': PEM }).success).toBe(false);
    expect(PublicKeysJson.safeParse({ k_1: 'not a pem' }).success).toBe(false);
    expect(PublicKeysJson.safeParse({ k_1: PRIVATE_PEM }).success).toBe(false);
    expect(PublicKeysJson.safeParse({ k_1: 1 }).success).toBe(false);
    expect(PublicKeysJson.safeParse([PEM]).success).toBe(false);
    expect(PublicKeysJson.safeParse('{}').success).toBe(false);
    expect(PublicKeysJson.safeParse(null).success).toBe(false);
  });

  it('names the offending key in the issue path', () => {
    const result = PublicKeysJson.safeParse({ k_good: PEM, k_bad: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([['k_bad']]);
    }
  });

  it('is a contract schema together with the leaf shapes', () => {
    expect(CONTRACT_SCHEMAS.PublicKeysJson).toBe(PublicKeysJson);
    expect(CONTRACT_SCHEMAS.PublicKeyPem).toBe(PublicKeyPem);
    expect(CONTRACT_SCHEMAS.KeyId).toBe(KeyId);
    expect(CONTRACT_SCHEMAS.Ed25519Signature).toBe(Ed25519Signature);
  });
});
