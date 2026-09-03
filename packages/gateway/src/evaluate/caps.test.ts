import { describe, expect, it } from 'vitest';

import { capStateFrom, utcDay } from './caps.js';

describe('utcDay', () => {
  it('is the UTC calendar day, whatever the local zone', () => {
    expect(utcDay(Date.UTC(2026, 8, 2, 23, 59, 59))).toBe('2026-09-02');
    expect(utcDay(Date.UTC(2026, 8, 3, 0, 0, 0))).toBe('2026-09-03');
  });
});

describe('capStateFrom', () => {
  it('is a fresh state for a conversation without a row', () => {
    expect(capStateFrom(undefined, 0)).toEqual({
      session_count: 0,
      day_count: 0,
      turns_since_last: null,
    });
  });

  it('keeps turns_since_last null until an ad was served', () => {
    expect(capStateFrom({ sessionCount: 0, turnCount: 3, lastTurnIndex: null }, 2)).toEqual({
      session_count: 0,
      day_count: 2,
      turns_since_last: null,
    });
  });

  it('derives turns_since_last from the turn counter and the last served index', () => {
    expect(capStateFrom({ sessionCount: 1, turnCount: 5, lastTurnIndex: 1 }, 1)).toEqual({
      session_count: 1,
      day_count: 1,
      turns_since_last: 4,
    });
    expect(
      capStateFrom({ sessionCount: 1, turnCount: 1, lastTurnIndex: 1 }, 0).turns_since_last,
    ).toBe(0);
  });
});
