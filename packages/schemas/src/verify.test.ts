import { describe, expect, it } from 'vitest';

import { VerifyCheck, VerifyCheckName, VerifyResponse } from './verify.js';

describe('VerifyResponse', () => {
  it('lists the docs/audit.md checks in order', () => {
    expect(VerifyCheckName.options).toEqual([
      'schema',
      'record_hash',
      'chain',
      'signature',
      'creative_hash',
      'disclosure_present',
      'separation_attested',
      'supersedes',
    ]);
  });

  it('accepts a failed verification with details', () => {
    const invalid = {
      valid: false,
      checks: [
        { name: 'schema', ok: true },
        { name: 'record_hash', ok: false, detail: 'expected sha256:a got sha256:b' },
        { name: 'supersedes', ok: true },
      ],
    };
    expect(VerifyResponse.parse(invalid)).toEqual(invalid);
  });

  it('rejects unknown check names and missing fields', () => {
    expect(VerifyCheck.safeParse({ name: 'vibes', ok: true }).success).toBe(false);
    expect(VerifyCheck.safeParse({ name: 'chain' }).success).toBe(false);
    expect(VerifyResponse.safeParse({ valid: true }).success).toBe(false);
    expect(VerifyResponse.safeParse({ valid: 'yes', checks: [] }).success).toBe(false);
  });
});
