import { expect, test } from '@playwright/test';

import { login } from './login';
import { resetAndSeed, seedTraffic, TRAFFIC_EXPECTED, type SeededApp } from './seed';

/**
 * The S32 overview end to end: two apps in the database, one with exactly ten seeded turns and
 * one with none at all.
 *
 * The app with traffic must show the numbers computed by hand in e2e/seed.ts, and the /apps
 * header must show the same turns and eligible rate across the whole gateway. The quiet app
 * must render the same page with zeros, dashes and two EMPTY charts - no error overlay, no
 * missing section - because that is what every app looks like on the day it is registered.
 */

let quiet: SeededApp;
let busy: SeededApp;

test.beforeAll(async () => {
  quiet = await resetAndSeed('Playwright quiet app');
  busy = await seedTraffic();
});

test('an app with traffic shows the hand computed metrics', async ({ page }) => {
  await login(page);
  await page.goto(`/apps/${busy.id}`);

  const overview = page.getByTestId('app-overview');
  await expect(overview).toBeVisible();
  await expect(page.getByTestId('metric-turns')).toHaveText(TRAFFIC_EXPECTED.turns);
  await expect(page.getByTestId('metric-eligible-rate')).toHaveText(TRAFFIC_EXPECTED.eligibleRate);
  await expect(page.getByTestId('metric-fill-rate')).toHaveText(TRAFFIC_EXPECTED.fillRate);
  await expect(page.getByTestId('metric-impressions')).toHaveText(TRAFFIC_EXPECTED.impressions);
  await expect(page.getByTestId('metric-clicks')).toHaveText(TRAFFIC_EXPECTED.clicks);
  await expect(page.getByTestId('metric-ctr')).toHaveText(TRAFFIC_EXPECTED.ctr);
  await expect(page.getByTestId('metric-revenue')).toHaveText(TRAFFIC_EXPECTED.revenue);
  await expect(page.getByTestId('metric-rpm')).toHaveText(TRAFFIC_EXPECTED.rpm);

  // One of the six suppressions was a sensitive category, and it is drawn as its own bar.
  await expect(page.getByTestId('sensitive-total')).toContainText('1 of 6 suppressions');
  await expect(page.getByTestId('decisions-chart').locator('.recharts-wrapper')).toBeVisible();
  await expect(page.getByTestId('reasons-chart').locator('.recharts-bar-rectangle')).toHaveCount(5);

  // The overview sits above the policy editor, which still works exactly as S31 left it.
  await expect(page.getByTestId('policy-version')).toHaveText('v1');
});

test('an app with no traffic renders zeros, dashes and empty charts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.goto(`/apps/${quiet.id}`);

  await expect(page.getByTestId('metric-turns')).toHaveText('0');
  await expect(page.getByTestId('metric-impressions')).toHaveText('0');
  // A rate with no denominator is unknown, not zero.
  await expect(page.getByTestId('metric-eligible-rate')).toHaveText('-');
  await expect(page.getByTestId('metric-fill-rate')).toHaveText('-');
  await expect(page.getByTestId('metric-ctr')).toHaveText('-');
  await expect(page.getByTestId('metric-rpm')).toHaveText('-');
  await expect(page.getByTestId('no-decisions')).toBeVisible();

  // Both charts still render, with no bars in them and nothing thrown.
  await expect(page.getByTestId('decisions-chart').locator('.recharts-wrapper')).toBeVisible();
  await expect(page.getByTestId('reasons-chart').locator('.recharts-wrapper')).toBeVisible();
  await expect(page.getByTestId('decisions-chart').locator('.recharts-bar-rectangle')).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test('the /apps header shows the gateway wide numbers', async ({ page }) => {
  await login(page);

  // Only the app with traffic has ever written an audit record.
  await expect(page.getByTestId('global-apps')).toHaveText('1');
  await expect(page.getByTestId('global-turns')).toHaveText(TRAFFIC_EXPECTED.turns);
  await expect(page.getByTestId('global-eligible-rate')).toHaveText(TRAFFIC_EXPECTED.eligibleRate);
  await expect(page.getByTestId('global-rpm')).toHaveText(TRAFFIC_EXPECTED.rpm);
  // S35 generates the reports; until it does, honestly zero.
  await expect(page.getByTestId('global-reports')).toHaveText('0');
  await expect(page.getByTestId('app-row')).toHaveCount(2);
});
