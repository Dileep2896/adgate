import type { NextRequest } from 'next/server';

import { clientKey, loginRateLimiter } from './rate-limit';

/**
 * The two checks every credential endpoint runs before it looks at a password: is this request
 * even from this site, and has this client had too many goes already.
 *
 * ORIGIN. `/api/login`, `/api/signup` and `/api/admin/login` are state-changing POSTs that a
 * page anywhere on the internet could submit a hidden form to. SameSite=Lax does not stop that:
 * none of them needs an existing cookie to do its damage, and a cross-site login POST would sign
 * the visitor into an account the attacker controls (login CSRF), after which everything they
 * then create belongs to the attacker. `isSameOriginRequest` is the same check `/api/logout`
 * has always made (lib/http.ts).
 *
 * RATE LIMIT. One in-memory fixed window per client address (lib/rate-limit.ts), shared by all
 * three endpoints, so signing up cannot be used to buy a fresh login budget. It is friction, not
 * a boundary: the password check is the boundary.
 */

export const clientAddressOf = (request: NextRequest, trustedProxyHops: number): string =>
  clientKey(
    {
      forwardedFor: request.headers.get('x-forwarded-for'),
      realIp: request.headers.get('x-real-ip'),
    },
    trustedProxyHops,
  );

export interface AttemptAllowance {
  allowed: boolean;
  retryAfterS: number;
}

/** Charges one attempt against this client's window. */
export const chargeAttempt = (
  request: NextRequest,
  trustedProxyHops: number,
  now: Date = new Date(),
): AttemptAllowance => {
  const decision = loginRateLimiter().check(clientAddressOf(request, trustedProxyHops), now);
  return { allowed: decision.allowed, retryAfterS: decision.retryAfterS };
};
