import { describe, expect, it } from 'vitest';

import { formatPolicyIssue } from './policy-issue';

describe('formatPolicyIssue', () => {
  it('prefixes the path', () => {
    expect(formatPolicyIssue({ path: 'privacy.retain_days', message: 'too big' })).toBe(
      'privacy.retain_days: too big',
    );
  });

  it('prints a root issue without a prefix', () => {
    expect(formatPolicyIssue({ path: '', message: 'YAML syntax: bad' })).toBe('YAML syntax: bad');
  });

  it('keeps array indexes readable', () => {
    expect(formatPolicyIssue({ path: 'demand[2].source', message: 'unknown' })).toBe(
      'demand[2].source: unknown',
    );
  });
});
