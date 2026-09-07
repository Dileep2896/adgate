import { prefixedUlid, type UlidOptions } from '@adgateio/core';
import { eq } from 'drizzle-orm';

import { burnVerifyTime, hashApiSecret, verifyApiSecret } from '../auth/keys.js';
import type { Db, DbOrTx } from '../db/client.js';
import { type UserRole, type UserRow, users } from '../db/tables/users.js';
import { isValidEmail, normalizeEmail, passwordIssues, USER_ID_PREFIX } from './credentials.js';

/**
 * Dashboard accounts, in the gateway rather than in the dashboard, for the same reason
 * registerApp lives here: it is the write, and a write that a Next.js server action owns is a
 * write no test can reach without a browser. Everything below is plain Drizzle over one table
 * and is covered by accounts/users.integration.test.ts against the Postgres test database.
 *
 * PASSWORDS REUSE THE API KEY HASHER (auth/keys.ts): argon2id at the OWASP minimum, verified
 * with argon2.verify, which is constant time by construction. There is deliberately no second
 * password implementation in this repository - one set of parameters, one verify, one decoy.
 *
 * NOTHING HERE THROWS FOR A USER MISTAKE. registerUser and authenticateUser return a tagged
 * result, so the dashboard renders a sentence rather than catching an exception it has to
 * classify. A database failure still throws: that is not the caller's mistake.
 */

export type { UserRole, UserRow };

/** A user as the dashboard may hold it: the password hash is never part of it. */
export interface AccountUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  lastLoginAt: Date | null;
}

const accountOf = (row: UserRow): AccountUser => ({
  id: row.id,
  email: row.email,
  role: row.role,
  createdAt: row.createdAt,
  lastLoginAt: row.lastLoginAt,
});

/** Postgres `unique_violation`: another request registered the same address first. */
const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === UNIQUE_VIOLATION;

export interface RegisterUserInput {
  email: string;
  password: string;
  /** 'member' unless an operator is minting an admin. Defaults to 'member'. */
  role?: UserRole | undefined;
  ulid?: UlidOptions | undefined;
}

export type RegisterUserFailure = 'invalid_email' | 'weak_password' | 'email_taken';

export type RegisterUserResult =
  /**
   * `passwordHash` comes back for one caller and one reason: the dashboard binds its session
   * cookie to a digest of it, exactly as it does after a sign-in, so signing the new account in
   * needs no second read. It is an argon2id hash, never the password.
   */
  | { ok: true; user: AccountUser; passwordHash: string }
  | { ok: false; error: RegisterUserFailure; issues: string[] };

/**
 * Creates one account. The address is normalized before the uniqueness check AND before the
 * insert, so `Ada@Example.com` and `ada@example.com` are the same account whichever one signed
 * up first. The race between the check and the insert is closed by the unique index, not by the
 * check: a duplicate that slips between them comes back as `email_taken` all the same.
 */
export const registerUser = async (
  db: DbOrTx,
  input: RegisterUserInput,
): Promise<RegisterUserResult> => {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { ok: false, error: 'invalid_email', issues: [] };
  }
  const issues = passwordIssues(input.password);
  if (issues.length > 0) {
    return { ok: false, error: 'weak_password', issues };
  }
  const existing = await findUserByEmail(db, email);
  if (existing !== null) {
    return { ok: false, error: 'email_taken', issues: [] };
  }

  const passwordHash = await hashApiSecret(input.password);
  const id = prefixedUlid(USER_ID_PREFIX, input.ulid);
  try {
    const [row] = await db
      .insert(users)
      .values({ id, email, passwordHash, role: input.role ?? 'member' })
      .returning();
    if (row === undefined) {
      throw new Error('registerUser: insert returned no row');
    }
    return { ok: true, user: accountOf(row), passwordHash };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'email_taken', issues: [] };
    }
    throw error;
  }
};

/** The row behind an address, or null. Normalizes first, so the caller never has to. */
export const findUserByEmail = async (db: DbOrTx, email: string): Promise<UserRow | null> => {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
};

/** The row behind a usr_ id, or null. The dashboard calls this on every session check. */
export const findUserById = async (db: DbOrTx, id: string): Promise<UserRow | null> => {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
};

export interface AuthenticateUserInput {
  email: string;
  password: string;
}

export type AuthenticateUserResult =
  | { ok: true; user: AccountUser; passwordHash: string }
  | { ok: false; error: 'invalid_credentials' };

/**
 * Checks an email and password. Both failure modes answer `invalid_credentials`, and an unknown
 * address still pays for one argon2 verify (burnVerifyTime, the decoy the API key middleware
 * already uses), so the response time does not say whether the account exists either.
 *
 * The caller gets the account AND its stored password hash: the dashboard binds its session
 * cookie to a digest of that hash, which is what makes a password change end every outstanding
 * session (packages/dashboard/lib/session.ts).
 */
export const authenticateUser = async (
  db: DbOrTx,
  input: AuthenticateUserInput,
): Promise<AuthenticateUserResult> => {
  const row = await findUserByEmail(db, input.email);
  if (row === null) {
    await burnVerifyTime(input.password);
    return { ok: false, error: 'invalid_credentials' };
  }
  if (!(await verifyApiSecret(row.passwordHash, input.password))) {
    return { ok: false, error: 'invalid_credentials' };
  }
  return { ok: true, user: accountOf(row), passwordHash: row.passwordHash };
};

/** Records a successful sign-in. Best effort bookkeeping: a failure here denies nobody. */
export const touchUserLogin = async (
  db: DbOrTx,
  id: string,
  now: Date = new Date(),
): Promise<void> => {
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, id));
};

export type ChangePasswordResult =
  | { ok: true; passwordHash: string }
  | { ok: false; error: 'weak_password' | 'user_not_found'; issues: string[] };

/**
 * Replaces an account's password. Every session signed against the OLD hash stops verifying the
 * moment this returns, because the cookie carries a digest of the hash it was issued under.
 */
export const changeUserPassword = async (
  db: Db,
  id: string,
  password: string,
): Promise<ChangePasswordResult> => {
  const issues = passwordIssues(password);
  if (issues.length > 0) {
    return { ok: false, error: 'weak_password', issues };
  }
  const passwordHash = await hashApiSecret(password);
  const rows = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length === 0
    ? { ok: false, error: 'user_not_found', issues: [] }
    : { ok: true, passwordHash };
};

/** Every account, newest first. The operator's account list; never reachable by a member. */
export const listUsers = async (db: DbOrTx): Promise<AccountUser[]> => {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(accountOf).reverse();
};
