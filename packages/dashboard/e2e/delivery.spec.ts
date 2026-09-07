import { expect, type Page, test } from '@playwright/test';

import { login, signUp } from './login';
import { resetAndSeed } from './seed';

/**
 * WHY FILL IS ZERO, END TO END. A creative can be active, priced, perfectly targeted and still
 * never serve, and until now the only evidence was one line inside an audit record's demand
 * trace. These two specs walk the whole loop a developer walks: put a creative in the catalog,
 * be told in plain words that nothing can serve it and what to change, change it, and watch the
 * same three screens agree that it can.
 *
 * The second one is about the fact that makes a single badge dishonest: deliverability is per
 * (creative, app). One shared creative, two apps, one of them configured - the list must say
 * "partly blocked" with the count and the creative's own page must show which app is which.
 */

const PASSWORD = 'a passphrase of ordinary words';

/** The exact sentence @adgate/core produces, which is also what check-catalog prints. */
const NOT_CONFIGURED = 'set affiliate_config.partnerstack';

/** Fills the new-creative form for an affiliate creative on partnerstack. */
const fillAffiliateCreative = async (
  page: Page,
  headline: string,
  advertiser: string,
  domain: string,
): Promise<void> => {
  await page.getByLabel('Advertiser', { exact: true }).selectOption({ label: 'New advertiser...' });
  await page.getByLabel('Advertiser name').fill(advertiser);
  await page.getByLabel('Advertiser domain').fill(domain);
  await page.getByLabel('Headline').fill(headline);
  await page.getByLabel('Body').fill('Created by the delivery end to end test.');
  await page.getByLabel('Call to action').fill('Try it free');
  await page.getByLabel('Target categories').fill('software.devtools.database');
  await page.getByLabel('Target regions').fill('US');
  await page.getByLabel('Keywords').fill('postgres');
  await page.getByLabel('eCPM').fill('12');
  await page.getByLabel('Source').selectOption('affiliate');
  await page.getByLabel('Affiliate network').selectOption('partnerstack');
  await page
    .getByLabel('Destination URL')
    .fill('https://partner.example/track?pid={{program_id}}&u=https://example.test/');
};

/** Puts a PartnerStack program id on the app whose page is open, and waits for the save. */
const configurePartnerStack = async (page: Page, programId: string): Promise<void> => {
  await page.getByLabel('PartnerStack program id').fill(programId);
  await page.getByTestId('save-affiliate').click();
  await expect(page.getByTestId('affiliate-saved')).toBeVisible();
};

test.describe('a developer whose own creative cannot serve', () => {
  // Signups are rate limited per client address (lib/rate-limit.ts); this file takes its own.
  test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.77' } });

  test.beforeAll(async () => {
    await resetAndSeed('Playwright delivery shell app');
  });

  test('is told which change unblocks it, and the three screens agree once it is made', async ({
    page,
  }) => {
    await signUp(page, 'dana@example.test', PASSWORD);
    await page.getByLabel('Name', { exact: true }).fill("Dana's chat");
    await page.getByRole('button', { name: 'Create app' }).click();
    await expect(page.getByTestId('app-created')).toBeVisible();
    const appId = (await page.getByTestId('created-app-id').innerText()).trim();

    // ---- a correct, active, well targeted affiliate creative ----
    await page.goto('/creatives/new');
    await fillAffiliateCreative(page, 'Managed Postgres, delivered', 'Dana DB', 'danadb.example');
    await page.getByRole('button', { name: 'Create creative' }).click();
    await expect(page.getByTestId('creative-saved')).toBeVisible();
    await expect(page.getByTestId('creative-state')).toHaveText('active');

    // ---- ...which cannot serve, and the creative's own page says why and what to change ----
    const breakdown = page.getByTestId('delivery-breakdown');
    await expect(breakdown).toContainText("Dana's chat");
    await expect(page.getByTestId('delivery-row')).toHaveCount(1);
    await expect(page.getByTestId('delivery-verdict')).toHaveText('no');
    await expect(page.getByTestId('delivery-reason')).toHaveText('affiliate_not_configured');
    await expect(page.getByTestId('delivery-fix')).toContainText(NOT_CONFIGURED);

    // ---- the list does not show it as a green `active` badge ----
    await page.goto('/creatives');
    await expect(page.getByTestId('creative-status')).toHaveText('cannot serve');
    await expect(page.getByTestId('creative-block-reason')).toContainText(
      'affiliate_not_configured',
    );

    // ---- and the app page turns the zero into an instruction ----
    await page.goto(`/apps/${appId}`);
    const readiness = page.getByTestId('demand-readiness');
    await expect(readiness).toHaveAttribute('data-state', 'blocked');
    await expect(readiness).toContainText('0 of 1 creative can serve');
    await expect(page.getByTestId('demand-readiness-fix')).toContainText(NOT_CONFIGURED);
    // It points at the section of THIS page that fixes it rather than repeating what it says.
    await expect(readiness).toContainText('Fix it under Affiliate accounts below.');

    // ---- make the change the page asked for ----
    await configurePartnerStack(page, 'ps-dana');

    await page.reload();
    await expect(page.getByTestId('demand-readiness')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('demand-readiness')).toContainText('1 of 1 creative can serve');

    await page.goto('/creatives');
    await expect(page.getByTestId('creative-status')).toHaveText('active');
    await expect(page.getByTestId('creative-block-reason')).toHaveCount(0);
  });
});

test.describe('a shared creative judged app by app', () => {
  test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.78' } });

  let shellApp: { id: string; name: string };

  test.beforeAll(async () => {
    shellApp = await resetAndSeed('Playwright shared delivery app');
  });

  test('reads as blocked for both apps, then partly blocked for one of two', async ({ page }) => {
    await login(page);

    // A second app, so the shared catalog has more than one policy to be judged against.
    await page.goto('/apps/new');
    await page.getByLabel('Name', { exact: true }).fill('Second delivery app');
    await page.getByRole('button', { name: 'Create app' }).click();
    await expect(page.getByTestId('app-created')).toBeVisible();
    const secondId = (await page.getByTestId('created-app-id').innerText()).trim();

    // Shared inventory: every app on this gateway may serve it, so every app judges it.
    await page.goto('/creatives/new');
    await fillAffiliateCreative(page, 'Shared inventory, blocked', 'Shared Co', 'sharedco.example');
    await page.getByLabel('Catalog').selectOption({ label: 'Global catalog' });
    await page.getByRole('button', { name: 'Create creative' }).click();
    await expect(page.getByTestId('creative-saved')).toBeVisible();
    const creativeUrl = page.url();

    await expect(page.getByTestId('delivery-row')).toHaveCount(2);
    await expect(page.getByTestId('delivery-verdict').first()).toHaveText('no');

    await page.goto('/creatives');
    await expect(page.getByTestId('creative-status')).toHaveText('cannot serve');
    await expect(page.getByTestId('creative-block-reason')).toContainText(
      'blocked for 2 of 2 apps',
    );

    // ---- configure ONE of the two: the same creative is now deliverable for one, not the other ----
    await page.goto(`/apps/${secondId}`);
    await configurePartnerStack(page, 'ps-second');

    await page.goto('/creatives');
    await expect(page.getByTestId('creative-status')).toHaveText('partly blocked');
    await expect(page.getByTestId('creative-block-reason')).toContainText(
      'blocked for 1 of 2 apps',
    );

    // The creative's own page names WHICH app, which is the thing the count cannot say.
    await page.goto(creativeUrl);
    const rows = page.getByTestId('delivery-row');
    await expect(rows).toHaveCount(2);
    await expect(
      rows.filter({ hasText: shellApp.name }).getByTestId('delivery-verdict'),
    ).toHaveText('no');
    await expect(
      rows.filter({ hasText: 'Second delivery app' }).getByTestId('delivery-verdict'),
    ).toHaveText('yes');
  });
});
