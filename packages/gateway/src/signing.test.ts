import { generateKeypair, keyFingerprint, sha256Prefixed, sign } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import { ConfigError } from './config.js';
import { loadSigningKeys } from './signing.js';

const pair = generateKeypair({ keyId: 'k_test' });
const other = generateKeypair({ keyId: 'k_old' });

describe('loadSigningKeys', () => {
  it('loads the signing key and adds its public half to the ring', () => {
    const keys = loadSigningKeys({
      keyId: 'k_test',
      privatePem: pair.private_pem,
      publicKeysJson: '{}',
    });
    expect(keys.signing).toEqual({ key_id: 'k_test', private_pem: pair.private_pem });
    expect(keys.ring.key_ids).toEqual(['k_test']);
    const hash = sha256Prefixed('record');
    expect(keys.ring.verify(hash, sign(hash, pair.private_pem), 'k_test')).toEqual({
      ok: true,
      detail: 'key_id=k_test',
    });
  });

  it('fingerprints the signing key so a deploy log shows a key that silently changed', () => {
    const load = (privatePem: string) =>
      loadSigningKeys({ keyId: 'k_test', privatePem, publicKeysJson: '{}' });
    expect(load(pair.private_pem).fingerprint).toBe(keyFingerprint(pair.public_pem));
    // Same key_id, different key material: the whole point is that this reads differently.
    expect(load(other.private_pem).fingerprint).not.toBe(load(pair.private_pem).fingerprint);
    // It is a public-key digest, never key material.
    expect(pair.private_pem).not.toContain(load(pair.private_pem).fingerprint);
  });

  it('keeps retired keys from the JSON next to the current one', () => {
    const keys = loadSigningKeys({
      keyId: 'k_test',
      privatePem: pair.private_pem,
      publicKeysJson: JSON.stringify({ k_old: other.public_pem }),
    });
    expect(keys.ring.key_ids).toEqual(['k_old', 'k_test']);
  });

  it('refuses a JSON entry for the signing key id that is not its public half', () => {
    const error = () =>
      loadSigningKeys({
        keyId: 'k_test',
        privatePem: pair.private_pem,
        publicKeysJson: JSON.stringify({ k_test: other.public_pem }),
      });
    expect(error).toThrow(ConfigError);
    expect(error).toThrow(/ADGATE_PUBLIC_KEYS_JSON/);
    expect(error).toThrow(/k_test/);
  });

  it('names the variable when the private key PEM is unusable', () => {
    const error = () =>
      loadSigningKeys({
        keyId: 'k_test',
        privatePem: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n',
        publicKeysJson: '{}',
      });
    expect(error).toThrow(ConfigError);
    expect(error).toThrow(/ADGATE_SIGNING_KEY_PEM/);
  });

  it('names the variable when the public keys JSON is malformed', () => {
    const error = () =>
      loadSigningKeys({ keyId: 'k_test', privatePem: pair.private_pem, publicKeysJson: '{' });
    expect(error).toThrow(ConfigError);
    expect(error).toThrow(/ADGATE_PUBLIC_KEYS_JSON/);
  });

  it('never puts key material into the error message', () => {
    try {
      loadSigningKeys({
        keyId: 'k_test',
        privatePem: pair.private_pem,
        publicKeysJson: JSON.stringify({ k_old: 'garbage' }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain('garbage');
      expect((error as Error).message).not.toContain(pair.private_pem.split('\n')[1]);
      return;
    }
    throw new Error('did not throw');
  });
});
