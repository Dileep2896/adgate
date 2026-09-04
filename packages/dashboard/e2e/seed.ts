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
