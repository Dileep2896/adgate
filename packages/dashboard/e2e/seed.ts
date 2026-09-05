import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPolicyFromYaml, prefixedUlid } from '@adgate/core';
import { apps, TABLE_NAMES } from '@adgate/gateway/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Test-database setup for the Playwright smoke test. This is the only place in the dashboard
 * that WRITES to Postgres: the app itself is read only (lib/db.ts).
 *
 * It applies the gateway's migrations (so a fresh adgate_test works), empties every table and
 * inserts one app row shaped exactly like registerApp() writes it - a real policy_hash from
 * loadPolicyFromYaml, a real app_ ULID and a random per-app salt. It does not mint an API key:
 * the dashboard never authenticates against the gateway.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = resolve(here, '..', '..', 'gateway', 'drizzle');

export interface SeededApp {
  id: string;
  name: string;
}

/** DATABASE_URL_TEST, refusing anything that is not obviously a test database. */
export const requireTestDatabaseUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const url = env['DATABASE_URL_TEST'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL_TEST is not set. Run `docker compose up -d postgres` and copy .env.example to .env.',
    );
  }
  const database = url.slice(url.lastIndexOf('/') + 1).split('?')[0] ?? '';
  if (!database.includes('test')) {
    throw new Error(
      `DATABASE_URL_TEST must name a test database (got "${database}"); the e2e setup truncates every table in it`,
    );
  }
  return url;
};

const policyYaml = (appId: string): string => ['version: 1', `app_id: ${appId}`, ''].join('\n');

/** Migrates, truncates and inserts one app. Returns the row the smoke test looks for. */
export const resetAndSeed = async (name = 'Playwright smoke app'): Promise<SeededApp> => {
  const url = requireTestDatabaseUrl();
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    await sql.unsafe(
      `TRUNCATE TABLE ${TABLE_NAMES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    const id = prefixedUlid('app_');
    const { policy_hash } = loadPolicyFromYaml(policyYaml(id));
    await db.insert(apps).values({
      id,
      name,
      salt: randomBytes(32).toString('hex'),
      policyYaml: policyYaml(id),
      policyHash: policy_hash,
      policyVersion: 1,
    });
    return { id, name };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/* ------------------------------------------------------------------- traffic fixture --- */

/** ecpm of the one creative every seeded serve points at: 3 impressions earn 3 * 20 / 1000. */
export const TRAFFIC_ECPM = 20;

/**
 * The turns seedTraffic writes, and the numbers the overview must show for them:
 *
 *   turns 10, served 4, suppressed 6
 *   eligible  4 served + 2 no_fill = 6      -> 60.0%
 *   fill      4 / 6                         -> 66.7%
 *   CTR       1 click / 3 impressions       -> 33.3%
 *   revenue   3 * 20 / 1000                 -> 0.06
 *   RPM       0.06 / 6 * 1000               -> 10.00
 *   sensitive 1 of the 6 suppressions
 */
const TRAFFIC_TURNS: [
  decision: string,
  reason: string | null,
  event: 'none' | 'shown' | 'clicked',
][] = [
  ['serve', null, 'clicked'],
  ['serve', null, 'shown'],
  ['serve', null, 'shown'],
  ['serve', null, 'none'],
  ['suppress', 'no_fill', 'none'],
  ['suppress', 'no_fill', 'none'],
  ['suppress', 'paid_user', 'none'],
  ['suppress', 'sensitive_category:health', 'none'],
  ['suppress', 'frequency_cap', 'none'],
  ['suppress', 'error', 'none'],
];

export const TRAFFIC_EXPECTED = {
  turns: '10',
  eligibleRate: '60.0%',
  fillRate: '66.7%',
  impressions: '3',
  clicks: '1',
  ctr: '33.3%',
  revenue: '0.06',
  rpm: '10.00',
} as const;

const hash = (value: string): string => `sha256:${value.padStart(64, '0')}`;

/**
 * A second app with exactly the traffic above, written straight into the tables the gateway
 * writes. Call it after resetAndSeed(). It does NOT go through the gateway: this is a fixture
 * for the dashboard's arithmetic, not a test of how records are produced.
 */
export const seedTraffic = async (name = 'Playwright metrics app'): Promise<SeededApp> => {
  const url = requireTestDatabaseUrl();
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  const db = drizzle(sql);
  try {
    const id = prefixedUlid('app_');
    const { policy_hash } = loadPolicyFromYaml(policyYaml(id));
    await db.insert(apps).values({
      id,
      name,
      salt: randomBytes(32).toString('hex'),
      policyYaml: policyYaml(id),
      policyHash: policy_hash,
      policyVersion: 1,
    });
    await sql`
      insert into advertisers (id, name, domain)
      values ('adv_e2e', 'E2E advertiser', 'e2e.example')
      on conflict (id) do nothing
    `;
    await sql`
      insert into creatives (id, advertiser_id, headline, body, cta, url_template,
        target_categories, target_regions, keywords, ecpm, source, content_hash)
      values ('cr_e2e', 'adv_e2e', 'Headline', 'Body', 'Try it', 'https://e2e.example/',
        '{}', '{}', '{}', ${TRAFFIC_ECPM}, 'direct', ${hash('c')})
      on conflict (id) do nothing
    `;
    let seq = 0;
    for (const [decision, reason, event] of TRAFFIC_TURNS) {
      seq += 1;
      const auditId = `aud_e2e${String(seq).padStart(23, '0')}`;
      const served = decision === 'serve';
      await sql`
        insert into audit_records (record_hash, id, app_id, seq, prev_hash, is_latest, decision,
          reason, creative_id, advertiser_id, ts, record)
        values (${hash(`e${seq}`)}, ${auditId}, ${id}, ${seq}, 'genesis', true, ${decision},
          ${reason}, ${served ? 'cr_e2e' : null}, ${served ? 'adv_e2e' : null},
          now() - (${seq} * interval '1 hour'), '{}'::jsonb)
      `;
      if (event !== 'none') {
        await sql`
          insert into events (id, audit_id, app_id, type, ts)
          values (${`ev_i${String(seq).padStart(22, '0')}`}, ${auditId}, ${id}, 'impression',
            now() - (${seq} * interval '1 hour'))
        `;
      }
      if (event === 'clicked') {
        await sql`
          insert into events (id, audit_id, app_id, type, ts)
          values (${`ev_c${String(seq).padStart(22, '0')}`}, ${auditId}, ${id}, 'click',
            now() - (${seq} * interval '1 hour'))
        `;
      }
    }
    return { id, name };
  } finally {
    await sql.end({ timeout: 5 });
  }
};
