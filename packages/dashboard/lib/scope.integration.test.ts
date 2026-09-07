import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_SCOPE, type AppScope, memberScope } from './app-scope';
import { ALL_APPS, type AuditFilters, ANY_DECISION, ANY_REASON, utcDay } from './audit-filters';
import { loadAuditDetail } from './audit-detail';
import { listAuditPage } from './audit-queries';
import { getCreative, listAppOptions, listCreatives } from './creative-queries';
import { createReadOnlyDb, type DashboardDb, type DashboardDbHandle } from './db';
import { defaultMetricsWindow, globalMetricRows } from './metrics-queries';
import { truncateAll } from './metrics-seed';
// The dashboard's own test database (S32): `<DATABASE_URL_TEST>_dashboard`.
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';
import {
  appDemandReadiness,
  creativeDelivery,
  deliveryOf,
  listReadinessApps,
} from './deliverability';
import { getApp, listApiKeys, listAppsWithCounts } from './queries';
import { getReport, listReports } from './report-queries';
import { appIsVisible, visibleAppIds } from './scope-queries';

/**
 * OWNERSHIP, AGAINST THE REAL DATABASE.
 *
 * Two developers and one operator, each with an app, plus one app the CLI created with no owner
 * at all. Then the question that decides whether this feature is safe: does asking for the OTHER
 * account's app, audit record, creative or report by id look any different from asking for an id
 * that was never written?
 *
 * The fixture is raw SQL rather than the gateway's writers on purpose - it needs a users row, an
 * app, a creative, a signed-looking record and a report, and none of the assertions is about how
 * those got written. The account WRITES have their own integration test next to the code that
 * performs them (packages/gateway/src/accounts/users.integration.test.ts).
 */

const ALICE = 'usr_00000000000000000000alice';
const BOB = 'usr_000000000000000000000bob';
const OPERATOR = 'usr_00000000000000000000oper';

const APP_ALICE = 'app_0000000000000000000alice';
const APP_BOB = 'app_00000000000000000000bob';
const APP_CLI = 'app_00000000000000000000cli';
const APP_NOWHERE = 'app_00000000000000000000000';

const AUD_ALICE = 'aud_0000000000000000000alice';
const AUD_BOB = 'aud_00000000000000000000bob';
const AUD_NOWHERE = 'aud_00000000000000000000000';

const REP_ALICE = 'rep_0000000000000000000alice';
const REP_BOB = 'rep_00000000000000000000bob';
const REP_NOWHERE = 'rep_00000000000000000000000';

const CR_GLOBAL = 'cr_00000000000000000global';
const CR_ALICE = 'cr_000000000000000000alice';
const CR_BOB = 'cr_0000000000000000000bob';

const hash = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

const url = metricsTestDatabaseUrl();
let handle: DashboardDbHandle;
let db: DashboardDb;
let seed: Sql;

const alice: AppScope = memberScope(ALICE);
const bob: AppScope = memberScope(BOB);

const auditFilters = (): AuditFilters => {
  const today = utcDay(new Date());
  return {
    appId: ALL_APPS,
    from: utcDay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    to: today,
    decision: ANY_DECISION,
    reason: ANY_REASON,
  };
};

const seedFixture = async (): Promise<void> => {
  await truncateAll(seed);
  for (const [id, email, role] of [
    [ALICE, 'alice@example.com', 'member'],
    [BOB, 'bob@example.com', 'member'],
    [OPERATOR, 'operator@example.com', 'admin'],
  ] as const) {
    await seed.unsafe(
      `insert into users (id, email, password_hash, role) values ($1, $2, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', $3)`,
      [id, email, role],
    );
  }
  for (const [id, name, owner, keyId] of [
    [APP_ALICE, "Alice's app", ALICE, 'key_0000000000000000000alice'],
    [APP_BOB, "Bob's app", BOB, 'key_00000000000000000000bob'],
    [APP_CLI, 'Operator CLI app', null, 'key_00000000000000000000cli'],
  ] as const) {
    await seed.unsafe(
      // A policy that actually LOADS: the deliverability diagnostic parses this column, and
      // `version: 1` on its own has no app_id and would report every app as unreadable.
      `insert into apps (id, name, salt, policy_yaml, policy_hash, owner_user_id)
       values ($1, $2, 'salt', $3, $4, $5)`,
      [id, name, `version: 1\napp_id: ${id}\n`, hash('a'), owner],
    );
    await seed.unsafe(
      `insert into api_keys (id, app_id, key_prefix, hashed_key, role)
       values ($1, $2, $3, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'app')`,
      [keyId, id, `pfx${keyId.slice(-9)}`],
    );
  }

  await seed.unsafe(
    `insert into advertisers (id, name, domain) values ('adv_scope', 'Scope advertiser', 'scope.example')`,
  );
  for (const [id, headline, appId] of [
    [CR_GLOBAL, 'Shared inventory', null],
    [CR_ALICE, "Alice's creative", APP_ALICE],
    [CR_BOB, "Bob's creative", APP_BOB],
  ] as const) {
    await seed.unsafe(
      `insert into creatives (id, advertiser_id, app_id, headline, body, cta, url_template,
         target_categories, target_regions, keywords, ecpm, source, content_hash)
       values ($1, 'adv_scope', $2, $3, 'Body', 'Try it', 'https://scope.example/',
         '{}', '{}', '{}', 10, 'direct', $4)`,
      [id, appId, headline, hash(id.slice(3, 4))],
    );
  }

  for (const [auditId, appId, recordHash] of [
    [AUD_ALICE, APP_ALICE, hash('1')],
    [AUD_BOB, APP_BOB, hash('2')],
  ] as const) {
    await seed.unsafe(
      `insert into audit_records
         (record_hash, id, app_id, seq, prev_hash, is_latest, decision, reason, creative_id,
          advertiser_id, ts, record)
       values ($1, $2, $3, 1, 'genesis', true, 'serve', null, 'cr_00000000000000000global',
         'adv_scope', now() - interval '1 hour', '{}'::jsonb)`,
      [recordHash, auditId, appId],
    );
  }

  for (const [id, owner] of [
    [REP_ALICE, ALICE],
    [REP_BOB, BOB],
  ] as const) {
    await seed.unsafe(
      `insert into reports (id, advertiser_id, period_start, period_end, report, owner_user_id)
       values ($1, 'adv_scope', now() - interval '30 days', now(), '{}'::jsonb, $2)`,
      [id, owner],
    );
  }
  await seed.unsafe(`analyze apps, audit_records, creatives, reports, users`);
};

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  await seedFixture();
  handle = createReadOnlyDb(url);
  db = handle.db;
}, 120_000);

afterAll(async () => {
  // Leave the shared `_dashboard` database EMPTY. Every other suite here truncates in its own
  // beforeEach, so this is belt and braces - but this file seeds once and would otherwise be the
  // only one whose fixture outlives it, and a stray app row is exactly the kind of thing that
  // makes another suite's count wrong once in a hundred runs.
  // Defensive `?.`: a failing beforeAll leaves one of these undefined, and a TypeError here would
  // hide the real seeding error.
  await handle?.close();
  if (seed !== undefined) {
    await truncateAll(seed);
    await seed.end({ timeout: 5 });
  }
});

describe('apps', () => {
  it('shows a member their own app and nothing else', async () => {
    const rows = await listAppsWithCounts(alice, defaultMetricsWindow(), db);
    expect(rows.map((row) => row.id)).toEqual([APP_ALICE]);
    expect(rows[0]?.ownerUserId).toBe(ALICE);
  });

  it('shows an admin every app, the CLI one with a null owner included', async () => {
    const rows = await listAppsWithCounts(ADMIN_SCOPE, defaultMetricsWindow(), db);
    expect(rows.map((row) => row.id).sort()).toEqual([APP_ALICE, APP_BOB, APP_CLI].sort());
    expect(rows.find((row) => row.id === APP_CLI)?.ownerUserId).toBeNull();
  });

  it('answers the SAME null for another member’s app id as for one that does not exist', async () => {
    expect(await getApp(alice, APP_ALICE, db)).not.toBeNull();
    expect(await getApp(alice, APP_BOB, db)).toBeNull();
    expect(await getApp(alice, APP_CLI, db)).toBeNull();
    expect(await getApp(alice, APP_NOWHERE, db)).toBeNull();
    // ...and the operator sees all three that exist.
    expect(await getApp(ADMIN_SCOPE, APP_BOB, db)).not.toBeNull();
    expect(await getApp(ADMIN_SCOPE, APP_CLI, db)).not.toBeNull();
    expect(await getApp(ADMIN_SCOPE, APP_NOWHERE, db)).toBeNull();
  });

  it('never lists another account’s API keys, even asked for by app id', async () => {
    expect(await listApiKeys(alice, APP_ALICE, db)).toHaveLength(1);
    expect(await listApiKeys(alice, APP_BOB, db)).toEqual([]);
    expect(await listApiKeys(alice, APP_CLI, db)).toEqual([]);
    expect(await listApiKeys(ADMIN_SCOPE, APP_BOB, db)).toHaveLength(1);
  });

  it('offers a member only their own apps as options, which is what the forms validate against', async () => {
    expect((await listAppOptions(alice, db)).map((app) => app.id)).toEqual([APP_ALICE]);
    expect((await listAppOptions(ADMIN_SCOPE, db)).map((app) => app.id).sort()).toEqual(
      [APP_ALICE, APP_BOB, APP_CLI].sort(),
    );
  });

  it('resolves the app id list a report range is built from', async () => {
    expect(await visibleAppIds(alice, db)).toEqual([APP_ALICE]);
    // Null, not "every id": an admin's queries must keep the shape the EXPLAIN suite plans.
    expect(await visibleAppIds(ADMIN_SCOPE, db)).toBeNull();
  });

  it('answers appIsVisible the same way for a foreign app and a missing one', async () => {
    expect(await appIsVisible(alice, APP_ALICE, db)).toBe(true);
    expect(await appIsVisible(alice, APP_BOB, db)).toBe(false);
    expect(await appIsVisible(alice, APP_NOWHERE, db)).toBe(false);
    expect(await appIsVisible(ADMIN_SCOPE, APP_CLI, db)).toBe(true);
    expect(await appIsVisible(ADMIN_SCOPE, APP_NOWHERE, db)).toBe(false);
  });
});

describe('creatives', () => {
  it('shows a member the shared catalog plus their own, never another account’s', async () => {
    const ids = (await listCreatives(alice, undefined, db)).map((row) => row.id).sort();
    expect(ids).toEqual([CR_ALICE, CR_GLOBAL].sort());
  });

  it('shows an admin every creative', async () => {
    const ids = (await listCreatives(ADMIN_SCOPE, undefined, db)).map((row) => row.id).sort();
    expect(ids).toEqual([CR_ALICE, CR_BOB, CR_GLOBAL].sort());
  });

  it('answers null for another account’s private creative by id', async () => {
    expect(await getCreative(alice, CR_GLOBAL, db)).not.toBeNull();
    expect(await getCreative(alice, CR_ALICE, db)).not.toBeNull();
    expect(await getCreative(alice, CR_BOB, db)).toBeNull();
    expect(await getCreative(bob, CR_ALICE, db)).toBeNull();
    expect(await getCreative(ADMIN_SCOPE, CR_BOB, db)).not.toBeNull();
  });
});

describe('the deliverability diagnostic', () => {
  it('judges against a member’s own apps only, and every app for an operator', async () => {
    expect((await listReadinessApps(alice, db)).map((row) => row.id)).toEqual([APP_ALICE]);
    expect((await listReadinessApps(ADMIN_SCOPE, db)).map((row) => row.id).sort()).toEqual(
      [APP_ALICE, APP_BOB, APP_CLI].sort(),
    );
  });

  it('never judges a shared creative against another account’s app', async () => {
    const record = await getCreative(alice, CR_GLOBAL, db);
    expect(record).not.toBeNull();
    const shared = record === null ? [] : [record];
    // Alice has one app, so the shared creative gets exactly one verdict - not Bob's, not the
    // operator's CLI app. The operator, judging the same row, gets all three.
    expect(deliveryOf(await creativeDelivery(alice, shared, db), CR_GLOBAL).judged).toBe(1);
    const asOperator = await creativeDelivery(ADMIN_SCOPE, shared, db);
    const judgedBy = deliveryOf(asOperator, CR_GLOBAL).perApp.map((entry) => entry.appId);
    expect(judgedBy.sort()).toEqual([APP_ALICE, APP_BOB, APP_CLI].sort());
  });

  it('answers the same null for another member’s app as for one that does not exist', async () => {
    expect(await appDemandReadiness(alice, APP_ALICE, db)).not.toBeNull();
    expect(await appDemandReadiness(alice, APP_BOB, db)).toBeNull();
    expect(await appDemandReadiness(alice, APP_CLI, db)).toBeNull();
    expect(await appDemandReadiness(alice, APP_NOWHERE, db)).toBeNull();
    expect(await appDemandReadiness(ADMIN_SCOPE, APP_BOB, db)).not.toBeNull();
  });

  it('counts an app’s catalog as the shared rows plus its own, and says why they cannot serve', async () => {
    const readiness = await appDemandReadiness(alice, APP_ALICE, db);
    expect(readiness?.app_id).toBe(APP_ALICE);
    // The shared creative and Alice's own; Bob's private one is in neither.
    expect(readiness?.total).toBe(2);
    expect(readiness?.rows.map((row) => row.label).sort()).toEqual([CR_ALICE, CR_GLOBAL].sort());
    // The fixture's creatives target nothing at all, which is a real reason with a real fix.
    expect(readiness?.deliverable).toBe(0);
    expect(readiness?.blocked[0]?.reason).toBe('no_target_categories');
    expect(readiness?.blocked[0]?.count).toBe(2);
    expect(readiness?.blocked[0]?.detail).toContain('add at least one category');
  });
});

describe('the audit search', () => {
  it('pages only the records of the account’s own apps', async () => {
    const mine = await listAuditPage(alice, auditFilters(), null, db);
    expect(mine.rows.map((row) => row.id)).toEqual([AUD_ALICE]);

    const everything = await listAuditPage(ADMIN_SCOPE, auditFilters(), null, db);
    expect(everything.rows.map((row) => row.id).sort()).toEqual([AUD_ALICE, AUD_BOB].sort());
  });

  it('treats ?app=<another account’s id> as a filter that matches nothing', async () => {
    const page = await listAuditPage(alice, { ...auditFilters(), appId: APP_BOB }, null, db);
    expect(page.rows).toEqual([]);
    const missing = await listAuditPage(alice, { ...auditFilters(), appId: APP_NOWHERE }, null, db);
    expect(missing.rows).toEqual([]);
  });

  it('answers the same null for a foreign audit id as for one that was never written', async () => {
    expect(await loadAuditDetail({ auditId: AUD_ALICE, scope: alice }, { db })).not.toBeNull();
    expect(await loadAuditDetail({ auditId: AUD_BOB, scope: alice }, { db })).toBeNull();
    expect(await loadAuditDetail({ auditId: AUD_NOWHERE, scope: alice }, { db })).toBeNull();
    expect(await loadAuditDetail({ auditId: AUD_BOB, scope: ADMIN_SCOPE }, { db })).not.toBeNull();
  });
});

describe('reports', () => {
  it('lists only the reports the account generated', async () => {
    expect((await listReports(alice, db)).map((row) => row.id)).toEqual([REP_ALICE]);
    expect((await listReports(ADMIN_SCOPE, db)).map((row) => row.id).sort()).toEqual(
      [REP_ALICE, REP_BOB].sort(),
    );
  });

  it('answers the same null for a foreign report id as for one that does not exist', async () => {
    expect(await getReport(alice, REP_ALICE, db)).not.toBeNull();
    expect(await getReport(alice, REP_BOB, db)).toBeNull();
    expect(await getReport(alice, REP_NOWHERE, db)).toBeNull();
    expect(await getReport(ADMIN_SCOPE, REP_BOB, db)).not.toBeNull();
  });
});

describe('the /apps header numbers', () => {
  it('counts a member’s own apps only, and every app for an operator', async () => {
    const window = defaultMetricsWindow();
    const mine = await globalMetricRows(alice, window, db);
    expect(mine.appsIntegrated).toBe(1);
    expect(mine.advertisersWithReport).toBe(1);
    expect(mine.decisions.reduce((sum, row) => sum + row.count, 0)).toBe(1);

    const everything = await globalMetricRows(ADMIN_SCOPE, window, db);
    expect(everything.appsIntegrated).toBe(2);
    expect(everything.advertisersWithReport).toBe(1);
    expect(everything.decisions.reduce((sum, row) => sum + row.count, 0)).toBe(2);
  });

  it('counts nothing at all for an account with no apps', async () => {
    const nobody = memberScope('usr_0000000000000000nobody00');
    const rows = await globalMetricRows(nobody, defaultMetricsWindow(), db);
    expect(rows.appsIntegrated).toBe(0);
    expect(rows.decisions).toEqual([]);
    expect(rows.advertisersWithReport).toBe(0);
    expect(await listAppsWithCounts(nobody, defaultMetricsWindow(), db)).toEqual([]);
  });
});
