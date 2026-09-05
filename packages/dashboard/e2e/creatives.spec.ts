import { expect, type Page, test } from '@playwright/test';

import { login } from './login';
import { resetAndSeed } from './seed';

/**
 * The S33 flow end to end against the Postgres TEST database: create a creative through the UI,
 * see it in the list, edit it (and watch its content_hash change), then deactivate it and watch
 * the list and the filters agree.
 *
 * It also proves the two refusals that matter: a field the schema rejects saves nothing, and an
 * affiliate creative without a network is not written at all.
 */

/**
 * Logins are rate limited to 10 a minute PER CLIENT ADDRESS (lib/rate-limit.ts) and the whole
 * suite runs in well under a minute, so this file signs in from an address of its own instead
 * of spending the shared budget the other specs need.
 */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.33' } });

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

const HEADLINE = 'Playwright managed Postgres';
const EDITED_HEADLINE = 'Playwright managed Postgres, edited';

test.beforeAll(async () => {
  await resetAndSeed();
});

const fillNewCreative = async (page: Page): Promise<void> => {
  // Once the first creative exists its advertiser is the select's default option, so ask for the
  // "new advertiser" fields explicitly. Typing the same name for the same domain is allowed;
  // typing a DIFFERENT name for it is the refusal lib/creative-fields.ts is there for.
  await page.getByLabel('Advertiser', { exact: true }).selectOption({ label: 'New advertiser...' });
  await page.getByLabel('Advertiser name').fill('Playwright DB Cloud');
  await page.getByLabel('Advertiser domain').fill('playwrightdb.example');
  await page.getByLabel('Headline').fill(HEADLINE);
  await page.getByLabel('Body').fill('Created by the end to end test.');
  await page.getByLabel('Call to action').fill('Try it free');
  await page.getByLabel('Destination URL').fill('https://playwrightdb.example/?ref=adgate');
  await page.getByLabel('Target categories').fill('software.devtools.database');
  await page.getByLabel('Target regions').fill('US, EU');
  await page.getByLabel('Keywords').fill('postgres, database');
  await page.getByLabel('eCPM').fill('14.5');
};

test('a creative is created, edited and deactivated from the dashboard', async ({ page }) => {
  await login(page);
  await page.goto('/creatives');
  await expect(page.getByTestId('creatives-empty')).toBeVisible();

  // ---- create ----
  await page.getByRole('link', { name: 'New creative' }).first().click();
  await expect(page).toHaveURL(/\/creatives\/new$/);
  await fillNewCreative(page);
  await page.getByRole('button', { name: 'Create creative' }).click();

  await expect(page.getByTestId('creative-saved')).toBeVisible();
  const id = (await page.getByTestId('creative-id').innerText()).trim();
  expect(id).toMatch(/^cr_[0-9A-HJKMNP-TV-Z]{26}$/);
  const firstHash = (await page.getByTestId('creative-content-hash').innerText()).trim();
  expect(firstHash).toMatch(SHA256_PATTERN);
  // The editor says out loud that editing the copy moves the hash out from under old records.
  await expect(page.getByTestId('content-hash-warning')).toContainText('creative_hash mismatch');

  // ---- it is in the list, with everything the demand path uses ----
  await page.goto('/creatives');
  await expect(page.getByTestId('creative-row')).toHaveCount(1);
  const row = page.getByTestId('creative-row').first();
  await expect(row).toContainText(HEADLINE);
  await expect(row).toContainText('Playwright DB Cloud');
  await expect(row).toContainText('playwrightdb.example');
  await expect(row).toContainText('direct');
  await expect(row).toContainText('software.devtools.database');
  await expect(row).toContainText('US, EU');
  await expect(row).toContainText('14.50');
  await expect(row).toContainText('Global');
  await expect(page.getByTestId('creative-status')).toHaveText('active');

  // ---- edit: the copy changes and so does the content hash ----
  await page.getByRole('link', { name: HEADLINE }).click();
  await expect(page).toHaveURL(new RegExp(`/creatives/${id}$`));
  await page.getByLabel('Headline').fill(EDITED_HEADLINE);
  await page.getByRole('button', { name: 'Save creative' }).click();

  await expect(page.getByTestId('creative-saved')).toContainText('saved');
  const secondHash = (await page.getByTestId('creative-content-hash').innerText()).trim();
  expect(secondHash).toMatch(SHA256_PATTERN);
  expect(secondHash).not.toBe(firstHash);

  await page.goto('/creatives');
  await expect(page.getByTestId('creative-row')).toContainText(EDITED_HEADLINE);

  // ---- deactivate: the row stays, paused ----
  await page.getByTestId('deactivate-creative').click();
  await expect(page.getByTestId('creative-status')).toHaveText('paused');
  await expect(page.getByTestId('creative-row')).toHaveCount(1);
  await expect(page.getByTestId('reactivate-creative')).toBeVisible();

  // ---- the filters see the same thing ----
  await page.getByLabel('Status').selectOption('active');
  await page.getByTestId('apply-filters').click();
  await expect(page.getByTestId('creatives-empty')).toBeVisible();

  await page.getByLabel('Status').selectOption('inactive');
  await page.getByTestId('apply-filters').click();
  await expect(page.getByTestId('creative-row')).toHaveCount(1);
  await expect(page.getByTestId('creative-status')).toHaveText('paused');

  // ---- and it comes back: reactivating drops it out of the "paused only" view ----
  await page.getByTestId('reactivate-creative').click();
  await expect(page.getByTestId('creatives-empty')).toBeVisible();
  await page.goto('/creatives?active=active');
  await expect(page.getByTestId('creative-row')).toHaveCount(1);
  await expect(page.getByTestId('creative-status')).toHaveText('active');
});

test('a creative the schema would reject is not written', async ({ page }) => {
  await login(page);
  await page.goto('/creatives');
  const before = await page.getByTestId('creative-row').count();

  await page.getByRole('link', { name: 'New creative' }).first().click();
  await fillNewCreative(page);
  await page.getByLabel('Headline').fill('Never stored');
  await page.getByLabel('Target categories').fill('software.devtools.databse');
  await page.getByLabel('eCPM').fill('free');
  await page.getByRole('button', { name: 'Create creative' }).click();

  await expect(page.getByTestId('issue-target_categories')).toContainText('Not in the taxonomy');
  await expect(page.getByTestId('issue-ecpm')).toBeVisible();
  await expect(page).toHaveURL(/\/creatives\/new$/);

  await page.goto('/creatives');
  await expect(page.getByTestId('creative-row')).toHaveCount(before);
});

test('an affiliate creative must name its network', async ({ page }) => {
  await login(page);
  await page.goto('/creatives/new');
  await fillNewCreative(page);
  await page.getByLabel('Headline').fill('Affiliate without a network');
  await page.getByLabel('Source').selectOption('affiliate');
  await page.getByRole('button', { name: 'Create creative' }).click();

  await expect(page.getByTestId('issue-network')).toContainText('must name its network');
  await expect(page).toHaveURL(/\/creatives\/new$/);

  await page.getByLabel('Affiliate network').selectOption('partnerstack');
  await page
    .getByLabel('Destination URL')
    .fill('https://partner.example/track?pid={{program_id}}&u=https://playwrightdb.example/');
  await page.getByRole('button', { name: 'Create creative' }).click();

  await expect(page.getByTestId('creative-saved')).toBeVisible();
  await page.goto('/creatives?source=affiliate');
  await expect(page.getByTestId('creative-row')).toHaveCount(1);
  await expect(page.getByTestId('creative-row')).toContainText('affiliate / partnerstack');
});
