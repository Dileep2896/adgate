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

/**
 * Whether a state-changing request came from this dashboard itself.
 *
 * The session cookie is SameSite=Lax, which stops a cross-site POST from carrying it - except
 * for the one operation that does not need it: signing out. A bare POST from any page on the
 * internet would otherwise end the operator's session, so /api/logout asks this first.
 *
 * `sec-fetch-site` is the browser's own answer and is believed when it is there (every current
 * browser sends it, and it cannot be set by page script). Otherwise the `origin` header is
 * compared with the Host the browser actually used - the classic check - and an opaque origin
 * (`null`, from a sandboxed frame) is refused. A request with NEITHER header is not a browser
 * form post at all (curl, a script with the operator's own cookie) and is allowed: there is no
 * third party to trick.
 */
export const isSameOriginRequest = (headers: Headers): boolean => {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== '') {
    return site === 'same-origin' || site === 'none';
  }
  const origin = headers.get('origin');
  if (origin === null || origin === '') {
    return true;
  }
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? '';
  try {
    return host !== '' && new URL(origin).host === host;
  } catch {
    return false;
  }
};
