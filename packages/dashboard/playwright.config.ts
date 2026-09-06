import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { derivePublicPem } from '@adgate/core';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs the dashboard end to end against the Postgres TEST database, so a smoke run
 * never touches development data. It is deliberately NOT part of `pnpm test`: it needs a
 * browser binary (`pnpm exec playwright install chromium`) and a running Postgres.
 *
 *   docker compose up -d postgres
 *   pnpm --filter @adgate/dashboard test:e2e
 *
 * The server under test is a real production build (`next build && next start`), which is the
 * only way the middleware redirect and the cookie flags behave as they will in deployment.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// The e2e run reads DATABASE_URL_TEST, ADMIN_PASSWORD and (optionally)
// DASHBOARD_SESSION_SECRET from the repo-root .env, exactly like the gateway's tests.
if (existsSync(join(repoRoot, '.env'))) {
  process.loadEnvFile(join(repoRoot, '.env'));
}

const port = Number(process.env['DASHBOARD_E2E_PORT'] ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;
const databaseUrl = process.env['DATABASE_URL_TEST'] ?? '';

/**
 * THE E2E RUN MINTS ITS OWN ADMIN PASSWORD. The server under test runs with NODE_ENV=production,
 * and a production dashboard refuses to start on a password under 16 characters or on the
 * `change-me` the repo's .env ships for local dev (lib/env.ts, SECURITY.md). Taking the repo's
 * value would therefore make the smoke run depend on whatever a developer happens to have in
 * .env; this one is fixed, long, and only ever reaches a server bound to 127.0.0.1 talking to
 * the TEST database.
 *
 * It is written back into this process's environment because e2e/login.ts signs in with
 * process.env.ADMIN_PASSWORD - the runner and the server have to agree.
 */
const adminPassword = 'playwright-e2e-admin-password';
process.env['ADMIN_PASSWORD'] = adminPassword;

/**
 * The dashboard verifies audit records with PUBLIC keys only (lib/verify-keys.ts). The audit
 * spec signs its fixture with the gateway's own ADGATE_SIGNING_KEY_PEM, so the server under
 * test is handed the public half of exactly that key - never the private one. An environment
 * without a signing key still starts the server; the audit spec is the one that then fails,
 * with a message telling you to run keygen.
 */
const signingKeyId = process.env['ADGATE_SIGNING_KEY_ID'] ?? '';
const signingKeyPem = (process.env['ADGATE_SIGNING_KEY_PEM'] ?? '').replace(/\\n/g, '\n');
const publicKeysJson =
  signingKeyId === '' || signingKeyPem === ''
    ? '{}'
    : JSON.stringify({ [signingKeyId]: derivePublicPem(signingKeyPem) });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] === '1' || process.env['CI'] === 'true',
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: { baseURL, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec next build && pnpm exec next start --port ' + String(port),
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      // The dashboard reads DATABASE_URL; point it at the test database for this run only.
      DATABASE_URL: databaseUrl,
      ADMIN_PASSWORD: adminPassword,
      DASHBOARD_SESSION_SECRET:
        process.env['DASHBOARD_SESSION_SECRET'] ?? 'playwright-e2e-session-secret',
      ADGATE_SIGNING_KEY_ID: signingKeyId,
      ADGATE_PUBLIC_KEYS_JSON: publicKeysJson,
      // Playwright IS the proxy here: each spec sends its own x-forwarded-for so the specs do
      // not share the 10 logins per minute one client address gets (lib/rate-limit.ts). The
      // server under test therefore trusts exactly one hop; a real deployment leaves this off
      // unless a proxy it controls rewrites the header.
      TRUST_PROXY: 'true',
      // Explicitly OFF, whatever the developer's .env says: the specs come from 127.0.0.1 with
      // an invented x-forwarded-for, and an allowlist would refuse every one of them.
      DASHBOARD_ALLOWED_IPS: '',
    },
  },
});
