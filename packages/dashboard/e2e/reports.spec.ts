import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { login } from './login';
import {
  REPORT_ADVERTISER_LABEL,
  REPORT_EXPECTED,
  resetAndSeed,
  seedReportTrail,
  type SeededReportTrail,
} from './seed';

/**
 * The S35 verification report end to end, over a chain that is REAL: every record is built with
 * core's buildAuditRecord and signed with the gateway's own key (e2e/seed.ts), one turn is
 * attested and the impressions and clicks are rows in `events`, so the document the browser
 * renders came out of the same pipeline an operator's would.
 *
 * Three claims are proved here that no unit test can:
 *  - generating a report from the form produces the hand computed numbers on screen;
 *  - the JSON bundle really downloads, and carries the records and the PUBLIC keys (and no
 *    private one);
 *  - the printable view is printable: under print media the nav and every button are gone while
 *    the report itself is still there.
 */

/** Logins are rate limited per client address (S33); this file uses one of its own. */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.77' } });

let trail: SeededReportTrail;

test.beforeAll(async () => {
  await resetAndSeed('Playwright report shell app');
  trail = await seedReportTrail();
});

/** Fills the form and waits for the redirect to the stored report. */
const generate = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/reports/new');
  await page.getByLabel('Advertiser').selectOption({ label: REPORT_ADVERTISER_LABEL });
  await page.getByTestId('generate-report').click();
  await expect(page).toHaveURL(/\/reports\/rep_/);
};

test('generating a report shows the hand computed numbers', async ({ page }) => {
  await login(page);

  await page.goto('/reports');
  await expect(page.getByTestId('no-reports')).toBeVisible();

  await generate(page);

  await expect(page.getByTestId('report-advertiser')).toHaveText(trail.advertiserName);
  await expect(page.getByTestId('report-records')).toHaveText(REPORT_EXPECTED.records);
  await expect(page.getByTestId('report-impressions')).toHaveText(REPORT_EXPECTED.impressions);
  await expect(page.getByTestId('report-clicks')).toHaveText(REPORT_EXPECTED.clicks);
  await expect(page.getByTestId('report-ctr')).toHaveText(REPORT_EXPECTED.ctr);
  await expect(page.getByTestId('report-disclosure')).toHaveText(REPORT_EXPECTED.disclosure);
  await expect(page.getByTestId('report-separation')).toHaveText(REPORT_EXPECTED.separation);
  await expect(page.getByTestId('report-sensitive')).toHaveText(REPORT_EXPECTED.sensitive);
  await expect(page.getByTestId('report-chain')).toHaveText(REPORT_EXPECTED.chain);

  // Zero sensitive exposures and an intact chain are stated in words, not only in a number.
  await expect(page.getByTestId('report-sensitive-banner')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('report-chain-banner')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('report-truncated-banner')).toHaveCount(0);

  // The app the ads ran in, and the categories of the turns they ran on.
  await expect(page.getByTestId('report-app-row')).toHaveCount(1);
  await expect(page.getByTestId('report-by-app')).toContainText(trail.appName);
  await expect(page.getByTestId('report-category-row')).toHaveCount(1);
  await expect(page.getByTestId('report-categories')).toContainText('software.devtools.database');
  await expect(page.getByTestId('report-failure-row')).toHaveCount(0);

  // It is listed, and the /apps header now counts one advertiser with a report.
  await page.goto('/reports');
  await expect(page.getByTestId('report-row')).toHaveCount(1);
  await expect(page.getByTestId('report-chain-status')).toHaveText('all');

  await page.goto('/apps');
  await expect(page.getByTestId('global-reports')).toHaveText('1');
});

test('the JSON bundle downloads with the records and the public keys', async ({ page }) => {
  await login(page);
  await generate(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-bundle').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^rep_[0-9A-Z]{26}\.json$/);

  const path = await download.path();
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
    bundle_version: number;
    records: { record_hash: string; record: { signature: string } }[];
    supporting_records: unknown[];
    creatives: unknown[];
    public_keys: Record<string, string>;
    report: { totals: { records: number } };
  };

  expect(bundle.bundle_version).toBe(1);
  expect(bundle.records).toHaveLength(trail.recordCount);
  expect(bundle.report.totals.records).toBe(trail.recordCount);
  // The neighbours the chain and supersedes checks read, and the creative content behind the
  // content_hash: without them the bundle could not be verified away from the database.
  expect(bundle.supporting_records.length).toBeGreaterThan(0);
  expect(bundle.creatives).toHaveLength(1);
  expect(Object.values(bundle.public_keys)[0]).toContain('BEGIN PUBLIC KEY');
  expect(JSON.stringify(bundle)).not.toContain('PRIVATE KEY');
  expect(bundle.records[0]?.record.signature).toMatch(/^ed25519:/);
});

test('the printable view drops the nav and the buttons and keeps the report', async ({ page }) => {
  await login(page);
  await generate(page);

  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toBeVisible();
  await expect(page.getByTestId('download-bundle')).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  await expect(nav).toBeHidden();
  await expect(page.getByTestId('download-bundle')).toBeHidden();
  await expect(page.getByTestId('report-view')).toBeVisible();
  await expect(page.getByTestId('report-records')).toHaveText(REPORT_EXPECTED.records);
});

test('the form refuses a period it cannot read instead of reporting the wrong one', async ({
  page,
}) => {
  await login(page);
  await page.goto('/reports/new');
  await page.getByTestId('generate-report').click();

  await expect(page).toHaveURL(/\/reports\/new\?/);
  await expect(page.getByTestId('report-form-error')).toContainText('Choose an advertiser');
});
