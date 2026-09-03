import { describe, expect, it } from 'vitest';

import { type CapRow, capStateFrom, EMPTY_CAP_ROW, nextCapRow } from './caps.js';

const row = (patch: Partial<CapRow> = {}): CapRow => ({ ...EMPTY_CAP_ROW, ...patch });

describe('capStateFrom', () => {
  it('is a fresh state for a conversation without a row', () => {
    const fresh = { session_count: 0, day_count: 0, turns_since_last: null };
    expect(capStateFrom(null, 0)).toEqual(fresh);
    expect(capStateFrom(undefined, 0)).toEqual(fresh);
  });

  it('keeps turns_since_last null until an ad was served', () => {
    expect(capStateFrom(row({ turn_count: 3 }), 2)).toEqual({
      session_count: 0,
      day_count: 2,
      turns_since_last: null,
    });
  });

  it('derives turns_since_last from the turn counter and the last served index', () => {
    expect(capStateFrom(row({ session_count: 1, turn_count: 5, last_turn_index: 1 }), 1)).toEqual({
      session_count: 1,
      day_count: 1,
      turns_since_last: 4,
    });
    expect(
      capStateFrom(row({ session_count: 1, turn_count: 1, last_turn_index: 1 }), 0)
        .turns_since_last,
    ).toBe(0);
  });
});

describe('nextCapRow', () => {
  it('counts a turn without an ad and adopts the user hash', () => {
    expect(nextCapRow(null, { served: false, user_hash: 'sha256:u' })).toEqual({
      session_count: 0,
      turn_count: 1,
      last_turn_index: null,
      user_hash: 'sha256:u',
    });
    expect(nextCapRow(undefined, { served: false, user_hash: null })).toEqual(
      row({ turn_count: 1 }),
    );
  });

  it('a served ad bumps session_count and records the turn it was served at', () => {
    expect(nextCapRow(null, { served: true, user_hash: null })).toEqual(
      row({ session_count: 1, turn_count: 1, last_turn_index: 1 }),
    );
    const later = nextCapRow(row({ session_count: 1, turn_count: 4, last_turn_index: 1 }), {
      served: true,
      user_hash: null,
    });
    expect(later).toEqual(row({ session_count: 2, turn_count: 5, last_turn_index: 5 }));
  });

  it('keeps the first user hash seen and never mutates its input', () => {
    const before = row({ turn_count: 2, user_hash: 'sha256:first' });
    const frozen = Object.freeze({ ...before });
    const next = nextCapRow(frozen, { served: false, user_hash: 'sha256:second' });
    expect(next.user_hash).toBe('sha256:first');
    expect(frozen).toEqual(before);
    expect(next).not.toBe(frozen);
  });

  it('walks a conversation so turns_since_last resets at every served ad', () => {
    let current: CapRow | null = null;
    const since: (number | null)[] = [];
    for (const served of [true, false, false, true, false]) {
      since.push(capStateFrom(current, 0).turns_since_last);
      current = nextCapRow(current, { served, user_hash: null });
    }
    expect(since).toEqual([null, 0, 1, 2, 0]);
    expect(current).toEqual(row({ session_count: 2, turn_count: 5, last_turn_index: 4 }));
  });
});
