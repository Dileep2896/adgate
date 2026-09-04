import type { NextResponse } from 'next/server';

import { sameOriginRedirect } from '@/lib/http';
import { SESSION_COOKIE_NAME } from '@/lib/session';

/** Drops the session cookie and returns to the login form. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (): NextResponse => {
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
