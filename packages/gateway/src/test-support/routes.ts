import { asc, eq } from 'drizzle-orm';

import type { DbHandle } from '../db/client.js';
import { auditRecords, events } from '../db/schema.js';
import type { Harness } from '../evaluate/test-support.js';

/**
 * Request and row helpers shared by the attest, events and click integration tests, on top of
 * the evaluate harness (evaluate/test-support.ts). Not a test file.
 */
export type AuditVersionRow = typeof auditRecords.$inferSelect;
export type EventRow = typeof events.$inferSelect;

export interface JsonPostOptions {
  /** The bearer to send; null sends no Authorization header. Default: the harness app's key. */
  apiKey?: string | null | undefined;
  /** A raw body string instead of JSON.stringify(body). */
  raw?: string | undefined;
}

/** POST a JSON body to `path` through the Hono app, with the harness key unless told otherwise. */
export const postJson = async (
  h: Harness,
  path: string,
  body: unknown,
  options: JsonPostOptions = {},
): Promise<Response> => {
  const apiKey = options.apiKey === undefined ? h.apiKey : options.apiKey;
  return h.app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }),
    },
    body: options.raw ?? JSON.stringify(body),
  });
};

/** GET /c/<audit id> without following the redirect (app.request never follows one). */
export const getClick = async (h: Harness, auditId: string): Promise<Response> =>
  h.app.request(`/c/${auditId}`, { method: 'GET' });

/** Every stored version of an audit id, oldest first (the attested one is last). */
export const auditVersions = (handle: DbHandle, auditId: string): Promise<AuditVersionRow[]> =>
  handle.db
    .select()
    .from(auditRecords)
    .where(eq(auditRecords.id, auditId))
    .orderBy(asc(auditRecords.seq));

/** The events rows of an audit id in insertion order. */
export const eventRows = (handle: DbHandle, auditId: string): Promise<EventRow[]> =>
  handle.db.select().from(events).where(eq(events.auditId, auditId)).orderBy(asc(events.createdAt));
