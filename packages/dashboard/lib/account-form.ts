/**
 * The sign-up and sign-in forms: what comes out of them, and the words shown when something is
 * wrong. Dependency-free on purpose - the pages that render these strings are server components
 * and would otherwise pull argon2 and Drizzle into a form with two inputs.
 *
 * The RULES (what a valid address looks like, how long a password must be) live in the gateway,
 * in accounts/credentials.ts, and are not duplicated here. lib/account-form.test.ts pins the
 * sentence below against the gateway's INVALID_CREDENTIALS_MESSAGE so the two cannot drift.
 */

/** The part of FormData these helpers use. Tests pass a real FormData or a one-method stub. */
export interface CredentialFields {
  get(name: string): unknown;
}

export interface Credentials {
  /** As typed, trimmed. Normalisation to the stored form is the gateway's normalizeEmail(). */
  email: string;
  /** Never trimmed: leading and trailing spaces are part of a passphrase. */
  password: string;
}

export const readCredentials = (form: CredentialFields): Credentials => {
  const email = form.get('email');
  const password = form.get('password');
  return {
    email: typeof email === 'string' ? email.trim() : '',
    password: typeof password === 'string' ? password : '',
  };
};

/**
 * ONE SENTENCE FOR BOTH FAILURES. An unknown address and a wrong password produce the same
 * `error=invalid`, and therefore the same words, so the form cannot be used to find out which
 * addresses have accounts on this deployment. Everything else on this page can be specific.
 */
export const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  invalid: 'That email and password do not match an account.',
  missing: 'Enter your email and password.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  forbidden: 'That sign-in did not come from this site. Reload the page and try again.',
  unconfigured: 'This dashboard has no DATABASE_URL or ADMIN_PASSWORD set. See .env.example.',
  unavailable: 'The dashboard could not reach its database. Try again in a moment.',
};

export const SIGNUP_ERRORS: Readonly<Record<string, string>> = {
  invalid_email: 'Enter an email address like you@example.com.',
  weak_password: 'Use a password of at least 12 characters.',
  email_taken: 'That email already has an account. Sign in instead.',
  missing: 'Enter an email address and a password.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  forbidden: 'That sign-up did not come from this site. Reload the page and try again.',
  unconfigured: 'This dashboard has no DATABASE_URL or ADMIN_PASSWORD set. See .env.example.',
  unavailable: 'The dashboard could not create the account. Try again in a moment.',
};

export const ADMIN_LOGIN_ERRORS: Readonly<Record<string, string>> = {
  invalid: 'That password is not right.',
  missing: 'Enter the admin password.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  forbidden: 'That sign-in did not come from this site. Reload the page and try again.',
  unconfigured: 'The dashboard has no ADMIN_PASSWORD set. See .env.example.',
};

/** The message for an `?error=` code, or undefined when there is nothing to say. */
export const errorMessage = (
  errors: Readonly<Record<string, string>>,
  code: string | string[] | undefined,
): string | undefined => {
  const key = Array.isArray(code) ? code[0] : code;
  return key === undefined ? undefined : errors[key];
};

/** The single query-string value of a parameter, or ''. */
export const oneParam = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';
