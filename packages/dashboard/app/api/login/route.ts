import { authenticateUser, touchUserLogin } from '@adgateio/gateway/admin';
import type { NextRequest, NextResponse } from 'next/server';

import { readCredentials } from '@/lib/account-form';
import { dashboardWriteDb } from '@/lib/db-write';
import { DashboardConfigError, dashboardEnv } from '@/lib/env';
import { isSameOriginRequest, sameOriginRedirect } from '@/lib/http';
import { chargeAttempt } from '@/lib/login-guard';
import { DEFAULT_LANDING_PATH, safeRedirectPath } from '@/lib/redirect';
import { secretTag } from '@/lib/session';
import { attachSession } from '@/lib/sign-in';

/**
 * The member login: a plain form POST, so the dashboard works with JavaScript disabled.
 *
 * ENUMERATION SAFE. An unknown address and a wrong password produce the same `error=invalid` and
 * the same sentence, and authenticateUser() spends the same argon2 time on both (the gateway's
 * accounts/users.ts burns a decoy verify for an address it does not know), so neither the words
 * nor the clock says whether an account exists.
 *
 * The password is never logged, never put in a URL and never written to the response. Every
 * outcome is a 303 back to /login with an `error` code, so the browser cannot resubmit the
 * password by reloading. Attempts are rate limited in memory per client address, which makes
 * online guessing slow without adding infrastructure (CLAUDE.md: no Redis, no queues).
 *
 * IT WRITES ONE COLUMN: users.last_login_at, through the read-write handle. That is why this
 * file is in lib/db-write-usage.test.ts's allow list.
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

  if (!isSameOriginRequest(request.headers)) {
    return backToLogin('forbidden', from);
  }

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
  const limit = chargeAttempt(request, env.trustedProxyHops);
  if (!limit.allowed) {
    const response = backToLogin('rate_limited', from);
    response.headers.set('retry-after', String(limit.retryAfterS));
    return response;
  }

  const { email, password } = readCredentials(form);
  if (email === '' || password === '') {
    return backToLogin('missing', from);
  }

  const db = dashboardWriteDb(env.databaseUrl);
  let result;
  try {
    result = await authenticateUser(db, { email, password });
  } catch {
    return backToLogin('unavailable', from);
  }
  if (!result.ok) {
    return backToLogin('invalid', from);
  }

  const response = await attachSession(sameOriginRedirect(from, 303), {
    userId: result.user.id,
    role: result.user.role,
    // Binds the cookie to the CURRENT password: changing it invalidates every session at once.
    tag: await secretTag(result.passwordHash),
  });
  // Bookkeeping only; a failure here must not cost the operator their sign-in.
  await touchUserLogin(db, result.user.id).catch(() => undefined);
  return response;
};
