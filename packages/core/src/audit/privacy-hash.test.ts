import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { conversationIdHash, normalizeSha256Hash, userHash } from './privacy-hash.js';

const hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const DIGEST = hex('user-1');
const SALT = 'per-app-salt';

describe('conversationIdHash', () => {
  it('is sha256(app_salt + conversation_id) written as sha256:<hex> (docs/audit.md)', () => {
    expect(conversationIdHash(SALT, 'conv_abc')).toBe(`sha256:${hex(`${SALT}conv_abc`)}`);
    expect(conversationIdHash(SALT, 'conv_abc')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes with the salt and with the id, and never contains the raw id', () => {
    const hash = conversationIdHash(SALT, 'conv_abc');
    expect(conversationIdHash('other-salt', 'conv_abc')).not.toBe(hash);
    expect(conversationIdHash(SALT, 'conv_abd')).not.toBe(hash);
    expect(hash).not.toContain('conv_abc');
    expect(hash).not.toContain(SALT);
  });

  it('throws TypeError for a missing salt or id: a misconfigured app fails loudly', () => {
    expect(() => conversationIdHash('', 'conv_abc')).toThrow(TypeError);
    expect(() => conversationIdHash(SALT, '')).toThrow(TypeError);
    expect(() => conversationIdHash(undefined as unknown as string, 'conv_abc')).toThrow(TypeError);
    expect(() => conversationIdHash(SALT, 42 as unknown as string)).toThrow(TypeError);
  });
});

describe('userHash', () => {
  it('is null when the request carried no user hash', () => {
    expect(userHash(SALT, undefined)).toBeNull();
    expect(userHash(SALT, null)).toBeNull();
    expect(userHash(SALT, '')).toBeNull();
  });

  it('normalises a 64-hex digest, prefixed or bare, to sha256:<lowercase hex>', () => {
    expect(userHash(SALT, DIGEST)).toBe(`sha256:${DIGEST}`);
    expect(userHash(SALT, `sha256:${DIGEST}`)).toBe(`sha256:${DIGEST}`);
    expect(userHash(SALT, DIGEST.toUpperCase())).toBe(`sha256:${DIGEST}`);
    expect(userHash(SALT, `SHA256:${DIGEST.toUpperCase()}`)).toBe(`sha256:${DIGEST}`);
    // Already a hash: it is never re-hashed, whatever the salt.
    expect(userHash('other-salt', DIGEST)).toBe(`sha256:${DIGEST}`);
  });

  it('salts and hashes anything that is not a digest, so a raw id is never stored', () => {
    for (const raw of ['user_42', 'optional sha256', hex('x').slice(0, 40), `sha256:${DIGEST}0`]) {
      const hashed = userHash(SALT, raw);
      expect(hashed, raw).toBe(`sha256:${hex(`${SALT}${raw}`)}`);
      expect(hashed).not.toContain(raw);
    }
    expect(userHash('other-salt', 'user_42')).not.toBe(userHash(SALT, 'user_42'));
  });

  it('throws TypeError for a non-string value or a missing salt', () => {
    expect(() => userHash(SALT, 42 as unknown as string)).toThrow(TypeError);
    expect(() => userHash('', 'user_42')).toThrow(TypeError);
    // A digest needs no salt, but the salt is still required so callers cannot forget it.
    expect(() => userHash('', DIGEST)).toThrow(TypeError);
  });
});

describe('normalizeSha256Hash', () => {
  it('returns the sha256:<lowercase hex> form of a digest and null for anything else', () => {
    expect(normalizeSha256Hash(DIGEST)).toBe(`sha256:${DIGEST}`);
    expect(normalizeSha256Hash(`sha256:${DIGEST.toUpperCase()}`)).toBe(`sha256:${DIGEST}`);
    expect(normalizeSha256Hash('sha256:...')).toBeNull();
    expect(normalizeSha256Hash(` ${DIGEST}`)).toBeNull();
    expect(normalizeSha256Hash('')).toBeNull();
    expect(normalizeSha256Hash(undefined)).toBeNull();
    expect(normalizeSha256Hash(42)).toBeNull();
  });
});
