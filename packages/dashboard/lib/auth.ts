import { findUserById } from '@adgate/gateway/admin';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { type AppScope, ADMIN_SCOPE, memberScope } from './app-scope';
import { type DashboardDb, dashboardDb } from './db';
import { dashboardEnv } from './env';
import {
  OPERATOR_USER_ID,
  SESSION_COOKIE_NAME,
  type SessionClaims,
  type SessionFailure,
  type SessionRole,
  secretTag,
  verifySessionToken,
} from './session';

/**
 * The server side of the session, and the ONLY thing in this package that decides who somebody
 * is. middleware.ts checks that a cookie is present (it runs in the Edge runtime, where the
 * signing secret is not available); this runs in the Node runtime with the real secret AND the
 * database, so it can do the two things a signed cookie cannot do on its own:
 *
 *   1. Confirm the account still exists and still has the role the cookie claims. A member
 *      promoted or demoted since they signed in gets their current role, not the stored one.
 *   2. Confirm the cookie was minted against the CURRENT password. The token carries
 *      secretTag(the stored argon2id hash); a password change produces a new hash, the tags stop
 *      matching, and every outstanding session for that account is dead on its next request.
 *      For the ADMIN_PASSWORD operator the tag is over the configured password, so rotating it
 *      signs the operator out too - even when DASHBOARD_SESSION_SECRET is set independently.
 *
 * That costs one indexed SELECT per request for a member. The dashboard is one operator and a
 * handful of developers, not traffic, and the alternative is a cookie nobody can revoke.
 */

export interface Session {
  /** `usr_…` for an account, `operator` for the ADMIN_PASSWORD login. */
  userId: string;
  role: SessionRole;
  /** The account's address, or null for the ADMIN_PASSWORD operator (there is no row). */
  email: string | null;
  /** What this request may read. Pass it to every scoped query (lib/app-scope.ts). */
  scope: AppScope;
  expiresAt: Date;
}

export const isAdminSession = (session: Session): boolean => session.role === 'admin';

/**
 * The account id to stamp on a row this session creates - an app, a report - or null for the
 * break-glass operator, who has no row in `users`. A null owner is the CLI's shape too, which is
 * why the operator's own creations look exactly like `create-app`'s: admin-visible, member-invisible.
 */
export const sessionOwnerId = (session: Session): string | null =>
  session.userId === OPERATOR_USER_ID ? null : session.userId;

const scopeFor = (role: SessionRole, userId: string): AppScope =>
  role === 'admin' ? ADMIN_SCOPE : memberScope(userId);

/**
 * Turns authentic claims into a Session, or null when the account behind them no longer backs
 * the cookie. Split out so lib/session-check.test.ts can drive it with a fake lookup.
 */
export const resolveClaims = async (
  claims: SessionClaims,
  expiresAt: Date,
  lookup: {
    operatorTag: () => Promise<string>;
    findUser: (id: string) => Promise<{ email: string; role: SessionRole; tag: string } | null>;
  },
): Promise<Session | null> => {
  if (claims.userId === OPERATOR_USER_ID) {
    // The break-glass login. It has no row, so the only thing to re-check is the password it
    // was minted against; a cookie claiming `operator` with the member role is a forgery shape
    // and is refused rather than downgraded.
    if (claims.role !== 'admin' || claims.tag !== (await lookup.operatorTag())) {
      return null;
    }
    return {
      userId: OPERATOR_USER_ID,
      role: 'admin',
      email: null,
      scope: ADMIN_SCOPE,
      expiresAt,
    };
  }
  const user = await lookup.findUser(claims.userId);
  if (user === null || user.tag !== claims.tag) {
    return null;
  }
  // The stored role wins over the claimed one: a demotion must take effect at once.
  return {
    userId: claims.userId,
    role: user.role,
    email: user.email,
    scope: scopeFor(user.role, claims.userId),
    expiresAt,
  };
};

const lookupFor = (db: DashboardDb) => ({
  operatorTag: (): Promise<string> => secretTag(dashboardEnv().adminPassword),
  findUser: async (id: string) => {
    const row = await findUserById(db, id);
    return row === null
      ? null
      : { email: row.email, role: row.role, tag: await secretTag(row.passwordHash) };
  },
});

const readToken = async (): Promise<string | undefined> =>
  (await cookies()).get(SESSION_COOKIE_NAME)?.value;

export const currentSession = async (
  now: Date = new Date(),
  db: DashboardDb = dashboardDb(),
): Promise<Session | null> => {
  const result = await verifySessionToken(await readToken(), dashboardEnv().sessionSecret, now);
  if (!result.valid) {
    return null;
  }
  return resolveClaims(result.claims, result.expiresAt, lookupFor(db));
};

/**
 * Why the current request has no session; 'missing' when there was no cookie at all. An
 * authentic token whose account is gone or whose password changed reports 'bad_signature': from
 * the visitor's side it is the same fact - this cookie does not authenticate you any more.
 */
export const sessionFailure = async (now: Date = new Date()): Promise<SessionFailure | null> => {
  const result = await verifySessionToken(await readToken(), dashboardEnv().sessionSecret, now);
  if (!result.valid) {
    return result.reason;
  }
  return (await currentSession(now)) === null ? 'bad_signature' : null;
};

const loginPath = (base: string, from?: string): string =>
  from === undefined ? base : `${base}?from=${encodeURIComponent(from)}`;

/** Where an unauthenticated visitor to `path` is sent. Admin-only paths keep to the admin form. */
export const LOGIN_PATH = '/login';
export const ADMIN_LOGIN_PATH = '/admin/login';

/**
 * Redirects to the login form unless the request carries a valid session. `redirect()` throws
 * a Next control-flow error, so nothing after this call runs for an anonymous visitor.
 */
export const requireSession = async (from?: string): Promise<Session> => {
  const session = await currentSession();
  if (session === null) {
    redirect(loginPath(LOGIN_PATH, from));
  }
  return session;
};

/**
 * The operator gate. A member who reaches an admin-only route is sent to their own landing page
 * rather than to a login form: they ARE signed in, they simply have no business here, and
 * bouncing them to /login would look like their session had broken.
 */
export const requireAdmin = async (from?: string): Promise<Session> => {
  const session = await currentSession();
  if (session === null) {
    redirect(loginPath(ADMIN_LOGIN_PATH, from));
  }
  if (session.role !== 'admin') {
    redirect('/apps');
  }
  return session;
};

/**
 * Whether ADMIN_PASSWORD and DATABASE_URL are set. The login page asks so it can say what is
 * wrong instead of rendering a configuration stack trace at an anonymous visitor.
 */
export const isConfigured = (): boolean => {
  try {
    dashboardEnv();
    return true;
  } catch {
    return false;
  }
};
