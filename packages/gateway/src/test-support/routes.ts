import { asc, eq } from 'drizzle-orm';

import { issueApiKey } from '../auth/repository.js';
import type { DbHandle } from '../db/client.js';
import { advertisers, auditRecords, events } from '../db/schema.js';
import type { Harness } from '../evaluate/test-support.js';

/**
 * Request and row helpers shared by the attest, events, click and audit API integration tests,
 * on top of the evaluate harness (evaluate/test-support.ts). Not a test file.
 */
export type AuditVersionRow = typeof auditRecords.$inferSelect;
export type EventRow = typeof events.$inferSelect;

export interface JsonPostOptions {
  /** The bearer to send; null sends no Authorization header. Default: the harness app's key. */
  apiKey?: string | null | undefined;
  /** A raw body string instead of JSON.stringify(body). */
  raw?: string | undefined;
}

const authHeaders = (h: Harness, apiKey: string | null | undefined): Record<string, string> => {
  const key = apiKey === undefined ? h.apiKey : apiKey;
  return key === null ? {} : { authorization: `Bearer ${key}` };
};

/** POST a JSON body to `path` through the Hono app, with the harness key unless told otherwise. */
export const postJson = async (
  h: Harness,
  path: string,
  body: unknown,
  options: JsonPostOptions = {},
): Promise<Response> =>
  h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(h, options.apiKey) },
    body: options.raw ?? JSON.stringify(body),
  });

export interface GetOptions {
  /** The bearer to send; null sends no Authorization header. Default: the harness app's key. */
  apiKey?: string | null | undefined;
}

/** GET `path` through the Hono app with a bearer (the harness key unless told otherwise). */
export const getJson = async (
  h: Harness,
  path: string,
  options: GetOptions = {},
): Promise<Response> =>
  h.app.request(path, { method: 'GET', headers: authHeaders(h, options.apiKey) });

export interface AuditGetOptions extends GetOptions {
  /** A record_hash for the ?version= query parameter. */
  version?: string | undefined;
}

const versionQuery = (version: string | undefined): string =>
  version === undefined ? '' : `?version=${encodeURIComponent(version)}`;

/** GET /v1/audit/:id (optionally a specific version). */
export const getAudit = (
  h: Harness,
  auditId: string,
  options: AuditGetOptions = {},
): Promise<Response> => getJson(h, `/v1/audit/${auditId}${versionQuery(options.version)}`, options);

/** GET /v1/verify/:id (optionally a specific version). */
export const getVerify = (
  h: Harness,
  auditId: string,
  options: AuditGetOptions = {},
): Promise<Response> =>
  getJson(h, `/v1/verify/${auditId}${versionQuery(options.version)}`, options);

/** GET /c/<audit id> without following the redirect (app.request never follows one). */
export const getClick = async (h: Harness, auditId: string): Promise<Response> =>
  h.app.request(`/c/${auditId}`, { method: 'GET' });

/** Issues an advertiser_read key for the seeded advertiser with `domain`, under `appId` (default: the harness app). */
export const issueAdvertiserKey = async (
  h: Harness,
  domain: string,
  appId: string = h.appId,
): Promise<string> => {
  const [advertiser] = await h.handle.db
    .select({ id: advertisers.id })
    .from(advertisers)
    .where(eq(advertisers.domain, domain));
  if (advertiser === undefined) {
    throw new Error(`no advertiser with domain ${domain}`);
  }
  const key = await issueApiKey(h.handle.db, {
    appId,
    role: 'advertiser_read',
    advertiserId: advertiser.id,
  });
  return key.api_key;
};

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
