import { NextResponse } from 'next/server';

import { isSameOriginRequest, sameOriginRedirect } from '@/lib/http';
import { SESSION_COOKIE_NAME } from '@/lib/session';

/**
 * Drops the session cookie and returns to the login form.
 *
 * SAME ORIGIN ONLY. Signing out needs no session cookie to work, so SameSite=Lax does not
 * protect it: without this check any page on the internet could post a hidden form here and
 * throw the operator out of the dashboard mid-edit. A cross-site POST is refused and the cookie
 * is left exactly as it was (lib/http.ts explains what is believed and why).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request): NextResponse => {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'cross-site logout refused' } },
      { status: 403 },
    );
  }

  const response = sameOriginRedirect('/login', 303);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
};
