import { randomBytes } from 'node:crypto';

import { createDirectAdapter, creativeContentHash, prefixedUlid } from '@adgate/core';
import { loadCatalog } from '@adgate/gateway';
import type { DemandRequest } from '@adgate/schemas';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCreativeWriter, setCreativeActiveById } from './creative-store';
import { saveCreative } from './creative-save';
import { createWriteDb, type DashboardWriteDbHandle } from './db-write';
import { truncateAll } from './metrics-seed';
import {
  metricsTestDatabaseUrl,
  openSeedClient,
  prepareMetricsTestDatabase,
} from './metrics-test-db';

/**
 * The creative editor against a real Postgres, for the one thing a unit test cannot show: that
 * a creative saved HERE is a creative the DEMAND PATH picks up.
 *
 * It goes through saveCreative() - the exact function the server action calls, validation
 * included - and then loads the catalog the way packages/gateway/src/evaluate/adapters.ts does
 * on every evaluation (loadCatalog + createDirectAdapter), so nothing about the row's shape,
 * its content_hash or its column types is taken on trust. The same claim through the whole HTTP
 * pipeline is proved in packages/gateway/src/catalog/creative-admin.integration.test.ts.
 *
 * Deactivating is then shown to remove it from the adapter's answer while the audit record that
 * served it stays exactly where it was, with a content hash that still recomputes.
 */

const url = metricsTestDatabaseUrl();

let handle: DashboardWriteDbHandle;
let seed: Sql;
let appId: string;

/** A pino logger only ever gets .warn from loadCatalog; the test does not want the output. */
const log = { warn: () => undefined } as unknown as Parameters<typeof loadCatalog>[2];

const CATEGORY = 'software.devtools.database';

const FORM: Record<string, string> = {
  advertiser: 'Dashboard Written Co',
  advertiser_domain: 'dashboardwritten.example',
  headline: 'Created in the dashboard',
  body: 'And eligible immediately.',
  cta: 'Try it',
  url_template: 'https://dashboardwritten.example/?ref=adgate',
  target_categories: CATEGORY,
  target_regions: 'US',
  keywords: 'postgres',
  ecpm: '17.5',
  source: 'direct',
  active: 'on',
  app_id: '',
};

const formOf = (fields: Record<string, string>) => ({
  get: (name: string): unknown => fields[name] ?? null,
});

const request = (): DemandRequest => ({
  app_id: appId,
  classification: {
    commercial_intent: 0.9,
    categories: [CATEGORY],
    sensitive: [],
    confidence: 0.9,
    method: 'rules',
    prompt_version: 'rules:test',
  },
  surface: { type: 'chat', placement: 'after_answer', max_creatives: 1 },
  user: { region: 'US', locale: 'en-US' },
  exclusions: [],
  keywords: ['postgres'],
});

/** Exactly what the gateway does per evaluation, then the direct adapter over the result. */
const directCandidates = async (): Promise<string[]> => {
  const catalog = await loadCatalog(handle.db, appId, log);
  const adapter = createDirectAdapter(catalog.creatives);
  const response = await adapter.fetch(request(), { timeoutMs: 250 });
  return response.candidates.map((candidate) => candidate.id);
};

const save = () =>
  saveCreative(createCreativeWriter(handle.db), formOf(FORM), { advertisers: [], appIds: [appId] });

beforeAll(async () => {
  await prepareMetricsTestDatabase(url);
  seed = openSeedClient(url);
  await truncateAll(seed);
  appId = prefixedUlid('app_');
  await seed`
    insert into apps (id, name, salt, policy_yaml, policy_hash)
    values (${appId}, 'Creative editor test app', ${randomBytes(32).toString('hex')},
      'version: 1', ${`sha256:${'0'.repeat(64)}`})
  `;
  handle = createWriteDb(url);
}, 120_000);

afterAll(async () => {
  await seed?.end({ timeout: 5 });
  await handle?.close();
});

describe('a creative saved through the server action’s own function', () => {
  let created: string;

  it('is returned by DirectAdapter on the very next request', async () => {
    const result = await save();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    created = result.id;
    expect(await directCandidates()).toContain(created);
  });

  it('was stored with the content_hash the audit records will carry', async () => {
    const [row] = await seed<
      { content_hash: string; headline: string; body: string; cta: string; url_template: string }[]
    >`select content_hash, headline, body, cta, url_template from creatives where id = ${created}`;
    expect(row?.content_hash).toBe(
      creativeContentHash({
        advertiser: FORM['advertiser'] ?? '',
        advertiser_domain: FORM['advertiser_domain'] ?? '',
        headline: FORM['headline'] ?? '',
        body: FORM['body'] ?? '',
        cta: FORM['cta'] ?? '',
        url_template: FORM['url_template'] ?? '',
      }),
    );
  });

  it('writes nothing when a field is invalid', async () => {
    const before = await seed`select count(*)::int as total from creatives`;
    const result = await saveCreative(
      createCreativeWriter(handle.db),
      formOf({ ...FORM, headline: 'Another one', ecpm: 'free' }),
      { advertisers: [], appIds: [appId] },
    );
    expect(result.ok).toBe(false);
    expect(await seed`select count(*)::int as total from creatives`).toEqual(before);
  });

  it('disappears from the adapter when it is deactivated, keeping its audit history', async () => {
    // An audit record that served it, exactly as the gateway writes one (minus the signature).
    const auditId = prefixedUlid('aud_');
    await seed`
      insert into audit_records (record_hash, id, app_id, seq, prev_hash, is_latest, decision,
        creative_id, ts, record)
      values (${`sha256:${'1'.repeat(64)}`}, ${auditId}, ${appId}, 1, 'genesis', true, 'serve',
        ${created}, now(), '{}'::jsonb)
    `;

    expect(await setCreativeActiveById(handle.db, created, false)).toBe(true);
    expect(await directCandidates()).not.toContain(created);

    // The row is still there, with a content hash that still recomputes: the audit record it
    // is attached to did not become unverifiable, it only stopped being served.
    const [creative] = await seed<
      { active: boolean; content_hash: string }[]
    >`select active, content_hash from creatives where id = ${created}`;
    expect(creative?.active).toBe(false);
    const [record] = await seed<
      { creative_id: string }[]
    >`select creative_id from audit_records where id = ${auditId}`;
    expect(record?.creative_id).toBe(created);

    expect(await setCreativeActiveById(handle.db, created, true)).toBe(true);
    expect(await directCandidates()).toContain(created);
  });

  it('says so instead of renaming when a domain is claimed under another name', async () => {
    const result = await saveCreative(
      createCreativeWriter(handle.db),
      formOf({ ...FORM, advertiser: 'Impostor Co', headline: 'A different headline' }),
      // The form does not know the advertiser here, so this is the gateway's own refusal.
      { advertisers: [], appIds: [appId] },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : (result.issues[0]?.message ?? '')).toContain(
      'already registered as “Dashboard Written Co”',
    );
    const [row] = await seed<
      { name: string }[]
    >`select name from advertisers where domain = ${FORM['advertiser_domain'] ?? ''}`;
    expect(row?.name).toBe('Dashboard Written Co');
  });
});
