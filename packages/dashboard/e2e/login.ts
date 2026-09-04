import { expect, type Page } from '@playwright/test';

/** Signs in with ADMIN_PASSWORD and waits for the app list. Shared by every spec. */
export const login = async (page: Page): Promise<void> => {
  const password = process.env['ADMIN_PASSWORD'] ?? '';
  expect(password, 'ADMIN_PASSWORD must be set for the e2e run').not.toBe('');
  await page.goto('/login');
  await page.getByLabel('Admin password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/apps$/);
};
