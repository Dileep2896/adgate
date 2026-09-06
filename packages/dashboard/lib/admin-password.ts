/**
 * The rules ADMIN_PASSWORD has to pass in production, and nothing else.
 *
 * EDGE SAFE ON PURPOSE, like lib/client-address.ts: instrumentation.ts imports this, and
 * because middleware.ts exists Next compiles instrumentation for the Edge runtime TOO - so a
 * transitive `node:fs` anywhere in this import graph fails `next build` outright. That is why
 * these three exports do not live in lib/env.ts, which reads the repo-root .env from disk.
 * lib/env.ts re-exports them, so the server side still has one import path.
 *
 * Nothing here does IO, reads process.env by name, or throws.
 */

/**
 * The shortest ADMIN_PASSWORD a production dashboard will start with. One shared password is
 * the ONLY thing between the internet and an admin surface that issues API keys, and the login
 * rate limiter is per process and in memory (lib/rate-limit.ts), so it is friction rather than
 * a boundary. 16 characters is the point where online guessing stops being the attack.
 */
export const MIN_PRODUCTION_ADMIN_PASSWORD = 16;

/** The value .env.example ships. A deployment still wearing it never chose a password. */
export const PLACEHOLDER_ADMIN_PASSWORD = 'change-me';

/**
 * The production-only password rules, as messages. Empty means acceptable.
 *
 * A BLANK PASSWORD IS NOT THIS FUNCTION'S BUSINESS: `next build` runs with NODE_ENV=production
 * and no ADMIN_PASSWORD and must keep building, and loadDashboardEnv() already refuses an unset
 * one on the first request with the message that names the variable.
 *
 * Never quotes the password or its length: these messages go to a log and to stderr.
 */
export const adminPasswordIssues = (password: string, nodeEnv: string): string[] => {
  if (nodeEnv !== 'production' || password.trim() === '') {
    return [];
  }
  if (password === PLACEHOLDER_ADMIN_PASSWORD) {
    return [
      `ADMIN_PASSWORD is still the .env.example placeholder ("${PLACEHOLDER_ADMIN_PASSWORD}"). Set a long random password: openssl rand -base64 24`,
    ];
  }
  if (password.length < MIN_PRODUCTION_ADMIN_PASSWORD) {
    return [
      `ADMIN_PASSWORD must be at least ${String(MIN_PRODUCTION_ADMIN_PASSWORD)} characters in production. Generate one: openssl rand -base64 24`,
    ];
  }
  return [];
};

/**
 * The same rules over an environment, for the boot check in instrumentation.ts. Returns the
 * problems rather than throwing, so the caller decides whether to print and exit.
 */
export const bootAdminPasswordIssues = (
  env: Readonly<Record<string, string | undefined>>,
): string[] => adminPasswordIssues(env['ADMIN_PASSWORD'] ?? '', env['NODE_ENV'] ?? 'development');
