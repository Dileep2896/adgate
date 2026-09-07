import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SeedCreative } from '@adgateio/schemas';

import {
  type AppReadiness,
  appReadiness,
  loadCatalogApps,
  readinessLines,
  type ReadinessCreative,
} from '../catalog/readiness.js';
import { type SeedCounts, type SeedResult, seedCreatives } from '../catalog/seed.js';
import { isMainModule } from '../cli.js';
import { findRepoRoot } from '../env-file.js';
import { optionalFlag, parseFlags, UsageError } from './args.js';
import { connectFromEnv, runScript } from './run.js';

/**
 * `pnpm --filter @adgateio/gateway seed-creatives [--file <seed.json>] [--app <app_id>]`:
 * loads a SeedCreative[] JSON file (default examples/creatives.seed.json) into the global
 * catalog, or into one app's private catalog with --app. Re-running is a no-op.
 */

export const DEFAULT_SEED_FILE = join('examples', 'creatives.seed.json');

export const SEED_CREATIVES_USAGE = [
  'usage: seed-creatives [--file <seed.json>] [--app <app_id>]',
  '',
  `  --file   A JSON array of SeedCreative entries. Default: <repo root>/${DEFAULT_SEED_FILE}.`,
  '  --app    Seed a private catalog for this app instead of the global catalog.',
  '',
  'Idempotent: advertisers match by domain and creatives by (advertiser, headline); unchanged',
  'entries are left alone, changed ones are updated in place and keep their id.',
  '',
  'After seeding it reports, per app, how many of these creatives can actually serve for that',
  'app and why the rest cannot (see check-catalog for the per-creative table). Seeding itself',
  'is unaffected by that report.',
  'Connects to DATABASE_URL (from the environment or the repo-root .env).',
  '',
].join('\n');

export type SeedCreativesArgs =
  { help: true } | { help: false; file: string | null; appId: string | null };

export const parseSeedCreativesArgs = (argv: readonly string[]): SeedCreativesArgs => {
  const { help, flags } = parseFlags(argv, { file: 'string', app: 'string' });
  if (help) {
    return { help: true };
  }
  return { help: false, file: optionalFlag(flags, 'file'), appId: optionalFlag(flags, 'app') };
};

const counts = (label: string, value: SeedCounts): string =>
  `  ${label}: ${value.inserted} inserted, ${value.updated} updated, ${value.unchanged} unchanged`;

/**
 * The readiness block printed under the counts. This is the moment an operator adds inventory,
 * so it is the moment to say that a creative the catalog now holds can never serve: an app with
 * no affiliate_config, or a network the app's policy demand list does not enable, looks exactly
 * like a healthy creative everywhere else.
 */
export const renderReadiness = (readiness: readonly AppReadiness[]): string[] => {
  if (readiness.length === 0) {
    return ['', 'Readiness: no apps are registered yet, so nothing can serve these creatives.'];
  }
  const blocked = readiness.reduce((sum, app) => sum + (app.total - app.deliverable), 0);
  return [
    '',
    blocked === 0
      ? 'Readiness: every seeded creative can serve for every app.'
      : 'Readiness: which of these creatives can actually serve?',
    ...readiness.flatMap((app) => readinessLines(app)),
  ];
};

export const renderSeedOutput = (
  file: string,
  appId: string | null,
  result: SeedResult,
  readiness: readonly AppReadiness[] = [],
): string =>
  [
    `Seeded ${file} into the ${appId === null ? 'global catalog' : `catalog of ${appId}`}`,
    counts('advertisers', result.advertisers),
    counts('creatives  ', result.creatives),
    ...renderReadiness(readiness),
    '',
  ].join('\n');

/** The seed entries as readiness inputs; a seed has no id yet, so the advertiser is the label. */
export const seedReadinessCreatives = (seeds: readonly SeedCreative[]): ReadinessCreative[] =>
  seeds.map((seed) => ({
    label: seed.advertiser,
    creative: {
      active: seed.active,
      source: seed.source,
      network: seed.network,
      target_categories: seed.target_categories,
      target_regions: seed.target_regions,
    },
  }));

const resolveSeedFile = (file: string | null): string => {
  if (file !== null) {
    return file;
  }
  const root = findRepoRoot();
  if (root === null) {
    throw new UsageError(`not inside the repo: pass --file <seed.json>`);
  }
  return join(root, DEFAULT_SEED_FILE);
};

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseSeedCreativesArgs(argv);
  if (args.help) {
    return SEED_CREATIVES_USAGE;
  }
  const file = resolveSeedFile(args.file);
  const entries: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(entries)) {
    throw new UsageError(`${file} must contain a JSON array of SeedCreative entries`);
  }
  const handle = connectFromEnv();
  try {
    const result = await seedCreatives(handle.db, entries, { appId: args.appId });
    // Re-parsed rather than threaded out of seedCreatives: it already validated them, so this
    // cannot throw, and the script stays additive to the seeding path.
    const seeds = SeedCreative.array().parse(entries);
    const apps = await loadCatalogApps(handle.db, args.appId);
    const inputs = seedReadinessCreatives(seeds);
    const readiness = apps.map((app) => appReadiness(app, inputs));
    return renderSeedOutput(file, args.appId, result, readiness);
  } finally {
    await handle.close();
  }
};

if (isMainModule(import.meta.url)) {
  await runScript({ usage: SEED_CREATIVES_USAGE, main }, process.argv.slice(2));
}
