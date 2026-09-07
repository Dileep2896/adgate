import { NextResponse, type NextRequest } from 'next/server';

import { isClientAllowed, parseClientAllowlist, parseTrustedProxyHops } from './lib/client-address';
import { clientKey } from './lib/rate-limit';
import { isAdminOnlyPath, isPublicPath, loginRouteFor } from './lib/routes';
import { SESSION_COOKIE_NAME } from './lib/session';

/**
 * The first gate: a network allowlist over the ADMIN surface, then a session cookie. Anything
 * that is not a public route or a static asset needs a cookie, or the visitor is sent to a login
 * form with the path they wanted in `?from=`.
 *
 * Middleware runs in the Edge runtime, where the dashboard's signing secret is not available
 * (reading it here would inline it into the middleware bundle at build time), so this checks
 * that a cookie is PRESENT and nothing more. The signature, the expiry, the account behind it
 * and its role are verified in the Node runtime by requireSession()/requireAdmin() in lib/auth.ts,
 * which every protected page, server action and route handler calls. A forged cookie therefore
 * gets a redirect from the page, not access.
 *
 * The Edge runtime is also why lib/env.ts is not imported here: it reads node:fs, and importing
 * it - a dynamic import included, because webpack still follows one - fails `next build`.
 * lib/client-address.ts, lib/rate-limit.ts, lib/routes.ts and lib/session.ts exist to be
 * importable from both runtimes and none of them touches a node built-in.
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

/**
 * DASHBOARD_ALLOWED_IPS: null unless it is set, and then nothing outside it reaches the OPERATOR
 * surface - `/admin/**`, the break-glass login included (lib/routes.ts).
 *
 * IT NO LONGER COVERS THE WHOLE DASHBOARD, and that is the deliberate consequence of self-serve
 * signup: a third-party developer has to be able to reach `/signup`, `/login` and their own apps
 * from wherever they are. SECURITY.md and docs/deploy.md say what an operator should still put in
 * front of the member surface (TLS, a WAF or platform rate limiting, and the fact that the member
 * routes are a normal internet-facing app).
 *
 * It is a second lock, never a replacement for the password: source addresses are only as honest
 * as the proxy in front of them, which is exactly what TRUST_PROXY describes.
 */
const ALLOWLIST = parseClientAllowlist(process.env.DASHBOARD_ALLOWED_IPS);
const TRUSTED_HOPS = parseTrustedProxyHops(process.env.TRUST_PROXY, process.env.TRUSTED_PROXY_HOPS);

/**
 * WITH TRUST_PROXY UNSET THIS IS 'unknown' BEHIND ANY PROXY, and 'unknown' is on no allowlist,
 * so every admin request is refused. That is the safe half of the mistake and it is deliberate: an
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
  const { pathname, search } = request.nextUrl;
  if (
    ALLOWLIST !== null &&
    isAdminOnlyPath(pathname) &&
    !isClientAllowed(addressOf(request), ALLOWLIST)
  ) {
    return forbidden();
  }
  if (isPublicPath(pathname)) {
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
  login.pathname = loginRouteFor(pathname);
  login.search = '';
  login.searchParams.set('from', `${pathname}${search}`);
  return NextResponse.redirect(login);
};
