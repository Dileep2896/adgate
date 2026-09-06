import { NextResponse, type NextRequest } from 'next/server';

import { isClientAllowed, parseClientAllowlist, parseTrustedProxyHops } from './lib/client-address';
import { clientKey } from './lib/rate-limit';
import { SESSION_COOKIE_NAME } from './lib/session';

/**
 * The first gate: an optional network allowlist, then a session cookie. Anything that is not
 * the login form, the login/logout endpoints or a static asset needs a cookie, or the visitor
 * is sent to /login with the path they wanted in `?from=`.
 *
 * Middleware runs in the Edge runtime, where the dashboard's signing secret is not available
 * (reading it here would inline it into the middleware bundle at build time), so this checks
 * that a cookie is PRESENT and nothing more. The signature and the expiry are verified in the
 * Node runtime by requireSession() in app/(dashboard)/layout.tsx, which every protected page
 * renders under. A forged cookie therefore gets a redirect from the layout, not access.
 *
 * The Edge runtime is also why lib/env.ts is not imported here: it reads node:fs, and importing
 * it - a dynamic import included, because webpack still follows one - fails `next build`.
 * lib/client-address.ts and lib/rate-limit.ts exist to be importable from both runtimes.
 *
 * The two variables below are read in DOT notation, the form Next's Edge compilation documents
 * support for; a computed `process.env[name]` lookup is not guaranteed to survive it. They are
 * read ONCE, when this module is first evaluated - when the server or the Edge function
 * instance starts, not per request - so changing either one takes a restart when self-hosted
 * and a redeploy on Vercel.
 */

export const config = {
  // Everything except Next's own assets and the favicon. The public routes are filtered below,
  // because the matcher is a build-time constant and this list is easier to read.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

const PUBLIC_PATHS = new Set(['/login', '/api/login', '/api/logout']);

/**
 * DASHBOARD_ALLOWED_IPS: null unless it is set, and then NOTHING outside it reaches a route -
 * /login included. SECURITY.md says the dashboard belongs behind a VPN, an SSO proxy or an IP
 * allowlist; this is the allowlist, for a host (Vercel) where the first two are not on offer.
 *
 * It is a second lock, never a replacement for the password: source addresses are only as
 * honest as the proxy in front of them, which is exactly what TRUST_PROXY describes.
 */
const ALLOWLIST = parseClientAllowlist(process.env.DASHBOARD_ALLOWED_IPS);
const TRUSTED_HOPS = parseTrustedProxyHops(process.env.TRUST_PROXY, process.env.TRUSTED_PROXY_HOPS);

/**
 * WITH TRUST_PROXY UNSET THIS IS 'unknown' BEHIND ANY PROXY, and 'unknown' is on no allowlist,
 * so every request is refused. That is the safe half of the mistake and it is deliberate: an
 * allowlist keyed on a header the client itself could have written would be decoration. A
 * deployment on Vercel (or behind any proxy) that wants the allowlist must set TRUST_PROXY=true,
 * which is documented in docs/deploy.md and in .env.example.
 */
const addressOf = (request: NextRequest): string =>
  clientKey(
    {
      forwardedFor: request.headers.get('x-forwarded-for'),
      realIp: request.headers.get('x-real-ip'),
    },
    TRUSTED_HOPS,
  );

/** A bare 403. No hint about what the allowlist contains, and never cached. */
const forbidden = (): NextResponse =>
  new NextResponse('Forbidden', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

export const middleware = (request: NextRequest): NextResponse => {
  if (ALLOWLIST !== null && !isClientAllowed(addressOf(request), ALLOWLIST)) {
    return forbidden();
  }
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
