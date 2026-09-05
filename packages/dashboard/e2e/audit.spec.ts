import { expect, test } from '@playwright/test';

import { login } from './login';
import { resetAndSeed, seedAuditTrail, type SeededAuditTrail, tamperRecord } from './seed';

/**
 * The S34 audit view end to end, against a chain that is REAL: every record is built with
 * core's buildAuditRecord, signed with the gateway's own key and chained seq 1..6, so the
 * verification table on the detail page is running core's verify() over a genuine document.
 *
 * The two claims that matter are proved here in a browser: an untouched suppress record shows
 * all eight docs/audit.md checks passing, and a record edited underneath the dashboard with
 * SQL - the exact thing the hash chain exists to catch - is shown as INVALID with the failing
 * check spelled out, not merely coloured.
 */

/** Logins are rate limited per client address (S33); this file uses one of its own. */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.44' } });

let trail: SeededAuditTrail;

test.beforeAll(async () => {
  await resetAndSeed('Playwright audit shell app');
  trail = await seedAuditTrail();
});

test('the audit search filters by decision and reason', async ({ page }) => {
  await login(page);
  await page.goto('/audit');

  await expect(page.getByTestId('audit-row')).toHaveCount(trail.records.length);

  // The reason select is built from the reasons the records actually carry, sensitive
  // categories included, rather than from a hardcoded list.
  const reason = page.getByLabel('Reason');
  await expect(reason.locator('option')).toContainText([
    'Any reason',
    'frequency_cap',
    'no_fill',
    'paid_user',
    'sensitive: health',
  ]);

  await page.getByLabel('Decision').selectOption('suppress');
  await page.getByTestId('apply-audit-filters').click();

  const suppressed = trail.records.filter((record) => record.decision === 'suppress');
  await expect(page.getByTestId('audit-row')).toHaveCount(suppressed.length);
  for (const badge of await page.getByTestId('audit-decision').all()) {
    await expect(badge).toHaveText('suppress');
  }
  // The filters are in the URL, so this view is a link an operator can share.
  expect(page.url()).toContain('decision=suppress');
  expect(page.url()).toContain('app=');
});

test('a suppress record verifies with all eight checks ok', async ({ page }) => {
  await login(page);
  await page.goto('/audit?decision=suppress');

  await page.getByTestId('audit-link').first().click();
  await expect(page).toHaveURL(/\/audit\/aud_/);

  await expect(page.getByTestId('verify-verdict')).toContainText('VALID');
  const checks = page.getByTestId('verify-check');
  await expect(checks).toHaveCount(8);
  await expect(page.locator('[data-testid="verify-check"][data-ok="false"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="verify-check"][data-ok="true"]')).toHaveCount(8);
  await expect(page.getByTestId('verify-key-issue')).toHaveCount(0);

  // The record itself is rendered, not just its hash.
  await expect(page.getByTestId('policy-decisions')).toBeVisible();
  await expect(page.getByTestId('audit-chain')).toBeVisible();
});

test('a record tampered with SQL is shown as invalid with the failing check highlighted', async ({
  page,
}) => {
  const target = trail.records[1];
  expect(target, 'the fixture must have a second record').toBeDefined();
  await tamperRecord(target!.recordHash);

  await login(page);
  await page.goto(`/audit/${target!.id}?version=${encodeURIComponent(target!.recordHash)}`);

  const verdict = page.getByTestId('verify-verdict');
  await expect(verdict).toContainText('INVALID');
  await expect(verdict).toContainText('record_hash');

  const failing = page.locator('[data-testid="verify-check"][data-check="record_hash"]');
  await expect(failing).toHaveAttribute('data-ok', 'false');
  await expect(failing).toContainText('FAILED');

  // Only that check failed: the signature covers the record_hash STRING, which was not edited.
  const signature = page.locator('[data-testid="verify-check"][data-check="signature"]');
  await expect(signature).toHaveAttribute('data-ok', 'true');
  await expect(page.locator('[data-testid="verify-check"][data-ok="false"]')).toHaveCount(1);
});
