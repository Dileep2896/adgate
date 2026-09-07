import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, sqlList, timestamptz } from './columns.js';

/**
 * Dashboard accounts. This is the ONE place a human identity is stored in adgate: the gateway's
 * own API surface authenticates with API keys (api_keys) and knows nothing about users, so
 * nothing on the request path reads this table.
 *
 * A `member` is a third-party developer who signed up: they see their own apps and nothing else.
 * An `admin` is the operator: they see everything. `ADMIN_PASSWORD` remains a bootstrap admin
 * login that needs no row here at all, so an operator can never be locked out of their own
 * deployment by an empty or broken users table (SECURITY.md calls it the break-glass path).
 *
 * EMAIL IS STORED LOWERCASED, and the unique index is on the stored value. Postgres `citext`
 * would be the other way to spell it, but it is an extension, and a managed Postgres that has
 * not enabled it would fail this migration; normalising in one function (accounts/users.ts
 * normalizeEmail) costs nothing and works everywhere.
 *
 * `password_hash` is an argon2id PHC string, produced by the SAME helper that hashes API key
 * secrets (auth/keys.ts). There is no second password implementation in this repository.
 */

export const USER_ROLES = ['member', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable(
  'users',
  {
    /** usr_ ULID, minted by the application. */
    id: text('id').primaryKey(),
    /** Lowercased at write time; unique, so one address is one account. */
    email: text('email').notNull().unique(),
    /** argon2id PHC string. Never selected into anything that leaves the process. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('member'),
    createdAt: createdAt(),
    lastLoginAt: timestamptz('last_login_at'),
  },
  (table) => [check('users_role_check', sql`${table.role} in (${sqlList(USER_ROLES)})`)],
);

/** A row of `users` as SELECT returns it. password_hash must never leave the server. */
export type UserRow = typeof users.$inferSelect;
