import { bootAdminPasswordIssues } from './lib/admin-password';

/**
 * Next calls register() once when a server instance starts. The dashboard uses it for exactly
 * one thing: refusing to come up in production behind a weak or placeholder ADMIN_PASSWORD, so
 * the mistake is a failed deploy with a readable message rather than an admin surface on the
 * internet with `change-me` in front of it (SECURITY.md, docs/deploy.md).
 *
 * Because middleware.ts exists, Next compiles this file for the EDGE runtime as well as the
 * Node one - a `node:fs` anywhere in its import graph fails the build, which is why the rules
 * live in lib/admin-password.ts and not in lib/env.ts. The check itself only runs in the Node
 * runtime, where the password is.
 *
 * It reads the real environment only. A local `next start` that gets its values from the
 * repo-root .env has NODE_ENV=development anyway, and loadDashboardEnv() applies the same rules
 * on the first request either way.
 */
export const register = (): void => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const issues = bootAdminPasswordIssues(process.env);
  if (issues.length === 0) {
    return;
  }
  console.error(
    ['adgate dashboard refusing to start:', ...issues.map((issue) => `  - ${issue}`)].join('\n'),
  );
  process.exit(1);
};
