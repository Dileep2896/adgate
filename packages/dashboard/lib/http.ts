import { NextResponse } from 'next/server';

/**
 * Redirects that stay on the origin the browser is actually using.
 *
 * NextResponse.redirect() needs an absolute URL, and the only base available inside a route
 * handler or middleware is `request.url`, which Next normalises to `localhost` no matter what
 * Host the client sent. Redirecting there moves the browser to a DIFFERENT origin, which
 * silently drops the session cookie that was just set for the original host. A relative
 * `location` (RFC 7231 allows it) is resolved by the browser against the request URL, so the
 * origin never changes.
 *
 * `location` must be a path validated by safeRedirectPath().
 */
export const sameOriginRedirect = (location: string, status: 303 | 307 = 307): NextResponse =>
  new NextResponse(null, { status, headers: { location } });
