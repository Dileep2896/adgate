import { type Clock, prefixedUlid } from '@adgateio/core';
import type { EventType } from '@adgateio/schemas';
import { and, eq } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { auditRecords, events } from '../db/tables/audit.js';

/**
 * The events table (docs/api.md POST /v1/events): one ev_ row per reported event, keyed by the
 * audit id it belongs to and the app that reported it. Duplicate impressions are ignored at the
 * database (the partial unique index on (audit_id) WHERE type = 'impression' plus ON CONFLICT
 * DO NOTHING), so two SDK retries never count twice and never fail. The click redirect writes
 * its click through the same insert.
 */
export const EVENT_ID_PREFIX = 'ev_';

export interface EventInsert {
  auditId: string;
  /** The reporting app: the authenticated key's app, or the record's app for a click redirect. */
  appId: string;
  type: EventType;
  ts: Date;
  meta: Record<string, unknown>;
}

export type EventInsertResult = 'inserted' | 'duplicate';

export interface EventStore {
  /** The app_id of the latest version of an audit id, or null when no record has that id. */
  ownerOf(auditId: string): Promise<string | null>;
  insert(event: EventInsert): Promise<EventInsertResult>;
}

export interface EventStoreOptions {
  /** Clock for the event id's timestamp. Defaults to Date.now. */
  now?: Clock | undefined;
}

export const createEventStore = (db: DbOrTx, options: EventStoreOptions = {}): EventStore => {
  const now = options.now ?? Date.now;
  return {
    ownerOf: async (auditId) => {
      const [row] = await db
        .select({ appId: auditRecords.appId })
        .from(auditRecords)
        .where(and(eq(auditRecords.id, auditId), eq(auditRecords.isLatest, true)))
        .limit(1);
      return row?.appId ?? null;
    },
    insert: async (event) => {
      const inserted = await db
        .insert(events)
        .values({
          id: prefixedUlid(EVENT_ID_PREFIX, { now }),
          auditId: event.auditId,
          appId: event.appId,
          type: event.type,
          ts: event.ts,
          meta: event.meta,
        })
        .onConflictDoNothing()
        .returning({ id: events.id });
      return inserted.length === 0 ? 'duplicate' : 'inserted';
    },
  };
};
