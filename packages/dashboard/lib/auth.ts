import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { dashboardEnv } from './env';
import { SESSION_COOKIE_NAME, type SessionFailure, verifySessionToken } from './session';

/**
 * The server side of the session. middleware.ts only checks that a session cookie is PRESENT
 * (it runs in the Edge runtime, where the signing secret is not available), so this is the
 * check that actually decides: every protected route runs through requireSession() in a
 * server component, in the Node runtime, with the real secret. A forged or expired cookie
 * gets past middleware and is rejected here.
 */

export interface Session {
  expiresAt: Date;
}

export const currentSession = async (now: Date = new Date()): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const result = await verifySessionToken(token, dashboardEnv().sessionSecret, now);
  return result.valid ? { expiresAt: result.expiresAt } : null;
};

/** Why the current request has no session; 'missing' when there was no cookie at all. */
export const sessionFailure = async (now: Date = new Date()): Promise<SessionFailure | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const result = await verifySessionToken(token, dashboardEnv().sessionSecret, now);
  return result.valid ? null : result.reason;
};

/**
 * Redirects to the login form unless the request carries a valid session. `redirect()` throws
 * a Next control-flow error, so nothing after this call runs for an anonymous visitor.
 */
export const requireSession = async (from?: string): Promise<Session> => {
  const session = await currentSession();
  if (session === null) {
    redirect(from === undefined ? '/login' : `/login?from=${encodeURIComponent(from)}`);
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
