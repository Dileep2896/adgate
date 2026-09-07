import type { NextRequest, NextResponse } from 'next/server';

import { DashboardConfigError, dashboardEnv } from '@/lib/env';
import { isSameOriginRequest, sameOriginRedirect } from '@/lib/http';
import { chargeAttempt } from '@/lib/login-guard';
import { DEFAULT_LANDING_PATH, safeRedirectPath } from '@/lib/redirect';
import { OPERATOR_USER_ID, secretTag, verifyAdminPassword } from '@/lib/session';
import { attachSession } from '@/lib/sign-in';

/**
 * THE BREAK-GLASS OPERATOR LOGIN. `ADMIN_PASSWORD` still works, and it is the only sign-in that
 * needs no row in `users`: an operator whose accounts table is empty, whose own account was
 * deleted, or whose deployment has just been restored from a backup can still get in and see
 * everything. SECURITY.md says so in those words.
 *
 * It sits at `/api/admin/login`, under the admin path prefix, which is what lets
 * `DASHBOARD_ALLOWED_IPS` guard it (and `/admin/**`) while leaving signup and the member login
 * reachable from anywhere - see middleware.ts and lib/routes.ts.
 *
 * The session it mints claims the `operator` user id and the admin role, and is bound to a
 * digest of ADMIN_PASSWORD itself, so rotating the password signs the operator out even when
 * DASHBOARD_SESSION_SECRET is set independently of it (lib/auth.ts re-checks the tag).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const backToLogin = (error: string, from: string): NextResponse => {
  const params = new URLSearchParams({ error });
  if (from !== DEFAULT_LANDING_PATH) {
    params.set('from', from);
  }
  return sameOriginRedirect(`/admin/login?${params.toString()}`, 303);
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

  const limit = chargeAttempt(request, env.trustedProxyHops);
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

  return attachSession(sameOriginRedirect(from, 303), {
    userId: OPERATOR_USER_ID,
    role: 'admin',
    tag: await secretTag(env.adminPassword),
  });
};
