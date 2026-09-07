import { MIN_PASSWORD_LENGTH } from '@adgate/gateway/admin';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthCard } from '@/components/auth-card';
import { errorMessage, oneParam, SIGNUP_ERRORS } from '@/lib/account-form';
import { currentSession, isConfigured } from '@/lib/auth';
import { DEFAULT_LANDING_PATH } from '@/lib/redirect';

/**
 * Create an account. Two fields, no email verification, and the next screen is the one that
 * makes the console worth having: create your first app, take its id and its key, copy a snippet.
 *
 * NO EMAIL VERIFICATION, SAID OUT LOUD. Verifying an address needs an email provider, which is a
 * separate decision with its own cost and its own failure modes; shipping a half-working one
 * would be worse than being honest. The line under the password field says so, and progress.txt
 * records it under Ideas.
 *
 * The password rule is the gateway's MIN_PASSWORD_LENGTH, imported rather than retyped, so the
 * hint and the check can never disagree.
 */

export const dynamic = 'force-dynamic';

const SignupPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = await searchParams;
  const configured = isConfigured();
  if (configured && (await currentSession()) !== null) {
    redirect(DEFAULT_LANDING_PATH);
  }
  const error = configured
    ? errorMessage(SIGNUP_ERRORS, params['error'])
    : SIGNUP_ERRORS['unconfigured'];
  // Handed back so a refusal does not make anyone retype their address. The password never is.
  const email = oneParam(params['email']);

  return (
    <AuthCard
      title="Create an account"
      lede="An adgate account owns apps. Each app has its own policy, its own API key and its own hash chain of audit records."
      error={error}
      errorTestId="signup-error"
      aside={
        <>
          Already have one?{' '}
          <Link href="/login" className="ag-link">
            Sign in
          </Link>
          .
        </>
      }
    >
      <form action="/api/signup" method="post" className="card space-y-4">
        <div>
          <label htmlFor="email" className="ag-label-plain">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={email}
            autoFocus
            required
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby="email-hint"
            className="ag-input mt-1"
          />
          <p id="email-hint" className="ag-hint">
            Not verified: this deployment sends no email. It identifies your account and nothing
            else.
          </p>
        </div>
        <div>
          <label htmlFor="password" className="ag-label-plain">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            aria-describedby="password-hint"
            className="ag-input mt-1"
          />
          <p id="password-hint" className="ag-hint">
            At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule; a passphrase of
            ordinary words beats a short one with punctuation in it.
          </p>
        </div>
        <button type="submit" data-testid="sign-up" className="ag-btn ag-btn-primary w-full">
          Create account
        </button>
      </form>
    </AuthCard>
  );
};

export default SignupPage;
