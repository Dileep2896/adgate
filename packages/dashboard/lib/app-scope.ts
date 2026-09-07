/**
 * WHOSE DATA THIS REQUEST MAY SEE. One value, threaded through every read in this package.
 *
 * It is a discriminated union rather than a nullable user id on purpose: `{ role: 'admin' }`
 * carries no user id at all, so there is no way to write a query that "forgot" to filter and
 * still compiles into something a member could run. Every scoped query takes an AppScope as a
 * REQUIRED argument - none of them defaults to the admin scope - so a new call site has to say
 * out loud whose data it is asking for.
 *
 * THE RULE, in one sentence: a member sees the apps whose `owner_user_id` is their user id, and
 * everything that hangs off those apps; an admin sees every app, including the ones with a null
 * owner that the `create-app` CLI wrote.
 *
 * Dependency-free (no drizzle, no database, no React), so a client component may import the type
 * and lib/scope-queries.ts can hold the SQL that implements it.
 */

export type AppScope = { role: 'admin' } | { role: 'member'; userId: string };

/** Sees everything, null-owner apps included. */
export const ADMIN_SCOPE: AppScope = { role: 'admin' };

export const memberScope = (userId: string): AppScope => ({ role: 'member', userId });

export const isAdminScope = (scope: AppScope): boolean => scope.role === 'admin';

/**
 * The owner id a member's rows must carry, or null for an admin (meaning "no owner filter").
 * This is the ONE place the union is flattened; lib/scope-queries.ts turns it into SQL.
 */
export const scopeOwnerId = (scope: AppScope): string | null =>
  scope.role === 'admin' ? null : scope.userId;

/** Whether a row owned by `ownerUserId` (null = operator-created) is inside this scope. */
export const ownsRow = (scope: AppScope, ownerUserId: string | null): boolean =>
  scope.role === 'admin' ? true : ownerUserId === scope.userId;
