import { describe, expect, it } from 'vitest';

import {
  formatAmount,
  formatCount,
  formatDate,
  formatPercent,
  formatReason,
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

describe('formatPercent', () => {
  it('renders a rate with one decimal', () => {
    expect(formatPercent(0.45)).toBe('45.0%');
    expect(formatPercent(4 / 6)).toBe('66.7%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('renders an unknown rate as a dash, not as zero', () => {
    expect(formatPercent(null)).toBe('-');
  });
});

describe('formatAmount and formatCount', () => {
  it('shows two decimals and thousands separators', () => {
    expect(formatAmount(0.06)).toBe('0.06');
    expect(formatAmount(10)).toBe('10.00');
    expect(formatAmount(null)).toBe('-');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12345)).toBe('12,345');
  });
});

describe('formatReason', () => {
  it('spells out a sensitive category and leaves the fixed reasons alone', () => {
    expect(formatReason('sensitive_category:health')).toBe('sensitive: health');
    expect(formatReason('frequency_cap')).toBe('frequency_cap');
  });
});
