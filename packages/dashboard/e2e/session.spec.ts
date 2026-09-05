import { expect, test, type BrowserContext } from '@playwright/test';

import { login } from './login';
import { countReports, REPORT_ADVERTISER_LABEL, resetAndSeed, seedReportTrail } from './seed';

/**
 * THE ROUTES THAT DO NOT RENDER THE LAYOUT.
 *
 * middleware.ts only checks that a session cookie is PRESENT - it runs in the Edge runtime,
 * where the signing secret is not available - so the real gate is requireSession() in the Node
 * runtime. Every protected PAGE gets that from app/(dashboard)/layout.tsx, but two things never
 * render a layout: a server action (a POST to the page's own URL) and a route handler. Both call
 * requireSession()/currentSession() themselves, and until now nothing failed if one stopped.
 *
 * So: a forged cookie gets past middleware, reaches the server action with a REAL action id (the
 * form is submitted by the browser, not synthesised here) and must be refused - and the database
 * must be untouched afterwards, which is the claim that actually matters. Same for the bundle
 * download, which would otherwise hand out every audit record a report covers.
 */

/** Logins are rate limited per client address (S33); this file uses one of its own. */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.99' } });

const FORGED = 'not-a-real-signature';
const SESSION_COOKIE = 'adgate_dashboard_session';

const forgeSession = async (
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> => {
  await context.clearCookies();
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: `v1.${Date.now() + 3_600_000}.${FORGED}`,
      url: baseURL ?? 'http://127.0.0.1:3210',
    },
  ]);
};

test.beforeAll(async () => {
  await resetAndSeed('Playwright session shell app');
  await seedReportTrail();
});

test('a forged cookie cannot run the report server action, and writes nothing', async ({
  page,
  context,
  baseURL,
}) => {
  await login(page);
  await page.goto('/reports/new');
  await page.getByLabel('Advertiser').selectOption({ label: REPORT_ADVERTISER_LABEL });
  expect(await countReports()).toBe(0);

  // The form is loaded and valid; only the session is swapped underneath it, so the POST that
  // follows carries the genuine Next-Action id of generateReportAction.
  await forgeSession(context, baseURL);
  await page.getByTestId('generate-report').click();

  await expect(page).toHaveURL(/\/login/);
  expect(await countReports()).toBe(0);
});

test('an anonymous POST to a server action URL never reaches it', async ({ context }) => {
  const before = await countReports();
  const response = await context.request.post('/reports/new', {
    form: { advertiser: 'adv_audit_fixture' },
    maxRedirects: 0,
  });
  expect([302, 303, 307, 308]).toContain(response.status());
  expect(response.headers()['location']).toContain('/login');
  expect(await countReports()).toBe(before);
});

test('the bundle download is refused without a valid session', async ({ page, context }) => {
  const reportsBefore = await countReports();
  await login(page);
  await page.goto('/reports/new');
  await page.getByLabel('Advertiser').selectOption({ label: REPORT_ADVERTISER_LABEL });
  await page.getByTestId('generate-report').click();
  await expect(page).toHaveURL(/\/reports\/rep_/);
  const reportId = new URL(page.url()).pathname.split('/').pop() ?? '';
  expect(reportId).toMatch(/^rep_/);

  const url = `/api/reports/${reportId}/bundle`;
  // The session cookie is `secure`, and Playwright's request context will not send a secure
  // cookie over http even to 127.0.0.1 (a browser makes that exception, this API client does
  // not), so every request below carries its cookie as an explicit header. That is also the
  // clearest way to say what is being sent.
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? '';
  expect(session).not.toBe('');

  // It really is downloadable with the real session - otherwise the refusals prove nothing.
  const allowed = await context.request.get(url, {
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
    maxRedirects: 0,
  });
  expect(allowed.status()).toBe(200);
  expect(await allowed.text()).toContain('bundle_version');

  // No cookie at all: middleware turns it away.
  const anonymous = await context.request.get(url, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(anonymous.status());
  expect(anonymous.headers()['location']).toContain('/login');
  expect(await anonymous.text()).not.toContain('bundle_version');

  // A forged cookie gets PAST middleware (which only checks that one is present) and has to be
  // refused by the route itself.
  const forged = await context.request.get(url, {
    headers: { cookie: `${SESSION_COOKIE}=v1.${Date.now() + 3_600_000}.${FORGED}` },
    maxRedirects: 0,
  });
  expect([302, 303, 307, 308]).toContain(forged.status());
  expect(forged.headers()['location']).toContain('/login');
  expect(await forged.text()).not.toContain('bundle_version');

  expect(await countReports()).toBe(reportsBefore + 1);
});

test('signing out is refused from another origin', async ({ page, context }) => {
  await login(page);

  // The cross-site form post a page on the internet could make: no session cookie is needed to
  // do the damage, so SameSite=Lax does not cover it.
  const refused = await context.request.post('/api/logout', {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    maxRedirects: 0,
  });
  expect(refused.status()).toBe(403);

  // ...and the operator is still signed in.
  await page.goto('/apps');
  await expect(page).toHaveURL(/\/apps$/);

  // The dashboard's own Sign out button still works.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
