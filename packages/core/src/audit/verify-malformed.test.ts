import { VerifyCheckName, VerifyResponse } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { sha256Prefixed } from './crypto.js';
import type { PublicKeyRing } from './keys.js';
import { verify, type VerifyContext } from './verify.js';
import { VERIFY_DETAIL } from './verify-checks.js';
import { CHECK_NAMES, checkOf, RING, serveRecord, suppressRecord } from './verify.fixture.js';

const NOT_RECORDS: unknown[] = [
  null,
  undefined,
  'aud_01J',
  42,
  true,
  [],
  {},
  { id: 'aud_01J' },
  [suppressRecord()],
  Object.create(null),
  () => suppressRecord(),
  new Date(0),
  { ...suppressRecord(), ts: 'yesterday' },
  { ...suppressRecord(), record_hash: 42 },
  { ...suppressRecord(), signature: 'sha256:abc' },
  { ...suppressRecord(), prev_hash: 'sha256:abc' },
  { ...suppressRecord(), record_hash: `sha256:${'A'.repeat(64)}` },
  { ...suppressRecord(), key_id: 'k 1' },
  { ...serveRecord(), creative: null },
  { ...suppressRecord(), reason: null },
  { ...suppressRecord(), classification: null },
];

describe('verify on malformed input', () => {
  it.each(NOT_RECORDS.map((value, index) => ({ index, value })))(
    'never throws and fails the schema check for input #$index',
    ({ value }) => {
      const result = verify(value, RING, {});
      expect(result.valid).toBe(false);
      expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
      expect(checkOf(result, 'schema').ok).toBe(false);
      expect(typeof checkOf(result, 'schema').detail).toBe('string');
      for (const check of result.checks.slice(1)) {
        expect(check).toEqual({ name: check.name, ok: false, detail: VERIFY_DETAIL.skipped });
      }
      expect(VerifyResponse.parse(result)).toEqual(result);
    },
  );

  it('names the failing path in the schema detail without echoing values', () => {
    const detail = checkOf(
      verify({ ...suppressRecord(), ts: 'yesterday' }, RING, {}),
      'schema',
    ).detail;
    expect(detail).toContain('ts');
    expect(detail).not.toContain('yesterday');
  });

  it('a record with an extra key passes the schema and fails record_hash', () => {
    const result = verify({ ...suppressRecord(), note: 'edited' }, RING, { prevRecord: null });
    expect(checkOf(result, 'schema').ok).toBe(true);
    expect(checkOf(result, 'record_hash').ok).toBe(false);
    expect(checkOf(result, 'chain').ok).toBe(true);
    expect(checkOf(result, 'signature').ok).toBe(true);
  });

  it('a value canonical JSON rejects fails record_hash with the error name, no throw', () => {
    const result = verify({ ...suppressRecord(), note: new Date(0) }, RING, { prevRecord: null });
    expect(checkOf(result, 'schema').ok).toBe(true);
    expect(checkOf(result, 'record_hash')).toEqual({
      name: 'record_hash',
      ok: false,
      detail: 'error: TypeError',
    });
    expect(checkOf(result, 'signature').ok).toBe(true);
  });

  it('survives a record whose properties throw on access', () => {
    const trap = new Proxy(suppressRecord(), {
      get: () => {
        throw new Error('boom');
      },
      ownKeys: () => {
        throw new Error('boom');
      },
    });
    const result = verify(trap, RING, {});
    expect(result.valid).toBe(false);
    expect(result.checks).toHaveLength(8);
    expect(checkOf(result, 'schema').ok).toBe(false);
  });

  it('survives a broken key ring: only the signature check fails', () => {
    const record = suppressRecord();
    for (const ring of [null, undefined, {}, { verify: 'nope' }, { verify: () => null }]) {
      const result = verify(record, ring as unknown as PublicKeyRing, { prevRecord: null });
      expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
      expect(checkOf(result, 'signature').ok).toBe(false);
      expect(checkOf(result, 'record_hash').ok).toBe(true);
      expect(checkOf(result, 'chain').ok).toBe(true);
    }
    const throwing = {
      key_ids: [],
      has: () => false,
      verify: () => {
        throw new TypeError('ring exploded');
      },
    };
    expect(checkOf(verify(record, throwing, {}), 'signature')).toEqual({
      name: 'signature',
      ok: false,
      detail: 'error: TypeError',
    });
  });

  it('treats a missing or garbage context as empty', () => {
    const record = suppressRecord();
    for (const ctx of [undefined, null, 'ctx', 42, []]) {
      const result = verify(record, RING, ctx as unknown as VerifyContext);
      expect(result.valid).toBe(true);
    }
    expect(verify(record, RING).valid).toBe(true);
  });

  it('survives a context that throws on inspection (the outer guard)', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const result = verify(suppressRecord(), RING, proxy as VerifyContext);
    expect(result.valid).toBe(false);
    expect(result.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
    expect(result.checks[0]?.detail).toBe('error: TypeError');
  });

  it('keeps the documented check order and names on every outcome', () => {
    expect(VerifyCheckName.options).toEqual(CHECK_NAMES);
    const outcomes = [
      verify(null, RING, {}),
      verify(suppressRecord(), RING, {}),
      verify(serveRecord(), RING, {}),
      verify({ ...suppressRecord(), prev_hash: sha256Prefixed('elsewhere') }, RING, {}),
    ];
    for (const outcome of outcomes) {
      expect(outcome.checks.map((check) => check.name)).toEqual(CHECK_NAMES);
      expect(VerifyResponse.parse(outcome)).toEqual(outcome);
    }
  });

  it('parses the docs/api.md verify example as a VerifyResponse', () => {
    const example = {
      valid: true,
      checks: [
        { name: 'schema', ok: true },
        { name: 'record_hash', ok: true },
        { name: 'chain', ok: true },
        { name: 'signature', ok: true, detail: 'key_id=k_2026_09' },
        { name: 'creative_hash', ok: true },
        { name: 'disclosure_present', ok: true },
        { name: 'separation_attested', ok: true },
      ],
    };
    expect(VerifyResponse.parse(example)).toEqual(example);
  });
});
