import {
  type AppReadiness,
  appReadiness,
  blockedLines,
  loadCatalogApps,
  loadCatalogEntries,
} from '../catalog/readiness.js';
import { isMainModule } from '../cli.js';
import type { DbOrTx } from '../db/client.js';
import { optionalFlag, parseFlags } from './args.js';
import { connectFromEnv, runScript } from './run.js';

/**
 * `pnpm --filter @adgate/gateway check-catalog [--app <app_id>]`: for every app (or one), the
 * creatives it could serve, whether each one CAN serve, and the first reason it cannot.
 *
 * The two failures this exists for look identical to an operator: the creative is active, it
 * matches the turn's category, and it never serves. One is an app with no affiliate_config
 * (every affiliate adapter answers affiliate_not_configured); the other is an affiliate network
 * that appears on no enabled entry of the app's policy demand list, so its creatives are never
 * queried at all. Both are correct behaviour, and both were previously visible only inside one
 * line of an audit record's demand trace.
 *
 * Read-only and ALWAYS exit code 0: this is a diagnostic, not a gate. The decision itself is
 * creativeDeliverability() in @adgate/core; the loading and grouping is src/catalog/readiness.ts.
 */

export const CHECK_CATALOG_USAGE = [
  'usage: check-catalog [--app <app_id>]',
  '',
  '  --app    Only this app. Default: every app, oldest id first.',
  '',
  'Lists each creative the app could serve (the global catalog plus the app’s private rows,',
  'inactive ones included) with yes/no and, when no, the first blocking reason. Nothing is',
  'written and the exit code is always 0.',
  'Connects to DATABASE_URL (from the environment or the repo-root .env).',
  '',
].join('\n');

export type CheckCatalogArgs = { help: true } | { help: false; appId: string | null };

export const parseCheckCatalogArgs = (argv: readonly string[]): CheckCatalogArgs => {
  const { help, flags } = parseFlags(argv, { app: 'string' });
  return help ? { help: true } : { help: false, appId: optionalFlag(flags, 'app') };
};

/** Readiness for every app in scope. Each app is judged against its own policy and config. */
export const checkCatalog = async (
  db: DbOrTx,
  appId: string | null = null,
): Promise<AppReadiness[]> => {
  const apps = await loadCatalogApps(db, appId);
  const results: AppReadiness[] = [];
  for (const app of apps) {
    results.push(appReadiness(app, await loadCatalogEntries(db, app.id)));
  }
  return results;
};

const YES = 'yes';
const NO = 'no ';

const tableLines = (readiness: AppReadiness): string[] => {
  const width = readiness.rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  return readiness.rows.map((row) => {
    const flag = row.result.deliverable ? YES : NO;
    const reason = row.result.deliverable ? '' : `  ${row.result.reason}`;
    return `    ${flag}  ${row.label.padEnd(width)}${reason}`;
  });
};

const appLines = (readiness: AppReadiness): string[] => {
  const head = `  ${readiness.app_id} (${readiness.app_name})`;
  if (readiness.error !== null) {
    return [`${head}: ${readiness.error}`, ''];
  }
  if (readiness.total === 0) {
    return [`${head}: no creatives in this app’s catalog`, ''];
  }
  return [
    `${head}: ${String(readiness.deliverable)} of ${String(readiness.total)} creatives can serve`,
    ...tableLines(readiness),
    ...blockedLines(readiness),
    '',
  ];
};

export const renderCatalogReport = (readiness: readonly AppReadiness[]): string => {
  if (readiness.length === 0) {
    return 'No apps to check (register one with create-app, or check the --app id).\n';
  }
  const total = readiness.reduce((sum, app) => sum + app.total, 0);
  const deliverable = readiness.reduce((sum, app) => sum + app.deliverable, 0);
  return [
    'Catalog deliverability',
    '',
    ...readiness.flatMap(appLines),
    `  ${String(readiness.length)} apps, ${String(total)} creatives checked, ${String(deliverable)} can serve`,
    '',
  ].join('\n');
};

const main = async (argv: readonly string[]): Promise<string> => {
  const args = parseCheckCatalogArgs(argv);
  if (args.help) {
    return CHECK_CATALOG_USAGE;
  }
  const handle = connectFromEnv();
  try {
    return renderCatalogReport(await checkCatalog(handle.db, args.appId));
  } finally {
    await handle.close();
  }
};

export const runCheckCatalogCli = (argv: readonly string[]): Promise<void> =>
  runScript({ usage: CHECK_CATALOG_USAGE, main }, argv);

if (isMainModule(import.meta.url)) {
  await runCheckCatalogCli(process.argv.slice(2));
}
