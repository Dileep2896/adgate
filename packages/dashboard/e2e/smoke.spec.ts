import { expect, test } from '@playwright/test';

import { login } from './login';
import { resetAndSeed, type SeededApp } from './seed';

/**
 * The S30 smoke test: the dashboard is behind the admin password, logging in works, and the
 * nav plus the app list render from the real database.
 */

const NAV_LINKS = ['Apps', 'Creatives', 'Audit', 'Reports'] as const;

let seeded: SeededApp;

test.beforeAll(async () => {
  seeded = await resetAndSeed();
});

test('an unauthenticated request to /apps is redirected to the login form', async ({ page }) => {
  await page.goto('/apps');
  await expect(page).toHaveURL(/\/login\?from=%2Fapps$/);
  await expect(page.getByLabel('Admin password')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apps' })).toHaveCount(0);
});

test('a forged session cookie does not get past the layout', async ({ page, context, baseURL }) => {
  await context.addCookies([
    {
      name: 'adgate_dashboard_session',
      value: `v1.${Date.now() + 3_600_000}.not-a-real-signature`,
      url: baseURL ?? 'http://127.0.0.1:3210',
    },
  ]);
  await page.goto('/apps');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('Admin password')).toBeVisible();
});

test('the wrong password is refused', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Admin password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login\?error=invalid/);
  await expect(page.getByTestId('login-error')).toContainText('not right');
});

test('logging in shows the nav and the seeded app', async ({ page }) => {
  await login(page);

  for (const label of NAV_LINKS) {
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
  await expect(page.getByTestId('app-row')).toHaveCount(1);
  await expect(page.getByText(seeded.name)).toBeVisible();
  await expect(page.getByText(seeded.id)).toBeVisible();
});

test('the nav reaches every section and sign out ends the session', async ({ page }) => {
  await login(page);

  for (const label of ['Creatives', 'Audit', 'Reports'] as const) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/apps');
  await expect(page).toHaveURL(/\/login\?from=%2Fapps$/);
});
