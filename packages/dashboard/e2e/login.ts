import { expect, type Page } from '@playwright/test';

/**
 * Signs in as the OPERATOR and waits for the app list. Shared by every spec that is about the
 * gateway rather than about one developer's account.
 *
 * ADMIN_PASSWORD is the break-glass login and lives at /admin/login, inside the path prefix
 * DASHBOARD_ALLOWED_IPS guards; /login is the members' email-and-password form. An operator
 * session sees every app, including the ones the fixtures write with no owner, which is why the
 * existing specs still see exactly what they always saw.
 */
export const login = async (page: Page): Promise<void> => {
  const password = process.env['ADMIN_PASSWORD'] ?? '';
  expect(password, 'ADMIN_PASSWORD must be set for the e2e run').not.toBe('');
  await page.goto('/admin/login');
  await page.getByLabel('Admin password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/apps$/);
};

/** Creates an account through the real signup form and lands on the first-app step. */
export const signUp = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('sign-up').click();
  await expect(page).toHaveURL(/\/apps\/new\?welcome=1$/);
};

/** Signs an existing account in through the members' form. */
export const signIn = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/apps$/);
};
