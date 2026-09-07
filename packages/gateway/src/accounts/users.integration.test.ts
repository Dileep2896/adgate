import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { apps, users } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { MIN_PASSWORD_LENGTH } from './credentials.js';
import {
  authenticateUser,
  changeUserPassword,
  findUserByEmail,
  findUserById,
  listUsers,
  registerUser,
  touchUserLogin,
} from './users.js';

/**
 * The account writes against the real database, because the rules that matter are enforced by
 * the table (one address per account) and by argon2 (a hash that is not the password).
 */

const url = requireTestDatabaseUrl();
let handle: DbHandle;

const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await handle.close();
});

describe('registerUser', () => {
  it('stores one member with a lowercased address and an argon2id hash', async () => {
    const result = await registerUser(handle.db, {
      email: ' Ada@Example.COM ',
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.user.id).toMatch(/^usr_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(result.user.email).toBe('ada@example.com');
    expect(result.user.role).toBe('member');
    expect(result.user.lastLoginAt).toBeNull();

    const [row] = await handle.db.select().from(users).where(eq(users.id, result.user.id));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    // The stored value is not the password, in any casing or encoding.
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  it('refuses a second account on the same address, whatever case it is written in', async () => {
    const again = await registerUser(handle.db, { email: 'ADA@example.com', password: PASSWORD });
    expect(again).toEqual({ ok: false, error: 'email_taken', issues: [] });
    expect(await listUsers(handle.db)).toHaveLength(1);
  });

  it('refuses an address it will not store, and writes nothing', async () => {
    const before = await listUsers(handle.db);
    expect(await registerUser(handle.db, { email: 'not-an-email', password: PASSWORD })).toEqual({
      ok: false,
      error: 'invalid_email',
      issues: [],
    });
    expect(await listUsers(handle.db)).toHaveLength(before.length);
  });

  it('refuses a short password before it hashes anything', async () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const result = await registerUser(handle.db, { email: 'grace@example.com', password: short });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe('weak_password');
    expect(result.issues[0]).toContain(String(MIN_PASSWORD_LENGTH));
    expect(await findUserByEmail(handle.db, 'grace@example.com')).toBeNull();
  });

  it('mints an admin when one is asked for', async () => {
    const result = await registerUser(handle.db, {
      email: 'operator@example.com',
      password: PASSWORD,
      role: 'admin',
    });
    expect(result.ok && result.user.role).toBe('admin');
  });
});

describe('authenticateUser', () => {
  it('accepts the right password whatever case the address is typed in', async () => {
    const result = await authenticateUser(handle.db, {
      email: '  ADA@Example.com ',
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.user.email).toBe('ada@example.com');
    expect(result.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('answers the SAME failure for an unknown address and a wrong password', async () => {
    const unknown = await authenticateUser(handle.db, {
      email: 'nobody@example.com',
      password: PASSWORD,
    });
    const wrong = await authenticateUser(handle.db, {
      email: 'ada@example.com',
      password: 'definitely not the password',
    });
    expect(unknown).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(wrong).toEqual(unknown);
  });

  it('records the sign-in when the caller asks it to', async () => {
    const user = await findUserByEmail(handle.db, 'ada@example.com');
    expect(user?.lastLoginAt).toBeNull();
    const now = new Date('2026-09-06T10:00:00.000Z');
    await touchUserLogin(handle.db, user?.id ?? '', now);
    expect((await findUserById(handle.db, user?.id ?? ''))?.lastLoginAt).toEqual(now);
  });
});

describe('changeUserPassword', () => {
  it('replaces the hash, so a session bound to the old one can be told apart', async () => {
    const before = await findUserByEmail(handle.db, 'ada@example.com');
    const changed = await changeUserPassword(handle.db, before?.id ?? '', 'a whole new passphrase');
    expect(changed.ok).toBe(true);
    const after = await findUserById(handle.db, before?.id ?? '');
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    await expect(
      authenticateUser(handle.db, { email: 'ada@example.com', password: PASSWORD }),
    ).resolves.toEqual({ ok: false, error: 'invalid_credentials' });
    await expect(
      authenticateUser(handle.db, { email: 'ada@example.com', password: 'a whole new passphrase' }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses a short password and leaves the stored hash alone', async () => {
    const before = await findUserByEmail(handle.db, 'ada@example.com');
    const result = await changeUserPassword(handle.db, before?.id ?? '', 'short');
    expect(result.ok).toBe(false);
    expect((await findUserById(handle.db, before?.id ?? ''))?.passwordHash).toBe(
      before?.passwordHash,
    );
  });
});

describe('registerApp with an owner', () => {
  it('writes the owner, and still writes null for the CLI path', async () => {
    const owner = await findUserByEmail(handle.db, 'ada@example.com');
    const owned = await registerApp(handle.db, { name: 'Owned', ownerUserId: owner?.id ?? null });
    const operator = await registerApp(handle.db, { name: 'Operator' });
    expect(owned.app.ownerUserId).toBe(owner?.id);
    expect(operator.app.ownerUserId).toBeNull();

    const [stored] = await handle.db.select().from(apps).where(eq(apps.id, owned.app.id));
    expect(stored?.ownerUserId).toBe(owner?.id);
  });
});
