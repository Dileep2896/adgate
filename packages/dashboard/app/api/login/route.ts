import type { NextRequest, NextResponse } from 'next/server';

import { DashboardConfigError, dashboardEnv } from '@/lib/env';
import { sameOriginRedirect } from '@/lib/http';
import { clientKey, loginRateLimiter } from '@/lib/rate-limit';
import { DEFAULT_LANDING_PATH, safeRedirectPath } from '@/lib/redirect';
import {
  DEFAULT_SESSION_TTL_MS,
  issueSessionToken,
  SESSION_COOKIE_NAME,
  verifyAdminPassword,
} from '@/lib/session';

/**
 * The login endpoint: a plain form POST, so the dashboard works with JavaScript disabled.
 *
 * The password is compared in constant time (lib/session.ts) and is never logged, never put
 * in a URL and never written to the response. Attempts are rate limited in memory per client
 * address, which makes online guessing slow without adding infrastructure (CLAUDE.md: no
 * Redis, no queues). Every outcome is a 303 back to /login with an `error` code, so the
 * browser cannot resubmit the password by reloading.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const backToLogin = (error: string, from: string): NextResponse => {
  const params = new URLSearchParams({ error });
  if (from !== DEFAULT_LANDING_PATH) {
    params.set('from', from);
  }
  return sameOriginRedirect(`/login?${params.toString()}`, 303);
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  const form = await request.formData();
  const fromField = form.get('from');
  const from = safeRedirectPath(typeof fromField === 'string' ? fromField : null);

  let env;
  try {
    env = dashboardEnv();
  } catch (error) {
    if (error instanceof DashboardConfigError) {
      return backToLogin('unconfigured', from);
    }
    throw error;
  }

  // The client address is only as trustworthy as the deployment says it is: with TRUST_PROXY
  // unset the forwarded headers are ignored and every attempt shares one bucket, because a
  // client that reaches this process directly can put anything in them (lib/rate-limit.ts).
  const limit = loginRateLimiter().check(
    clientKey(
      {
        forwardedFor: request.headers.get('x-forwarded-for'),
        realIp: request.headers.get('x-real-ip'),
      },
      env.trustedProxyHops,
    ),
    new Date(),
  );
  if (!limit.allowed) {
    const response = backToLogin('rate_limited', from);
    response.headers.set('retry-after', String(limit.retryAfterS));
    return response;
  }

  const password = form.get('password');
  if (typeof password !== 'string' || password === '') {
    return backToLogin('missing', from);
  }
  if (!(await verifyAdminPassword(password, env.adminPassword))) {
    return backToLogin('invalid', from);
  }

  const { token } = await issueSessionToken(env.sessionSecret, new Date());
  const response = sameOriginRedirect(from, 303);
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
