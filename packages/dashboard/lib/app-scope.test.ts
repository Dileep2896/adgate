import { describe, expect, it } from 'vitest';

import {
  ADMIN_SCOPE,
  type AppScope,
  isAdminScope,
  memberScope,
  ownsRow,
  scopeOwnerId,
} from './app-scope';

/**
 * The ownership rule, on its own, with no database in the way. Everything the scoped queries do
 * is this predicate rendered as SQL (lib/scope-queries.ts), so if these are wrong the queries
 * are wrong in the same direction.
 */

const ALICE = 'usr_01K4XG8Q0000000000000001';
const BOB = 'usr_01K4XG8Q0000000000000002';

describe('scopeOwnerId', () => {
  it('is the user id for a member and null for an admin', () => {
    expect(scopeOwnerId(memberScope(ALICE))).toBe(ALICE);
    expect(scopeOwnerId(ADMIN_SCOPE)).toBeNull();
  });

  it('null means "no owner filter", never "the rows with a null owner"', () => {
    // The distinction the whole change rests on: a CLI-created app has owner_user_id null and is
    // admin-only, while an ADMIN SCOPE has no owner filter at all and sees every row.
    expect(scopeOwnerId(ADMIN_SCOPE)).toBeNull();
    expect(ownsRow(ADMIN_SCOPE, null)).toBe(true);
    expect(ownsRow(memberScope(ALICE), null)).toBe(false);
  });
});

describe('ownsRow', () => {
  it('lets an admin read anything, including a row with no owner', () => {
    expect(ownsRow(ADMIN_SCOPE, ALICE)).toBe(true);
    expect(ownsRow(ADMIN_SCOPE, BOB)).toBe(true);
    expect(ownsRow(ADMIN_SCOPE, null)).toBe(true);
  });

  it('lets a member read only their own rows', () => {
    const alice = memberScope(ALICE);
    expect(ownsRow(alice, ALICE)).toBe(true);
    expect(ownsRow(alice, BOB)).toBe(false);
    expect(ownsRow(alice, null)).toBe(false);
  });
});

describe('isAdminScope', () => {
  it('is true only for the admin scope', () => {
    expect(isAdminScope(ADMIN_SCOPE)).toBe(true);
    expect(isAdminScope(memberScope(ALICE))).toBe(false);
  });
});

describe('the shape of AppScope', () => {
  it('gives an admin no user id at all, so a query cannot silently use one', () => {
    const scope: AppScope = ADMIN_SCOPE;
    expect(scope).toEqual({ role: 'admin' });
    expect('userId' in scope).toBe(false);
  });

  it('carries the user id on a member', () => {
    expect(memberScope(ALICE)).toEqual({ role: 'member', userId: ALICE });
  });
});
