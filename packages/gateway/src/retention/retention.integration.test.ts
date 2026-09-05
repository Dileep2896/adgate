import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apps } from '../db/tables/apps.js';
import { TEXT } from '../evaluate/test-support.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { RETENTION_SKIPPED, runRetention } from './run.js';
import {
  addEvent,
  createRetentionHarness,
  eventAuditIds,
  RETAIN_DAYS,
  type RetentionApp,
  type RetentionHarness,
  rawTextAuditIds,
  retentionPolicyYaml,
  seqsOf,
  turn,
  watermarkOf,
} from './test-support.js';

/**
 * The retention job against the real database: what it deletes, what it leaves, what it writes
 * down, and the two things it must never do - delete anything under a policy it could not read,
 * and delete anything at all on a dry run.
 *
 * The window is 30 days and the clock is pinned, so "old" and "new" are exact: three turns in
 * March are months past the cutoff, three in May are inside it.
 */
const NOW = new Date('2026-06-01T00:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - RETAIN_DAYS * 86_400_000);
const OLD_TURNS = [
  new Date('2026-03-01T09:00:00.000Z'),
  new Date('2026-03-02T09:00:00.000Z'),
  new Date('2026-03-03T09:00:00.000Z'),
];
const NEW_TURNS = [
  new Date('2026-05-10T09:00:00.000Z'),
  new Date('2026-05-11T09:00:00.000Z'),
  new Date('2026-05-12T09:00:00.000Z'),
];

interface Seeded {
  app: RetentionApp;
  /** Audit ids in chain order: the three old turns then the three new ones. */
  auditIds: string[];
}

let harness: RetentionHarness | undefined;

beforeEach(async () => {
  harness = await createRetentionHarness();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Six turns spanning the cutoff, each with an impression and (per policy) its raw text. */
const seedApp = async (h: RetentionHarness, app: RetentionApp): Promise<Seeded> => {
  const auditIds: string[] = [];
  for (const at of [...OLD_TURNS, ...NEW_TURNS]) {
    const res = await turn(h, app, at, { content: TEXT.health });
    expect(res.decision).toBe('suppress');
    auditIds.push(res.audit_id);
    await addEvent(h.h.handle, app, res.audit_id, at);
  }
  return { app, auditIds };
};

const appOf = (h: RetentionHarness): RetentionApp => ({
  appId: h.h.appId,
  apiKey: h.h.apiKey,
});

describe('the retention job', () => {
  it('deletes the oldest records, their events and their raw text, and keeps the rest', async () => {
    const h = harness!;
    const app = appOf(h);
    const { auditIds } = await seedApp(h, app);
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await rawTextAuditIds(h.h.handle, app.appId)).toEqual([...auditIds].sort());

    const summary = await runRetention(h.h.handle.db, { now: NOW });

    const result = summary.apps.find((entry) => entry.app_id === app.appId);
    expect(result).toMatchObject({
      status: 'pruned',
      retain_days: RETAIN_DAYS,
      cutoff: CUTOFF.toISOString(),
      pruned_through_seq: 3,
      records_deleted: 3,
      events_deleted: 3,
      raw_text_deleted: 3,
    });
    expect(summary.dry_run).toBe(false);

    const kept = auditIds.slice(3).sort();
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([4, 5, 6]);
    expect(await eventAuditIds(h.h.handle, app.appId)).toEqual(kept);
    expect(await rawTextAuditIds(h.h.handle, app.appId)).toEqual(kept);
  });

  it('writes the watermark the verifier reads', async () => {
    const h = harness!;
    const app = appOf(h);
    await seedApp(h, app);
    expect(await watermarkOf(h.h.handle, app.appId)).toBeNull();

    await runRetention(h.h.handle.db, { now: NOW });

    const watermark = await watermarkOf(h.h.handle, app.appId);
    expect(watermark?.prunedThroughSeq).toBe(3);
    expect(watermark?.prunedBefore.toISOString()).toBe(CUTOFF.toISOString());
  });

  it('is idempotent: a second run deletes nothing and leaves the watermark alone', async () => {
    const h = harness!;
    const app = appOf(h);
    await seedApp(h, app);
    await runRetention(h.h.handle.db, { now: NOW });
    const first = await watermarkOf(h.h.handle, app.appId);

    const second = await runRetention(h.h.handle.db, { now: NOW });

    expect(second.totals).toMatchObject({
      records_deleted: 0,
      events_deleted: 0,
      raw_text_deleted: 0,
      skipped: 0,
      failed: 0,
    });
    expect(second.apps[0]?.status).toBe('nothing_to_prune');
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([4, 5, 6]);
    expect((await watermarkOf(h.h.handle, app.appId))?.updatedAt).toEqual(first?.updatedAt);
  });

  it('changes nothing on a dry run, while reporting exactly what it would delete', async () => {
    const h = harness!;
    const app = appOf(h);
    const { auditIds } = await seedApp(h, app);

    const summary = await runRetention(h.h.handle.db, { now: NOW, dryRun: true });

    expect(summary.dry_run).toBe(true);
    expect(summary.totals).toMatchObject({
      records_deleted: 3,
      events_deleted: 3,
      raw_text_deleted: 3,
    });
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await eventAuditIds(h.h.handle, app.appId)).toEqual([...auditIds].sort());
    expect(await rawTextAuditIds(h.h.handle, app.appId)).toEqual([...auditIds].sort());
    expect(await watermarkOf(h.h.handle, app.appId)).toBeNull();

    // And the real run afterwards deletes precisely what the dry run promised.
    const real = await runRetention(h.h.handle.db, { now: NOW });
    expect(real.totals.records_deleted).toBe(3);
  });

  it('keeps everything for an app whose window has not passed yet', async () => {
    const h = harness!;
    const app = appOf(h);
    await seedApp(h, app);

    const summary = await runRetention(h.h.handle.db, {
      now: new Date('2026-03-20T00:00:00.000Z'),
    });

    expect(summary.apps[0]?.status).toBe('nothing_to_prune');
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await watermarkOf(h.h.handle, app.appId)).toBeNull();
  });

  it('honours each app its own retain_days and --app', async () => {
    const h = harness!;
    const first = appOf(h);
    const second = await h.addApp(retentionPolicyYaml(365), 'Long window app');
    await seedApp(h, first);
    await seedApp(h, second);

    const summary = await runRetention(h.h.handle.db, { now: NOW });

    expect(summary.totals.apps).toBe(2);
    expect(await seqsOf(h.h.handle, first.appId)).toEqual([4, 5, 6]);
    // 365 days: nothing of the second app is old enough yet.
    expect(await seqsOf(h.h.handle, second.appId)).toEqual([1, 2, 3, 4, 5, 6]);

    const third = await h.addApp(retentionPolicyYaml(30), 'Another short window app');
    await seedApp(h, third);
    const scoped = await runRetention(h.h.handle.db, { now: NOW, appId: third.appId });
    expect(scoped.totals.apps).toBe(1);
    expect(scoped.apps[0]?.app_id).toBe(third.appId);
    expect(await seqsOf(h.h.handle, third.appId)).toEqual([4, 5, 6]);
  });
});

describe('an app whose stored policy no longer parses', () => {
  it('is skipped, keeps every row, and gets no watermark', async () => {
    const h = harness!;
    const app = appOf(h);
    const broken = await h.addApp(retentionPolicyYaml(30), 'Broken policy app');
    const { auditIds } = await seedApp(h, broken);
    await seedApp(h, app);
    // Hand-edited to something PolicyConfig rejects, the way an operator breaks one for real.
    await h.h.handle.db
      .update(apps)
      .set({ policyYaml: 'version: 1\nmin_confidence: not-a-number\n' })
      .where(eq(apps.id, broken.appId));

    const logs = collectLogs();
    const summary = await runRetention(h.h.handle.db, {
      now: NOW,
      logger: createLogger({ level: 'info' }, logs.stream),
    });

    const result = summary.apps.find((entry) => entry.app_id === broken.appId);
    expect(result).toMatchObject({
      status: 'policy_unreadable',
      retain_days: null,
      cutoff: null,
      records_deleted: 0,
      events_deleted: 0,
      raw_text_deleted: 0,
    });
    expect(result?.error_name).toBe('PolicyValidationError');
    expect(summary.totals.skipped).toBe(1);
    const skipLine = logs.lines.find((line) => line.includes(RETENTION_SKIPPED));
    expect(skipLine).toBeDefined();
    expect(skipLine).toContain(broken.appId);
    // The line says which app and which error class, never the document that broke.
    expect(skipLine).not.toContain('min_confidence');

    expect(await seqsOf(h.h.handle, broken.appId)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await eventAuditIds(h.h.handle, broken.appId)).toEqual([...auditIds].sort());
    expect(await rawTextAuditIds(h.h.handle, broken.appId)).toEqual([...auditIds].sort());
    expect(await watermarkOf(h.h.handle, broken.appId)).toBeNull();

    // The readable app in the same run is still pruned: one bad policy stops one app.
    expect(await seqsOf(h.h.handle, app.appId)).toEqual([4, 5, 6]);
  });
});
