import { createHash, createPublicKey } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EC_KEYS, OTHER_KEYS, TEST_KEYS } from './crypto.fixture.js';
import { AuditKeyError } from './errors.js';
import { derivePublicPem, KEY_FINGERPRINT_HEX_CHARS, keyFingerprint } from './keys.js';

/**
 * The boot-time key fingerprint. Its whole value is that it is the SAME string for the same key
 * every time it is computed, and a DIFFERENT one the moment the key changes - so these are the
 * two properties the tests pin, plus the exact digest, so the value an operator reads out of a
 * deploy log can be reproduced with openssl.
 */

describe('keyFingerprint', () => {
  it('is stable for the same key however its PEM is written', () => {
    const fingerprint = keyFingerprint(TEST_KEYS.public_pem);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).toHaveLength(KEY_FINGERPRINT_HEX_CHARS);
    // The same key, spelled differently: no trailing newline, and CRLF line endings.
    expect(keyFingerprint(TEST_KEYS.public_pem.trimEnd())).toBe(fingerprint);
    expect(keyFingerprint(TEST_KEYS.public_pem.replace(/\n/g, '\r\n'))).toBe(fingerprint);
    // And through the private half, which is how the gateway derives the key it logs.
    expect(keyFingerprint(derivePublicPem(TEST_KEYS.private_pem))).toBe(fingerprint);
  });

  it('differs for another key', () => {
    expect(keyFingerprint(OTHER_KEYS.public_pem)).not.toBe(keyFingerprint(TEST_KEYS.public_pem));
  });

  it('is the first 16 hex characters of the SHA-256 of the SPKI DER', () => {
    const der = createPublicKey(TEST_KEYS.public_pem).export({ type: 'spki', format: 'der' });
    const digest = createHash('sha256').update(der).digest('hex');
    expect(keyFingerprint(TEST_KEYS.public_pem)).toBe(digest.slice(0, 16));
  });

  it('refuses anything that is not an Ed25519 public PEM, key material included', () => {
    expect(() => keyFingerprint(TEST_KEYS.private_pem)).toThrow(AuditKeyError);
    expect(() => keyFingerprint(EC_KEYS.publicKey)).toThrow(AuditKeyError);
    expect(() => keyFingerprint('not a pem')).toThrow(AuditKeyError);
  });
});
