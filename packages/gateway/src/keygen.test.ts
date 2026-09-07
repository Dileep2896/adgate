import { derivePublicPem, loadPrivateKey, parsePublicKeysJson } from '@adgateio/core';
import { describe, expect, it } from 'vitest';

import { unescapeNewlines } from './config.js';
import { generateKeygenOutput, parseKeygenArgs, renderKeygenOutput } from './keygen.js';

const KEYPAIR = {
  key_id: 'k_2026_09',
  private_pem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n',
  public_pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n',
};

const envValue = (output: string, name: string): string => {
  const line = output.split('\n').find((candidate) => candidate.startsWith(`${name}=`));
  if (line === undefined) {
    throw new Error(`${name} not in output`);
  }
  return line.slice(name.length + 1);
};

describe('keygen', () => {
  it('renders the three env lines ready to paste into .env', () => {
    const output = renderKeygenOutput(KEYPAIR);
    expect(envValue(output, 'ADGATE_SIGNING_KEY_ID')).toBe('k_2026_09');
    const pem = envValue(output, 'ADGATE_SIGNING_KEY_PEM');
    expect(pem.startsWith('"')).toBe(true);
    expect(pem.endsWith('"')).toBe(true);
    expect(pem).not.toContain('\n');
    expect(unescapeNewlines(pem.slice(1, -1))).toBe(KEYPAIR.private_pem);
    const json = envValue(output, 'ADGATE_PUBLIC_KEYS_JSON');
    expect(JSON.parse(json)).toEqual({ k_2026_09: KEYPAIR.public_pem });
  });

  it('generates a usable Ed25519 pair whose public half matches the JSON entry', () => {
    const output = generateKeygenOutput({ keyId: 'k_test' });
    const privatePem = unescapeNewlines(envValue(output, 'ADGATE_SIGNING_KEY_PEM').slice(1, -1));
    expect(() => loadPrivateKey(privatePem)).not.toThrow();
    const ring = parsePublicKeysJson(envValue(output, 'ADGATE_PUBLIC_KEYS_JSON'));
    expect(ring['k_test']).toBe(derivePublicPem(privatePem));
  });

  it('defaults the key id to the k_<YYYY>_<MM> form and accepts --key-id', () => {
    expect(parseKeygenArgs([])).toEqual({});
    expect(parseKeygenArgs(['--key-id', 'k_rotated'])).toEqual({ keyId: 'k_rotated' });
    expect(parseKeygenArgs(['--key-id=k_rotated'])).toEqual({ keyId: 'k_rotated' });
    expect(() => parseKeygenArgs(['--bogus'])).toThrow(/--key-id/);
    expect(envValue(generateKeygenOutput({}), 'ADGATE_SIGNING_KEY_ID')).toMatch(/^k_\d{4}_\d{2}$/);
  });
});
