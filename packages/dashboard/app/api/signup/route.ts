import { registerUser } from '@adgate/gateway/admin';
import type { NextRequest, NextResponse } from 'next/server';

import { readCredentials } from '@/lib/account-form';
import { dashboardWriteDb } from '@/lib/db-write';
import { DashboardConfigError, dashboardEnv } from '@/lib/env';
import { isSameOriginRequest, sameOriginRedirect } from '@/lib/http';
import { chargeAttempt } from '@/lib/login-guard';
import { FIRST_APP_PATH } from '@/lib/routes';
import { secretTag } from '@/lib/session';
import { attachSession } from '@/lib/sign-in';

/**
 * Self-serve signup: create an account, sign in, and land on "create your first app".
 *
 * A plain form POST like the login, for the same reason - it works with JavaScript disabled and
 * the password never becomes part of a URL. Every refusal is a 303 back to /signup with an
 * `error` code and the address the visitor typed (never the password), so nothing is retyped.
 *
 * THERE IS NO EMAIL VERIFICATION HERE, deliberately: it needs an email provider, which is a
 * separate decision with its own operational cost, and adding a half-working one would be worse
 * than saying so. The signup page says it in words, and an operator who needs verified addresses
 * should put an SSO proxy in front of the console (SECURITY.md).
 *
 * The account rules - a valid address, at least 12 characters, one account per address - are the
 * gateway's registerUser (accounts/credentials.ts, accounts/users.ts), so a form and a script
 * cannot disagree about them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const backToSignup = (error: string, email: string): NextResponse => {
  const params = new URLSearchParams({ error });
  if (email !== '') {
    params.set('email', email);
  }
  return sameOriginRedirect(`/signup?${params.toString()}`, 303);
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  const form = await request.formData();
  const { email, password } = readCredentials(form);

  if (!isSameOriginRequest(request.headers)) {
    return backToSignup('forbidden', email);
  }

  let env;
  try {
    env = dashboardEnv();
  } catch (error) {
    if (error instanceof DashboardConfigError) {
      return backToSignup('unconfigured', email);
    }
    throw error;
  }

  // Signup shares the login limiter's window on purpose: otherwise creating accounts would be a
  // way to buy a fresh budget of password guesses from the same address.
  const limit = chargeAttempt(request, env.trustedProxyHops);
  if (!limit.allowed) {
    const response = backToSignup('rate_limited', email);
    response.headers.set('retry-after', String(limit.retryAfterS));
    return response;
  }

  if (email === '' || password === '') {
    return backToSignup('missing', email);
  }

  let result;
  try {
    result = await registerUser(dashboardWriteDb(env.databaseUrl), { email, password });
  } catch {
    return backToSignup('unavailable', email);
  }
  if (!result.ok) {
    return backToSignup(result.error, email);
  }

  // Signed in immediately: an account with no way in is not an account, and the next screen is
  // the one that makes the console useful (create an app, take its key).
  return attachSession(sameOriginRedirect(FIRST_APP_PATH, 303), {
    userId: result.user.id,
    role: result.user.role,
    tag: await secretTag(result.passwordHash),
  });
};
