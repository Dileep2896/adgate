import { expect, type Page, test } from '@playwright/test';

import { login } from './login';
import { resetAndSeed } from './seed';

/**
 * The S31 flow, end to end against the Postgres TEST database: register an app, read its API
 * key the one time it exists, then edit its policy - once with a document that loosens what
 * docs/policy.md says can never be loosened (nothing may be saved) and once with a tightening
 * one (policy_version goes up and policy_hash changes).
 */

const APP_NAME = 'Playwright created app';
/** docs/api.md: ak_<prefix>_<secret>. The dashboard must show the whole thing, once. */
const API_KEY_PATTERN = /^ak_[A-Za-z0-9]{8,12}_[A-Za-z0-9_-]{32,128}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Drops self_harm from blocked_categories AND invents a key: two schema errors at once. */
const loosenedPolicy = (appId: string): string =>
  [
    'version: 1',
    `app_id: ${appId}`,
    'blocked_categories: [health]',
    'not_a_policy_key: 3',
    '',
  ].join('\n');

/** Valid and strictly stricter than the defaults, so the hash must change. */
const tightenedPolicy = (appId: string): string =>
  [
    'version: 1',
    `app_id: ${appId}`,
    'min_commercial_intent: 0.85',
    'min_confidence: 0.9',
    'frequency_caps:',
    '  per_session: 1',
    '  per_user_per_day: 1',
    '  min_turns_between: 8',
    '',
  ].join('\n');

test.beforeAll(async () => {
  await resetAndSeed();
});

/** Registers an app through the UI and returns its id and the key shown on the confirmation. */
const createApp = async (page: Page, name: string): Promise<{ id: string; apiKey: string }> => {
  await page.getByRole('link', { name: 'New app' }).first().click();
  await expect(page).toHaveURL(/\/apps\/new$/);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create app' }).click();

  await expect(page.getByTestId('app-created')).toBeVisible();
  const id = (await page.getByTestId('created-app-id').innerText()).trim();
  const apiKey = (await page.getByTestId('api-key-value').innerText()).trim();
  return { id, apiKey };
};

test('an app is created, its key is shown once, and its policy can be tightened', async ({
  page,
}) => {
  await login(page);
  const { id, apiKey } = await createApp(page, APP_NAME);

  expect(id).toMatch(/^app_[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(apiKey).toMatch(API_KEY_PATTERN);
  await expect(page.getByTestId('app-created')).toContainText('shown once');

  // The key lives only in this page's React state. Reloading loses it, and no other page can
  // show it: the database holds an argon2id hash.
  await page.reload();
  await expect(page.getByTestId('api-key-value')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create app' })).toBeVisible();
  expect(await page.content()).not.toContain(apiKey);

  await page.goto('/apps');
  await expect(page.getByTestId('app-row')).toHaveCount(2);
  expect(await page.content()).not.toContain(apiKey);

  await page.getByRole('link', { name: APP_NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  expect(await page.content()).not.toContain(apiKey);

  // ---- an invalid policy shows the schema errors inline and saves nothing ----
  const hashBefore = (await page.getByTestId('policy-hash').innerText()).trim();
  expect(hashBefore).toMatch(SHA256_PATTERN);
  await expect(page.getByTestId('policy-version')).toHaveText('v1');

  await page.getByLabel('Policy YAML').fill(loosenedPolicy(id));
  await page.getByRole('button', { name: 'Save policy' }).click();

  const errors = page.getByTestId('policy-errors');
  await expect(errors).toBeVisible();
  await expect(errors).toContainText('self_harm cannot be removed from blocked_categories');
  await expect(errors).toContainText('not_a_policy_key');
  await expect(page.getByTestId('policy-hash')).toHaveText(hashBefore);
  await expect(page.getByTestId('policy-version')).toHaveText('v1');

  // Nothing reached Postgres either, not just nothing on screen.
  await page.reload();
  await expect(page.getByTestId('policy-hash')).toHaveText(hashBefore);
  await expect(page.getByTestId('policy-version')).toHaveText('v1');

  // ---- a valid, tightening policy bumps the version and changes the hash ----
  await page.getByLabel('Policy YAML').fill(tightenedPolicy(id));
  await page.getByRole('button', { name: 'Save policy' }).click();

  await expect(page.getByTestId('policy-saved')).toBeVisible();
  await expect(page.getByTestId('policy-version')).toHaveText('v2');
  const hashAfter = (await page.getByTestId('policy-hash').innerText()).trim();
  expect(hashAfter).toMatch(SHA256_PATTERN);
  expect(hashAfter).not.toBe(hashBefore);

  await page.reload();
  await expect(page.getByTestId('policy-version')).toHaveText('v2');
  await expect(page.getByTestId('policy-hash')).toHaveText(hashAfter);
  await expect(page.getByLabel('Policy YAML')).toHaveValue(tightenedPolicy(id));

  // ---- the app's key is listed without its value, and revoking it works ----
  await expect(page.getByTestId('api-key-row')).toHaveCount(1);
  const keys = page.getByTestId('api-key-row').first();
  await expect(keys).toContainText('app');
  expect(await keys.innerText()).not.toContain(apiKey);

  await page.getByTestId('revoke-key').click();
  await expect(page.getByTestId('revoke-key')).toHaveCount(0);
  await expect(page.getByTestId('api-key-row').first()).toContainText('revoked');
});

test('a starting policy that does not validate creates no app', async ({ page }) => {
  await login(page);
  const before = await page.getByTestId('app-row').count();

  await page.getByRole('link', { name: 'New app' }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('Never created');
  await page
    .getByLabel('Starting policy (optional)')
    .fill('version: 1\napp_id: app_X\nblocked_categories: [finance]\n');
  await page.getByRole('button', { name: 'Create app' }).click();

  await expect(page.getByTestId('new-app-errors')).toContainText('self_harm cannot be removed');
  await expect(page.getByTestId('app-created')).toHaveCount(0);

  await page.goto('/apps');
  await expect(page.getByTestId('app-row')).toHaveCount(before);
});

test('a blank name is refused before anything is written', async ({ page }) => {
  await login(page);
  await page.goto('/apps/new');
  // The browser's own `required` check would stop an empty submit, so send whitespace.
  await page.getByLabel('Name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Create app' }).click();

  await expect(page.getByTestId('new-app-errors')).toContainText('Enter a name for the app.');
});

test('an unknown app id renders the not-found page, not a stack trace', async ({ page }) => {
  await login(page);
  await page.goto('/apps/app_00000000000000000000000000');
  await expect(page.getByRole('heading', { name: 'No such app' })).toBeVisible();
});
