import type { NextResponse } from 'next/server';

import { dashboardEnv } from './env';
import {
  DEFAULT_SESSION_TTL_MS,
  issueSessionToken,
  SESSION_COOKIE_NAME,
  type SessionClaims,
} from './session';

/**
 * Minting the session cookie. One place, so the three sign-in endpoints (member login, signup,
 * the break-glass admin form) cannot end up setting three subtly different cookies.
 *
 * The cookie is httpOnly (script can never read it), SameSite=Lax (a cross-site POST does not
 * carry it; the state-changing endpoints check the origin as well, because Lax does not cover an
 * operation that needs no cookie), `secure` outside development, and path-scoped to the whole
 * app because every route needs it.
 */

export const attachSession = async (
  response: NextResponse,
  claims: SessionClaims,
  now: Date = new Date(),
): Promise<NextResponse> => {
  const env = dashboardEnv();
  const { token } = await issueSessionToken(env.sessionSecret, claims, now);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    path: '/',
    maxAge: Math.floor(DEFAULT_SESSION_TTL_MS / 1000),
  });
  return response;
};
