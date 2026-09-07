import { isMainModule } from '../cli.js';
import { createLogger, type Logger } from '../logger.js';
import { type RetentionAppResult, type RetentionSummary, runRetention } from '../retention/run.js';
import { optionalFlag, parseFlags, UsageError } from './args.js';
import { connectFromEnv, runScript } from './run.js';

/**
 * `pnpm --filter @adgateio/gateway retention [--dry-run] [--app <app_id>] [--now <iso>]`: the
 * cron entry of the retention job. Deletes each app's audit records older than its own
 * policy.privacy.retain_days, from the oldest end of its chain only, together with the events
 * and raw text that belonged to them, and records the watermark that lets verification report
 * the shortened chain as `pruned` instead of broken.
 *
 * The job is the implementation in src/retention/ (run.ts, queries.ts); this file is only the
 * command line around it, and packages/gateway/scripts/retention.ts is the entry point pnpm
 * runs. Writes one structured pino line per app (counts and positions, never content) and a
 * human summary at the end. See docs/privacy.md for the crontab line.
 */

export const RETENTION_USAGE = [
  'usage: retention [--dry-run] [--app <app_id>] [--now <iso 8601>]',
  '',
  '  --dry-run  Report what would be deleted and roll it back. Nothing is written.',
  '  --app      Only this app. Default: every app, oldest id first.',
  '  --now      The clock the cutoffs are measured back from. Default: now.',
  '',
  'Each app keeps its records for its own policy.privacy.retain_days (docs/policy.md). An app',
  'whose stored policy no longer parses is skipped and nothing is deleted for it.',
  'Connects to DATABASE_URL (from the environment or the repo-root .env).',
  '',
].join('\n');

export interface RetentionArgs {
  dryRun: boolean;
  appId: string | null;
  now: Date | null;
}

export const parseRetentionArgs = (
  argv: readonly string[],
): { help: true } | ({ help: false } & RetentionArgs) => {
  const { help, flags } = parseFlags(argv, {
    'dry-run': 'boolean',
    app: 'string',
    now: 'string',
  });
  if (help) {
    return { help: true };
  }
  const rawNow = optionalFlag(flags, 'now');
  let now: Date | null = null;
  if (rawNow !== null) {
    const parsed = Date.parse(rawNow);
    if (!Number.isFinite(parsed)) {
      throw new UsageError('--now must be an ISO 8601 timestamp');
    }
    now = new Date(parsed);
  }
  return { help: false, dryRun: flags['dry-run'] === true, appId: optionalFlag(flags, 'app'), now };
};

const APP_STATUS: Record<RetentionAppResult['status'], string> = {
  pruned: 'pruned  ',
  nothing_to_prune: 'kept    ',
  policy_unreadable: 'SKIPPED ',
  failed: 'FAILED  ',
};

const appLine = (app: RetentionAppResult): string => {
  const counts = `${String(app.records_deleted)} records, ${String(app.events_deleted)} events, ${String(app.raw_text_deleted)} raw_text`;
  const window =
    app.retain_days === null ? 'policy unreadable' : `retain ${String(app.retain_days)}d`;
  const reason = app.error_name === undefined ? '' : ` (${app.error_name})`;
  const through =
    app.pruned_through_seq === 0 ? '' : ` through seq ${String(app.pruned_through_seq)}`;
  return `  ${APP_STATUS[app.status]} ${app.app_id}  ${window}  ${counts}${through}${reason}`;
};

export const renderRetentionSummary = (summary: RetentionSummary): string => {
  const { totals } = summary;
  return [
    summary.dry_run
      ? `Retention DRY RUN at ${summary.now} (nothing was deleted)`
      : `Retention run at ${summary.now}`,
    ...summary.apps.map(appLine),
    '',
    `  ${String(totals.apps)} apps: ${String(totals.pruned)} pruned, ${String(totals.skipped)} skipped, ${String(totals.failed)} failed`,
    `  deleted: ${String(totals.records_deleted)} audit records, ${String(totals.events_deleted)} events, ${String(totals.raw_text_deleted)} raw_text rows`,
    '',
  ].join('\n');
};

/** Exit code 1 when an app was skipped or failed: cron must not swallow that silently. */
const incomplete = (summary: RetentionSummary): boolean =>
  summary.totals.skipped > 0 || summary.totals.failed > 0;

const main = async (argv: readonly string[], logger?: Logger): Promise<string> => {
  const args = parseRetentionArgs(argv);
  if (args.help) {
    return RETENTION_USAGE;
  }
  const log = logger ?? createLogger({ level: 'info' });
  const handle = connectFromEnv();
  try {
    const summary = await runRetention(handle.db, {
      now: args.now ?? undefined,
      appId: args.appId,
      dryRun: args.dryRun,
      logger: log,
    });
    if (incomplete(summary)) {
      process.exitCode = 1;
    }
    return renderRetentionSummary(summary);
  } finally {
    await handle.close();
  }
};

export const runRetentionCli = (argv: readonly string[]): Promise<void> =>
  runScript({ usage: RETENTION_USAGE, main: (args) => main(args) }, argv);

if (isMainModule(import.meta.url)) {
  await runRetentionCli(process.argv.slice(2));
}
