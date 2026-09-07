import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth-card';
import { errorMessage, LOGIN_ERRORS, oneParam } from '@/lib/account-form';
import { currentSession, isConfigured } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/redirect';

/**
 * Sign in to the developer console. It posts to /api/login, which checks the origin, rate limits
 * the attempt, verifies the password with argon2 and mints the signed session cookie. No
 * JavaScript is required.
 *
 * ONE SENTENCE FOR BOTH FAILURES. An address with no account and a wrong password produce the
 * same words (lib/account-form.ts), so this form cannot be used to find out who has an account
 * here.
 *
 * `from` is where middleware.ts wanted to send the visitor; safeRedirectPath() makes sure it can
 * only ever be a path on this site.
 */

export const dynamic = 'force-dynamic';

const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  const from = safeRedirectPath(oneParam(params['from']) || null);
  // An unconfigured dashboard has no session secret to check against; show the form and let
  // the error line say so rather than rendering a stack trace.
  const configured = isConfigured();
  if (configured && (await currentSession()) !== null) {
    redirect(from);
  }
  const error = configured
    ? errorMessage(LOGIN_ERRORS, params['error'])
    : LOGIN_ERRORS['unconfigured'];

  return (
    <AuthCard
      title="Sign in"
      lede="Your apps, their creatives, the signed audit chain and verification reports."
      error={error}
      aside={
        <>
          No account yet?{' '}
          <Link href="/signup" className="ag-link">
            Create one
          </Link>
          .
        </>
      }
    >
      <form action="/api/login" method="post" className="card space-y-4">
        <input type="hidden" name="from" value={from} />
        <div>
          <label htmlFor="email" className="ag-label-plain">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : 'auth-error'}
            className="ag-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="password" className="ag-label-plain">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : 'auth-error'}
            className="ag-input mt-1"
          />
        </div>
        <button type="submit" data-testid="sign-in" className="ag-btn ag-btn-primary w-full">
          Sign in
        </button>
        <p className="ag-hint">
          Running this gateway yourself?{' '}
          <Link href="/admin/login" className="ag-link-quiet">
            Operator sign-in
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
};

export default LoginPage;
