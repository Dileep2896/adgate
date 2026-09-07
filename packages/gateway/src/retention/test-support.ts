import { prefixedUlid } from '@adgateio/core';
import { EvaluateResponse } from '@adgateio/schemas';
import { asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { registerApp } from '../apps/register-app.js';
import type { DbHandle } from '../db/client.js';
import { auditRecords, events, rawText } from '../db/tables/audit.js';
import { retentionState, type RetentionStateRow } from '../db/tables/retention.js';
import {
  createHarness,
  evaluateBody,
  type Harness,
  type HarnessOptions,
} from '../evaluate/test-support.js';

/**
 * Shared fixture of the retention integration tests: a harness whose clock the test moves, so
 * records can be written months apart in a few milliseconds, plus extra apps with their own
 * policies and keys.
 *
 * The records are written by the REAL evaluate route at the injected clock, not inserted by
 * hand: they are signed, chained and (with store_raw_text) accompanied by their raw_text row
 * exactly as production writes them, which is what makes "the chain still verifies after
 * pruning" a claim worth making. Not a test file.
 */

/** Retention window and raw text storage the tests measure against. */
export const RETAIN_DAYS = 30;

export const retentionPolicyYaml = (retainDays = RETAIN_DAYS, storeRawText = true): string =>
  [
    'version: 1',
    'app_id: retention-app',
    'privacy:',
    `  store_raw_text: ${String(storeRawText)}`,
    `  retain_days: ${String(retainDays)}`,
    '',
  ].join('\n');

export interface RetentionApp {
  appId: string;
  apiKey: string;
}

export interface RetentionHarness {
  h: Harness;
  /** Moves the gateway's clock; every later turn is written at this instant. */
  setNow(at: Date): void;
  /** Registers another app with its own policy and app-role key. */
  addApp(policyYaml: string, name?: string): Promise<RetentionApp>;
  close(): Promise<void>;
}

export const createRetentionHarness = async (
  options: HarnessOptions = {},
): Promise<RetentionHarness> => {
  let clock = Date.now();
  const h = await createHarness({
    policyYaml: options.policyYaml ?? retentionPolicyYaml(),
    ...options,
    overrides: { now: () => clock, ...options.overrides },
  });
  return {
    h,
    setNow: (at) => {
      clock = at.getTime();
    },
    addApp: async (policyYaml, name = 'Retention test app') => {
      const registered = await registerApp(h.handle.db, { name, policyYaml });
      return { appId: registered.app.id, apiKey: registered.key.api_key };
    },
    close: () => h.close(),
  };
};

/** One evaluate turn for `app`, at the harness's current clock. Returns the parsed response. */
export const turn = async (
  harness: RetentionHarness,
  app: RetentionApp,
  at: Date,
  patch: { conversation_id?: string; content?: string } = {},
): Promise<EvaluateResponse> => {
  harness.setNow(at);
  const conversationId = patch.conversation_id ?? `conv_${String(at.getTime())}`;
  const body = evaluateBody(app.appId, {
    conversation_id: conversationId,
    turn_id: `turn_${String(at.getTime())}`,
    ...(patch.content === undefined ? {} : { content: patch.content }),
  });
  const res = await harness.h.post(body, { apiKey: app.apiKey });
  expect(res.status).toBe(200);
  return EvaluateResponse.parse(await res.json());
};

/** An impression event against a turn, written the way events/store.ts writes one. */
export const addEvent = async (
  handle: DbHandle,
  app: RetentionApp,
  auditId: string,
  at: Date,
): Promise<void> => {
  await handle.db
    .insert(events)
    .values({ id: prefixedUlid('ev_'), auditId, appId: app.appId, type: 'impression', ts: at });
};

/** The app's chain positions that still exist, ascending. */
export const seqsOf = async (handle: DbHandle, appId: string): Promise<number[]> => {
  const rows = await handle.db
    .select({ seq: auditRecords.seq })
    .from(auditRecords)
    .where(eq(auditRecords.appId, appId))
    .orderBy(asc(auditRecords.seq));
  return rows.map((row) => row.seq);
};

/** The audit ids that still have an events row, sorted. */
export const eventAuditIds = async (handle: DbHandle, appId: string): Promise<string[]> => {
  const rows = await handle.db
    .select({ auditId: events.auditId })
    .from(events)
    .where(eq(events.appId, appId));
  return rows.map((row) => row.auditId).sort();
};

/** The audit ids that still have a raw_text row, sorted. */
export const rawTextAuditIds = async (handle: DbHandle, appId: string): Promise<string[]> => {
  const rows = await handle.db
    .select({ auditId: rawText.auditId })
    .from(rawText)
    .where(eq(rawText.appId, appId));
  return rows.map((row) => row.auditId).sort();
};

export const watermarkOf = async (
  handle: DbHandle,
  appId: string,
): Promise<RetentionStateRow | null> => {
  const [row] = await handle.db
    .select()
    .from(retentionState)
    .where(eq(retentionState.appId, appId));
  return row ?? null;
};
