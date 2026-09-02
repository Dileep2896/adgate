import { describe, expect, it } from 'vitest';

import {
  ULID_LENGTH,
  ULID_PATTERN,
  ULID_TIME_MAX,
  encodeUlidRandom,
  encodeUlidTime,
  isUlid,
  prefixedUlid,
  ulid,
  ulidTime,
} from './ulid.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const zeros = bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

describe('encodeUlidTime', () => {
  it('encodes 48 bits of milliseconds as 10 Crockford base32 characters', () => {
    expect(encodeUlidTime(0)).toBe('0000000000');
    expect(encodeUlidTime(31)).toBe('000000000Z');
    expect(encodeUlidTime(32)).toBe('0000000010');
    expect(encodeUlidTime(ULID_TIME_MAX)).toBe('7ZZZZZZZZZ');
  });

  it('rejects negative, fractional and out of range times', () => {
    expect(() => encodeUlidTime(-1)).toThrow(RangeError);
    expect(() => encodeUlidTime(1.5)).toThrow(RangeError);
    expect(() => encodeUlidTime(ULID_TIME_MAX + 1)).toThrow(RangeError);
    expect(() => encodeUlidTime(Number.NaN)).toThrow(RangeError);
  });

  it('round-trips through ulidTime', () => {
    for (const time of [0, 1, 1469918176385, 1_700_000_000_000, ULID_TIME_MAX]) {
      expect(ulidTime(encodeUlidTime(time) + 'ZZZZZZZZZZZZZZZZ')).toBe(time);
    }
  });
});

describe('encodeUlidRandom', () => {
  it('encodes 10 bytes as 16 characters, most significant bits first', () => {
    expect(encodeUlidRandom(zeros)).toBe('0000000000000000');
    expect(encodeUlidRandom(bytes(255, 255, 255, 255, 255, 255, 255, 255, 255, 255))).toBe(
      'ZZZZZZZZZZZZZZZZ',
    );
    // 0x08 0x42 0x10 0x84 0x21 is the 5-bit group 00001 repeated eight times.
    expect(
      encodeUlidRandom(bytes(0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10, 0x84, 0x21)),
    ).toBe('1111111111111111');
    expect(encodeUlidRandom(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 1))).toBe('0000000000000001');
    expect(encodeUlidRandom(bytes(0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('G000000000000000');
  });

  it('rejects the wrong number of bytes', () => {
    expect(() => encodeUlidRandom(bytes(1, 2, 3))).toThrow(RangeError);
  });
});

describe('ulid', () => {
  it('is deterministic with an injected clock and randomness', () => {
    const options = { now: () => 1_700_000_000_000, random: () => zeros };
    expect(ulid(options)).toBe(encodeUlidTime(1_700_000_000_000) + '0000000000000000');
    expect(ulid(options)).toBe(ulid(options));
    expect(prefixedUlid('cr_', options)).toBe(`cr_${ulid(options)}`);
  });

  it('uses the real clock and node:crypto by default', () => {
    const before = Date.now();
    const id = ulid();
    expect(id).toHaveLength(ULID_LENGTH);
    expect(id).toMatch(ULID_PATTERN);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)).toBeGreaterThanOrEqual(before);
    expect(ulidTime(id)).toBeLessThanOrEqual(Date.now());
    expect(new Set(Array.from({ length: 50 }, () => ulid())).size).toBe(50);
  });

  it('isUlid and ulidTime reject the ambiguous letters and prefixed ids', () => {
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(true);
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FAI')).toBe(false);
    expect(isUlid('cr_01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(false);
    expect(isUlid('01arYZ6S41TSV4RRFFQ69G5FAV')).toBe(false);
    expect(() => ulidTime('nope')).toThrow(RangeError);
  });
});
