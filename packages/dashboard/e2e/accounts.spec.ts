import { expect, type Page, test } from '@playwright/test';

import { login, signIn, signUp } from './login';
import { resetAndSeed, type SeededApp } from './seed';

/**
 * SELF-SERVE, END TO END: a third-party developer signs up, creates their first app, takes the
 * key the one time it exists, and cannot see anybody else's anything.
 *
 * The claim that matters is the last one. A console where two accounts can read each other's
 * apps, audit records or keys is worse than no console, so this walks the whole path twice with
 * two different accounts and then asks the second one for the first one's app by id.
 */

/** Signups and logins are rate limited per client address; this file uses one of its own. */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.55' } });

/** docs/api.md: ak_<prefix>_<secret>. Shown once, on the screen that mints it. */
const API_KEY_PATTERN = /^ak_[A-Za-z0-9]{8,12}_[A-Za-z0-9_-]{32,128}$/;

const PASSWORD = 'a passphrase of ordinary words';
const ALICE = 'alice@example.test';
const BOB = 'bob@example.test';

let operatorApp: SeededApp;

test.beforeAll(async () => {
  // The fixture app has NO owner - it is the shape `create-app` writes - so no member may see it.
  operatorApp = await resetAndSeed('Playwright operator app');
});

/** Creates the first app from the welcome step and returns its id and the once-only key. */
const createFirstApp = async (page: Page, name: string): Promise<{ id: string; key: string }> => {
  await expect(page.getByRole('heading', { name: 'Create your first app' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create app' }).click();

  await expect(page.getByTestId('app-created')).toBeVisible();
  const id = (await page.getByTestId('created-app-id').innerText()).trim();
  const key = (await page.getByTestId('api-key-value').innerText()).trim();
  return { id, key };
};

test('a developer signs up, creates an app and sees the key exactly once', async ({ page }) => {
  await signUp(page, ALICE, PASSWORD);
  const { id, key } = await createFirstApp(page, "Alice's chat");

  expect(id).toMatch(/^app_[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(key).toMatch(API_KEY_PATTERN);
  await expect(page.getByTestId('app-created')).toContainText('shown once');

  // The snippets beside it carry the app id and the ENV VAR NAME, never the key.
  await expect(page.getByTestId('integration-panel')).toBeVisible();
  await expect(page.getByTestId('integration-code')).toContainText(id);
  expect(await page.getByTestId('integration-code').innerText()).not.toContain(key);

  // Reloading loses it for good: adgate stores an argon2id hash and cannot show it again.
  await page.reload();
  await expect(page.getByTestId('api-key-value')).toHaveCount(0);
  expect(await page.content()).not.toContain(key);

  // ...and no other page can produce it either.
  await page.goto(`/apps/${id}`);
  await expect(page.getByTestId('app-id')).toHaveText(id);
  expect(await page.content()).not.toContain(key);
  await expect(page.getByTestId('api-key-row')).toHaveCount(1);

  // The account sees ITS app and not the operator's ownerless one.
  await page.goto('/apps');
  await expect(page.getByTestId('app-row')).toHaveCount(1);
  await expect(page.getByText(operatorApp.name)).toHaveCount(0);
});

test('a second account cannot see the first account’s app, by list or by id', async ({ page }) => {
  await signIn(page, ALICE, PASSWORD);
  const aliceAppId = (await page.getByTestId('app-row').first().innerText()).match(
    /app_[0-9A-HJKMNP-TV-Z]{26}/,
  )?.[0];
  expect(aliceAppId, "Alice's app id").toBeDefined();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signUp(page, BOB, PASSWORD);
  await createFirstApp(page, "Bob's chat");

  await page.goto('/apps');
  await expect(page.getByTestId('app-row')).toHaveCount(1);
  await expect(page.getByText("Bob's chat")).toBeVisible();
  await expect(page.getByText("Alice's chat")).toHaveCount(0);

  // THE ID IS NOT A CAPABILITY. Asking for Alice's app by id is the same not-found as asking for
  // an app that was never registered.
  await page.goto(`/apps/${String(aliceAppId)}`);
  await expect(page.getByRole('heading', { name: 'No such app' })).toBeVisible();
  await page.goto('/apps/app_00000000000000000000000000');
  await expect(page.getByRole('heading', { name: 'No such app' })).toBeVisible();

  // The audit search and the reports list are scoped the same way: Bob has no traffic at all.
  await page.goto('/audit');
  await expect(page.getByTestId('audit-row')).toHaveCount(0);
  await page.goto('/reports');
  await expect(page.getByTestId('report-row')).toHaveCount(0);

  // And a member has no operator surface: /admin sends them back to their own apps.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/apps$/);
});

test('signup refuses a short password and a duplicate address, and says so', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill('carol@example.test');
  // `minlength` would stop the browser submitting, so the check is proved on the server.
  await page.getByLabel('Password', { exact: true }).evaluate((input) => {
    (input as HTMLInputElement).removeAttribute('minlength');
  });
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByTestId('sign-up').click();
  await expect(page).toHaveURL(/\/signup\?error=weak_password/);
  await expect(page.getByTestId('signup-error')).toContainText('12 characters');
  // The address comes back so nobody retypes it; the password never does.
  await expect(page.getByLabel('Email')).toHaveValue('carol@example.test');

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByTestId('sign-up').click();
  await expect(page).toHaveURL(/\/apps\/new\?welcome=1$/);
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await page.goto('/signup');
  await page.getByLabel('Email').fill('CAROL@example.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByTestId('sign-up').click();
  await expect(page).toHaveURL(/\/signup\?error=email_taken/);
  await expect(page.getByTestId('signup-error')).toContainText('already has an account');
});

test('an unknown address and a wrong password are refused in the same words', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/login\?error=invalid/);
  const unknown = await page.getByTestId('login-error').innerText();

  await page.goto('/login');
  await page.getByLabel('Email').fill(ALICE);
  await page.getByLabel('Password', { exact: true }).fill('definitely not the password');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/login\?error=invalid/);
  expect(await page.getByTestId('login-error').innerText()).toBe(unknown);
});

test('the operator sees every app and every account', async ({ page }) => {
  await login(page);

  await page.goto('/apps');
  // Alice's, Bob's and the ownerless fixture app. Carol signed up and never made one.
  await expect(page.getByTestId('app-row')).toHaveCount(3);
  await expect(page.getByText(operatorApp.name)).toBeVisible();

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Operator' })).toBeVisible();
  // Scoped to the accounts table: every address also appears in the Owner column below it.
  const accounts = page.getByTestId('account-row');
  await expect(accounts).toHaveCount(3);
  for (const email of [ALICE, BOB, 'carol@example.test']) {
    await expect(accounts.filter({ hasText: email })).toHaveCount(1);
  }
  // Every app, with its owner - and the CLI-shaped one called out as the member-invisible case.
  const adminApps = page.getByTestId('admin-app-row');
  await expect(adminApps).toHaveCount(3);
  await expect(adminApps.filter({ hasText: ALICE })).toHaveCount(1);
  await expect(adminApps.filter({ hasText: 'no owner' })).toHaveCount(1);
});
