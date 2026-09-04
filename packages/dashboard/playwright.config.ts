import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const adminPassword = process.env['ADMIN_PASSWORD'] ?? '';
const databaseUrl = process.env['DATABASE_URL_TEST'] ?? '';

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
    },
  },
});
