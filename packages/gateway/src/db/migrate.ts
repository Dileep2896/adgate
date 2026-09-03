import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { isMainModule, redactDatabaseUrl } from '../cli.js';
import { loadRootEnvFile } from '../env-file.js';
import { createDb } from './client.js';

/**
 * Applies the SQL migrations drizzle-kit generated into packages/gateway/drizzle. Drizzle
 * records applied migrations in drizzle.__drizzle_migrations, so running this again is a
 * no-op. `pnpm db:migrate [url]` runs it from the command line against the argument or
 * DATABASE_URL (loaded from the repo-root .env when present); tests call runMigrations with
 * DATABASE_URL_TEST.
 */

/** packages/gateway/drizzle, found from src/db/ (tsx, vitest) or from the bundled dist/. */
export const findMigrationsDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../../drizzle'), resolve(here, '../drizzle')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) {
      return candidate;
    }
  }
  throw new Error(
    `drizzle migrations folder not found (looked in ${candidates.join(', ')}); run pnpm --filter @adgate/gateway db:generate`,
  );
};

export const runMigrations = async (
  url: string,
  migrationsFolder: string = findMigrationsDir(),
): Promise<void> => {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
};

const main = async (): Promise<void> => {
  loadRootEnvFile();
  const url = process.argv[2] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    console.error('db:migrate: pass a Postgres URL as the first argument or set DATABASE_URL');
    process.exitCode = 1;
    return;
  }
  const folder = findMigrationsDir();
  await runMigrations(url, folder);
  console.log(`db:migrate: applied ${folder} to ${redactDatabaseUrl(url)}`);
};

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`db:migrate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
