import { describe, expect, it } from 'vitest';

import { resolveClaims } from './auth';
import { OPERATOR_USER_ID, type SessionClaims, type SessionRole } from './session';

/**
 * WHAT A SIGNED COOKIE IS STILL NOT ALLOWED TO DECIDE.
 *
 * verifySessionToken() proves a token is authentic; resolveClaims() decides whether the account
 * behind it still backs it. These are the three things it must refuse even though the signature
 * is perfect: an account that is gone, a password that has changed since, and a role the cookie
 * claims but the database does not.
 *
 * The lookup is injected, so this needs no database and no request scope.
 */

const EXPIRES = new Date('2026-09-07T00:00:00.000Z');
const ALICE = 'usr_01K4XG8Q0000000000000001';

const lookup = (
  user: { email: string; role: SessionRole; tag: string } | null,
  operatorTag = 'admin-tag',
) => ({
  operatorTag: () => Promise.resolve(operatorTag),
  findUser: () => Promise.resolve(user),
});

const claims = (patch: Partial<SessionClaims> = {}): SessionClaims => ({
  userId: ALICE,
  role: 'member',
  tag: 'alice-tag',
  ...patch,
});

describe('resolveClaims for an account', () => {
  it('resolves a member to their own scope', async () => {
    const session = await resolveClaims(
      claims(),
      EXPIRES,
      lookup({ email: 'ada@example.com', role: 'member', tag: 'alice-tag' }),
    );
    expect(session).toEqual({
      userId: ALICE,
      role: 'member',
      email: 'ada@example.com',
      scope: { role: 'member', userId: ALICE },
      expiresAt: EXPIRES,
    });
  });

  it('refuses a cookie whose account no longer exists', async () => {
    expect(await resolveClaims(claims(), EXPIRES, lookup(null))).toBeNull();
  });

  it('refuses a cookie minted against the OLD password', async () => {
    // secretTag() is a digest of the stored argon2id hash, so changing the password changes it.
    const session = await resolveClaims(
      claims({ tag: 'the-old-tag' }),
      EXPIRES,
      lookup({ email: 'ada@example.com', role: 'member', tag: 'the-new-tag' }),
    );
    expect(session).toBeNull();
  });

  it('takes the role from the DATABASE, not from the cookie', async () => {
    // A promotion takes effect on the next request without a new sign-in...
    const promoted = await resolveClaims(
      claims({ role: 'member' }),
      EXPIRES,
      lookup({ email: 'ada@example.com', role: 'admin', tag: 'alice-tag' }),
    );
    expect(promoted?.role).toBe('admin');
    expect(promoted?.scope).toEqual({ role: 'admin' });

    // ...and so does a demotion, which is the direction that matters.
    const demoted = await resolveClaims(
      claims({ role: 'admin' }),
      EXPIRES,
      lookup({ email: 'ada@example.com', role: 'member', tag: 'alice-tag' }),
    );
    expect(demoted?.role).toBe('member');
    expect(demoted?.scope).toEqual({ role: 'member', userId: ALICE });
  });
});

describe('resolveClaims for the break-glass operator', () => {
  it('resolves the ADMIN_PASSWORD login without touching the accounts table', async () => {
    const session = await resolveClaims(
      { userId: OPERATOR_USER_ID, role: 'admin', tag: 'admin-tag' },
      EXPIRES,
      {
        operatorTag: () => Promise.resolve('admin-tag'),
        findUser: () => {
          throw new Error('the operator has no account row and must not be looked up');
        },
      },
    );
    expect(session).toEqual({
      userId: OPERATOR_USER_ID,
      role: 'admin',
      email: null,
      scope: { role: 'admin' },
      expiresAt: EXPIRES,
    });
  });

  it('refuses an operator cookie minted against a rotated ADMIN_PASSWORD', async () => {
    const session = await resolveClaims(
      { userId: OPERATOR_USER_ID, role: 'admin', tag: 'the-old-password-tag' },
      EXPIRES,
      lookup(null, 'the-new-password-tag'),
    );
    expect(session).toBeNull();
  });

  it('refuses an operator cookie that claims the member role', async () => {
    // Not a downgrade: `operator` is the admin identity, so a token shaped like this is a forgery
    // attempt and is refused outright.
    const session = await resolveClaims(
      { userId: OPERATOR_USER_ID, role: 'member', tag: 'admin-tag' },
      EXPIRES,
      lookup(null),
    );
    expect(session).toBeNull();
  });
});
