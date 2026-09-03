import { describe, expect, it } from 'vitest';

import {
  API_KEY_PATTERN,
  ARGON2_OPTIONS,
  burnVerifyTime,
  generateApiKey,
  hashApiSecret,
  isArgon2idHash,
  KEY_PREFIX_LENGTH,
  parseApiKey,
  parseBearerHeader,
  verifyApiSecret,
} from './keys.js';

describe('generateApiKey', () => {
  it('produces ak_<prefix>_<secret> with an alphanumeric prefix and a base64url secret', () => {
    const key = generateApiKey();
    expect(key.api_key).toMatch(API_KEY_PATTERN);
    expect(key.api_key).toBe(`ak_${key.key_prefix}_${key.secret}`);
    expect(key.key_prefix).toMatch(/^[A-Za-z0-9]+$/);
    expect(key.key_prefix).toHaveLength(KEY_PREFIX_LENGTH);
    // 32 random bytes as unpadded base64url.
    expect(key.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats a prefix or a secret across many keys', () => {
    const keys = Array.from({ length: 200 }, () => generateApiKey());
    expect(new Set(keys.map((key) => key.key_prefix)).size).toBe(keys.length);
    expect(new Set(keys.map((key) => key.secret)).size).toBe(keys.length);
  });

  it('uses every byte of the injected randomness source without modulo bias artefacts', () => {
    const zeros = generateApiKey((length) => new Uint8Array(length));
    expect(zeros.key_prefix).toBe('A'.repeat(KEY_PREFIX_LENGTH));
    expect(zeros.secret).toBe('A'.repeat(43));
  });
});

describe('parseApiKey / parseBearerHeader', () => {
  const key = generateApiKey();

  it('splits a well-formed key into prefix and secret', () => {
    expect(parseApiKey(key.api_key)).toEqual({ key_prefix: key.key_prefix, secret: key.secret });
  });

  it('rejects anything that is not exactly the documented shape', () => {
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('ak_')).toBeNull();
    expect(parseApiKey('ak_short_x')).toBeNull();
    expect(parseApiKey(`sk_${key.key_prefix}_${key.secret}`)).toBeNull();
    expect(parseApiKey(`ak_${key.key_prefix}_${key.secret} `)).toBeNull();
    expect(parseApiKey(`ak_${key.key_prefix}_${key.secret}\n`)).toBeNull();
    expect(parseApiKey(`ak_${key.key_prefix}_${key.secret}/x`)).toBeNull();
    expect(parseApiKey(`ak_pre-fix000000_${key.secret}`)).toBeNull();
  });

  it('accepts the Bearer scheme case-insensitively and nothing else', () => {
    const parsed = { key_prefix: key.key_prefix, secret: key.secret };
    expect(parseBearerHeader(`Bearer ${key.api_key}`)).toEqual(parsed);
    expect(parseBearerHeader(`bearer ${key.api_key}`)).toEqual(parsed);
    expect(parseBearerHeader(`Bearer   ${key.api_key}`)).toEqual(parsed);
    expect(parseBearerHeader(undefined)).toBeNull();
    expect(parseBearerHeader('')).toBeNull();
    expect(parseBearerHeader(key.api_key)).toBeNull();
    expect(parseBearerHeader(`Basic ${key.api_key}`)).toBeNull();
    expect(parseBearerHeader(`Bearer ${key.api_key} extra`)).toBeNull();
    expect(parseBearerHeader('Bearer ')).toBeNull();
  });
});

describe('hashApiSecret / verifyApiSecret', () => {
  it('hashes with argon2id at the configured cost and verifies the same secret', async () => {
    const { secret } = generateApiKey();
    const hashed = await hashApiSecret(secret);
    expect(hashed).toMatch(/^\$argon2id\$v=19\$/);
    // argon2 writes the PHC parameters alphabetically (m, p, t); check each one.
    expect(hashed).toContain(`m=${ARGON2_OPTIONS.memoryCost},`);
    expect(hashed).toContain(`,t=${ARGON2_OPTIONS.timeCost}$`);
    expect(hashed).toContain(`,p=${ARGON2_OPTIONS.parallelism},`);
    expect(isArgon2idHash(hashed)).toBe(true);
    expect(hashed).not.toContain(secret);
    await expect(verifyApiSecret(hashed, secret)).resolves.toBe(true);
  });

  it('rejects a different secret, a prefix-only guess and an empty string', async () => {
    const { secret } = generateApiKey();
    const hashed = await hashApiSecret(secret);
    await expect(verifyApiSecret(hashed, generateApiKey().secret)).resolves.toBe(false);
    await expect(verifyApiSecret(hashed, secret.slice(0, -1))).resolves.toBe(false);
    await expect(verifyApiSecret(hashed, `${secret}A`)).resolves.toBe(false);
    await expect(verifyApiSecret(hashed, '')).resolves.toBe(false);
  });

  it('salts every hash so equal secrets hash differently', async () => {
    const { secret } = generateApiKey();
    const [first, second] = await Promise.all([hashApiSecret(secret), hashApiSecret(secret)]);
    expect(first).not.toBe(second);
  });

  it('never throws on a corrupt stored hash: it verifies false', async () => {
    await expect(verifyApiSecret('', 'x')).resolves.toBe(false);
    await expect(verifyApiSecret('not-a-hash', 'x')).resolves.toBe(false);
    await expect(verifyApiSecret('$argon2id$v=19$m=1,t=1,p=1$$', 'x')).resolves.toBe(false);
    expect(isArgon2idHash('$2b$10$abc')).toBe(false);
    expect(isArgon2idHash('$argon2i$v=19$m=1,t=1,p=1$abc$def')).toBe(false);
  });

  it('burnVerifyTime runs a real verification against a decoy hash and resolves', async () => {
    await expect(burnVerifyTime(generateApiKey().secret)).resolves.toBeUndefined();
    await expect(burnVerifyTime('')).resolves.toBeUndefined();
  });
});
