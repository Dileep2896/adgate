import { describe, expect, it } from 'vitest';

import {
  ALL_APPS,
  ANY_DECISION,
  ANY_REASON,
  auditHref,
  auditWindow,
  decodeCursor,
  DEFAULT_WINDOW_DAYS,
  defaultAuditFilters,
  encodeCursor,
  parseAuditCursor,
  parseAuditFilters,
  parseDay,
  utcDay,
} from './audit-filters';

const NOW = new Date('2026-09-04T13:45:00.000Z');

describe('defaultAuditFilters', () => {
  it('covers the last seven days, ending today, inclusive at both ends', () => {
    const filters = defaultAuditFilters(NOW);
    expect(filters.to).toBe('2026-09-04');
    expect(filters.from).toBe('2026-08-29');
    expect(filters.appId).toBe(ALL_APPS);
    expect(filters.decision).toBe(ANY_DECISION);
    expect(filters.reason).toBe(ANY_REASON);

    const window = auditWindow(filters);
    const days = (window.until.getTime() - window.since.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(DEFAULT_WINDOW_DAYS);
  });

  it('ends the window at midnight AFTER the last day, so today is included', () => {
    const window = auditWindow(defaultAuditFilters(NOW));
    expect(window.since.toISOString()).toBe('2026-08-29T00:00:00.000Z');
    expect(window.until.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(NOW.getTime()).toBeLessThan(window.until.getTime());
  });
});

describe('parseDay', () => {
  it('accepts a real UTC calendar day', () => {
    expect(parseDay('2026-02-28')).toBe('2026-02-28');
    expect(utcDay(new Date('2026-02-28T23:59:59.999Z'))).toBe('2026-02-28');
  });

  it('rejects a malformed or impossible day', () => {
    for (const value of ['', '2026-9-4', '04/09/2026', '2026-02-30', '2026-13-01', 'yesterday']) {
      expect(parseDay(value), value).toBeNull();
    }
  });
});

describe('parseAuditFilters', () => {
  it('falls back to the defaults for anything it does not recognise', () => {
    const filters = parseAuditFilters(
      { app: '', from: 'nonsense', to: '2026-13-40', decision: 'maybe', reason: '' },
      NOW,
    );
    expect(filters).toEqual(defaultAuditFilters(NOW));
  });

  it('keeps the values it does recognise, including a sensitive category reason', () => {
    const filters = parseAuditFilters(
      {
        app: 'app_123',
        from: '2026-01-01',
        to: '2026-01-31',
        decision: 'suppress',
        reason: 'sensitive_category:health',
      },
      NOW,
    );
    expect(filters).toEqual({
      appId: 'app_123',
      from: '2026-01-01',
      to: '2026-01-31',
      decision: 'suppress',
      reason: 'sensitive_category:health',
    });
  });

  it('swaps a reversed range rather than showing an empty page', () => {
    const filters = parseAuditFilters({ from: '2026-03-10', to: '2026-03-01' }, NOW);
    expect(filters.from).toBe('2026-03-01');
    expect(filters.to).toBe('2026-03-10');
  });

  it('reads the first value when a parameter repeats', () => {
    expect(parseAuditFilters({ decision: ['serve', 'suppress'] }, NOW).decision).toBe('serve');
  });
});

describe('the keyset cursor', () => {
  const position = {
    ts: new Date('2026-09-04T10:00:00.000Z'),
    recordHash: `sha256:${'a'.repeat(64)}`,
  };

  it('round trips through a query string', () => {
    const encoded = encodeCursor(position);
    expect(encoded).toBe(`2026-09-04T10:00:00.000Z|sha256:${'a'.repeat(64)}`);
    expect(decodeCursor(encoded)).toEqual(position);
  });

  it('is dropped when it is unreadable, so a mangled link shows the first page', () => {
    for (const value of [
      '',
      'sha256:abc',
      '|',
      'not-a-date|sha256:abc',
      `${position.ts.toISOString()}|`,
    ]) {
      expect(decodeCursor(value), value).toBeNull();
    }
    expect(parseAuditCursor({ after: 'broken' })).toBeNull();
  });

  it('reads a forward cursor as older and a backward one as newer', () => {
    const encoded = encodeCursor(position);
    expect(parseAuditCursor({ after: encoded })).toEqual({ direction: 'older', ...position });
    expect(parseAuditCursor({ before: encoded })).toEqual({ direction: 'newer', ...position });
    // `after` wins when both are present: a link only ever carries one.
    expect(parseAuditCursor({ after: encoded, before: encoded })?.direction).toBe('older');
  });

  it('writes every filter into the link, so a shared URL keeps meaning the same thing', () => {
    const filters = parseAuditFilters({ app: 'app_1', decision: 'suppress' }, NOW);
    const href = auditHref(filters, { direction: 'older', ...position });
    expect(href.startsWith('/audit?')).toBe(true);
    const params = new URLSearchParams(href.slice('/audit?'.length));
    expect(params.get('app')).toBe('app_1');
    expect(params.get('decision')).toBe('suppress');
    expect(params.get('from')).toBe(filters.from);
    expect(params.get('to')).toBe(filters.to);
    expect(params.get('reason')).toBe(ANY_REASON);
    expect(params.get('after')).toBe(encodeCursor(position));
    expect(params.get('before')).toBeNull();
  });

  it('omits the cursor when there is none', () => {
    const href = auditHref(defaultAuditFilters(NOW));
    expect(href).not.toContain('after=');
    expect(href).not.toContain('before=');
  });
});
