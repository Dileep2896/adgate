import { describe, expect, it } from 'vitest';

import { sha256Hex, sha256Prefixed } from './sha256.js';

describe('sha256', () => {
  it('matches the published SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the UTF-8 encoding of the text', () => {
    // sha256 of the bytes c3 a9 (U+00E9 in UTF-8).
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
  });

  it('prefixes with sha256: for the wire form', () => {
    expect(sha256Prefixed('abc')).toBe(`sha256:${sha256Hex('abc')}`);
    expect(sha256Prefixed('abc')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
