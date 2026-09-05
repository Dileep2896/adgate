import { describe, expect, it } from 'vitest';

import type { RetentionAppResult, RetentionSummary } from '../retention/run.js';
import { UsageError } from './args.js';
import { parseRetentionArgs, renderRetentionSummary, RETENTION_USAGE } from './retention.js';

/** The command line of the retention job: flags in, and the text a cron mail shows. */

const appResult = (patch: Partial<RetentionAppResult> = {}): RetentionAppResult => ({
  app_id: 'app_1',
  status: 'pruned',
  retain_days: 90,
  cutoff: '2026-06-06T00:00:00.000Z',
  pruned_through_seq: 12,
  records_deleted: 12,
  events_deleted: 4,
  raw_text_deleted: 2,
  ...patch,
});

const summary = (apps: RetentionAppResult[], dryRun = false): RetentionSummary => ({
  dry_run: dryRun,
  now: '2026-09-04T00:00:00.000Z',
  apps,
  totals: {
    apps: apps.length,
    pruned: apps.filter((app) => app.status === 'pruned').length,
    skipped: apps.filter((app) => app.status === 'policy_unreadable').length,
    failed: apps.filter((app) => app.status === 'failed').length,
    records_deleted: apps.reduce((sum, app) => sum + app.records_deleted, 0),
    events_deleted: apps.reduce((sum, app) => sum + app.events_deleted, 0),
    raw_text_deleted: apps.reduce((sum, app) => sum + app.raw_text_deleted, 0),
  },
});

describe('parseRetentionArgs', () => {
  it('defaults to every app, a live run and the current clock', () => {
    expect(parseRetentionArgs([])).toEqual({ help: false, dryRun: false, appId: null, now: null });
  });

  it('reads --dry-run, --app and --now', () => {
    expect(
      parseRetentionArgs(['--dry-run', '--app', 'app_x', '--now', '2026-09-04T00:00:00Z']),
    ).toEqual({
      help: false,
      dryRun: true,
      appId: 'app_x',
      now: new Date('2026-09-04T00:00:00Z'),
    });
  });

  it('answers --help with the usage text', () => {
    expect(parseRetentionArgs(['--help'])).toEqual({ help: true });
    expect(RETENTION_USAGE).toContain('--dry-run');
    expect(RETENTION_USAGE).toContain('retain_days');
  });

  it('refuses a --now that is not a timestamp, an unknown flag and a value on --dry-run', () => {
    expect(() => parseRetentionArgs(['--now', 'yesterday'])).toThrow(UsageError);
    expect(() => parseRetentionArgs(['--delete-everything'])).toThrow(UsageError);
    expect(() => parseRetentionArgs(['--dry-run=true'])).toThrow(UsageError);
    expect(() => parseRetentionArgs(['--app'])).toThrow(UsageError);
  });
});

describe('renderRetentionSummary', () => {
  it('reports each app with its counts and the run totals', () => {
    const text = renderRetentionSummary(
      summary([
        appResult(),
        appResult({
          app_id: 'app_2',
          status: 'nothing_to_prune',
          records_deleted: 0,
          events_deleted: 0,
          raw_text_deleted: 0,
          pruned_through_seq: 0,
        }),
      ]),
    );
    expect(text).toContain('Retention run at 2026-09-04T00:00:00.000Z');
    expect(text).toContain('app_1');
    expect(text).toContain('12 records, 4 events, 2 raw_text');
    expect(text).toContain('through seq 12');
    expect(text).toContain('2 apps: 1 pruned, 0 skipped, 0 failed');
  });

  it('says loudly that a dry run deleted nothing, and names a skipped app', () => {
    const skipped = appResult({
      app_id: 'app_bad',
      status: 'policy_unreadable',
      retain_days: null,
      cutoff: null,
      pruned_through_seq: 0,
      records_deleted: 0,
      events_deleted: 0,
      raw_text_deleted: 0,
      error_name: 'PolicyValidationError',
    });
    const text = renderRetentionSummary(summary([skipped], true));
    expect(text).toContain('DRY RUN');
    expect(text).toContain('nothing was deleted');
    expect(text).toContain('SKIPPED');
    expect(text).toContain('policy unreadable');
    expect(text).toContain('PolicyValidationError');
    expect(text).toContain('1 apps: 0 pruned, 1 skipped, 0 failed');
  });
});
