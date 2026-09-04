import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatPolicyVersion,
  formatTimestamp,
  HASH_HEAD_LENGTH,
  HASH_TAIL_LENGTH,
  truncateHash,
} from './format';

const HASH = `sha256:${'a1b2c3d4'.repeat(8)}`;

describe('truncateHash', () => {
  it('keeps the sha256 prefix, the head and the tail', () => {
    const short = truncateHash(HASH);
    expect(short.startsWith('sha256:')).toBe(true);
    expect(short).toBe(`${HASH.slice(0, HASH_HEAD_LENGTH)}...${HASH.slice(-HASH_TAIL_LENGTH)}`);
    expect(short).toContain('...');
    expect(short.length).toBeLessThan(HASH.length);
  });

  it('leaves a value that is already short enough alone', () => {
    expect(truncateHash('sha256:abc')).toBe('sha256:abc');
    expect(truncateHash('')).toBe('');
  });

  it('is idempotent: truncating a truncated hash changes nothing more', () => {
    const once = truncateHash(HASH);
    expect(truncateHash(once)).toBe(once);
  });

  it('never returns a prefix of a different hash for two different hashes', () => {
    const other = `sha256:${'9f8e7d6c'.repeat(8)}`;
    expect(truncateHash(other)).not.toBe(truncateHash(HASH));
  });
});

describe('formatTimestamp', () => {
  it('renders ISO 8601 UTC to the second', () => {
    expect(formatTimestamp(new Date('2026-09-04T12:34:56.789Z'))).toBe('2026-09-04 12:34:56Z');
  });

  it('renders a dash for null and undefined', () => {
    expect(formatTimestamp(null)).toBe('-');
    expect(formatTimestamp(undefined)).toBe('-');
  });
});

describe('formatDate', () => {
  it('renders the date part only', () => {
    expect(formatDate(new Date('2026-09-04T23:59:59Z'))).toBe('2026-09-04');
    expect(formatDate(null)).toBe('-');
  });
});

describe('formatPolicyVersion', () => {
  it('prefixes the number with v', () => {
    expect(formatPolicyVersion(1)).toBe('v1');
    expect(formatPolicyVersion(12)).toBe('v12');
  });
});
