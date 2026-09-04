import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from './lib/session';

/**
 * The first gate: anything that is not the login form, the login/logout endpoints or a static
 * asset needs a session cookie, or the visitor is sent to /login with the path they wanted in
 * `?from=`.
 *
 * Middleware runs in the Edge runtime, where the dashboard's signing secret is not available
 * (reading it here would inline it into the middleware bundle at build time), so this checks
 * that a cookie is PRESENT and nothing more. The signature and the expiry are verified in the
 * Node runtime by requireSession() in app/(dashboard)/layout.tsx, which every protected page
 * renders under. A forged cookie therefore gets a redirect from the layout, not access.
 */

export const config = {
  // Everything except Next's own assets and the favicon. The public routes are filtered below,
  // because the matcher is a build-time constant and this list is easier to read.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

const PUBLIC_PATHS = new Set(['/login', '/api/login', '/api/logout']);

export const middleware = (request: NextRequest): NextResponse => {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }
  // Middleware needs an ABSOLUTE location (Next parses it), so the URL is cloned from the
  // incoming one: that keeps the host the browser actually used. Route handlers are different
  // - `request.url` there is normalised to localhost - which is why they use
  // sameOriginRedirect() from lib/http.ts instead.
  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  login.searchParams.set('from', `${pathname}${search}`);
  return NextResponse.redirect(login);
};
