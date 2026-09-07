import { verify } from '@adgateio/core';
import {
  type AuditReader,
  type AuditRecordRow,
  buildVerifyContext,
  createAuditReader,
} from '@adgateio/gateway/audit';
import { AuditRecord } from '@adgateio/schemas';

import type { AppScope } from './app-scope';
import { appNameOf, type AuditVersionSummary, listAuditVersions } from './audit-lookups';
import { type DashboardDb, dashboardDb } from './db';
import { appIsVisible } from './scope-queries';
import { describeCheck } from './verify-labels';
import { type VerifyKeys, verifyKeys } from './verify-keys';

/**
 * Everything /audit/[id] shows, computed ON THE SERVER: the stored record, its neighbours in
 * the app's chain, its other version when it has been attested, and the live result of core's
 * verify() over it.
 *
 * VERIFICATION IS NOT CACHED AND NOT COPIED. The page runs verify() on every load, against the
 * record as it is stored right now, with the context packages/gateway/src/audit-api builds for
 * GET /v1/verify/:id - the SAME loader and the SAME buildVerifyContext, imported through
 * @adgateio/gateway/audit rather than reimplemented here. A dashboard that agreed with the
 * gateway only most of the time would be worse than no dashboard: an operator uses this page to
 * decide whether the chain is intact.
 *
 * The page components receive plain data (strings, numbers, booleans): @adgateio/core is a Node
 * package and nothing computed here crosses into the browser.
 */

export interface AuditDetailQuery {
  auditId: string;
  /** A record_hash naming one stored version; undefined = the latest one. */
  version?: string | undefined;
}

export interface ChainNeighbour {
  auditId: string;
  recordHash: string;
  seq: number;
  ts: Date;
  decision: 'serve' | 'suppress';
  reason: string | null;
  isLatest: boolean;
}

export interface VerifyCheckView {
  name: string;
  ok: boolean;
  /** verify()'s own detail, or '' when a passing check carries none. */
  detail: string;
  /** What the check means (lib/verify-labels.ts), for the operator who is not holding the doc. */
  description: string;
}

export interface AuditVerification {
  valid: boolean;
  checks: VerifyCheckView[];
  /** Names of the checks that failed, in order. Empty when the record verifies. */
  failed: string[];
  /** Set when the key ring itself is missing or unusable; the checks are still real. */
  keyIssue: string | null;
}

export interface AuditDetail {
  /** The stored record, parsed, or null when it no longer satisfies the contract. */
  record: AuditRecord | null;
  /** The stored jsonb pretty printed - what verify() actually hashed. */
  recordJson: string;
  recordHash: string;
  auditId: string;
  appId: string;
  appName: string | null;
  seq: number;
  isLatest: boolean;
  ts: Date;
  /** AttestRequest.rendered as the SDK reported it; null on an unattested row (S19). */
  attestRendered: boolean | null;
  /** Every stored version of this id, oldest first. More than one = the record was attested. */
  versions: AuditVersionSummary[];
  previous: ChainNeighbour | null;
  next: ChainNeighbour | null;
  /** The older version this one attests, when this row supersedes another. */
  superseded: ChainNeighbour | null;
  /** The attestation of this row, when a newer version supersedes it. */
  supersededBy: ChainNeighbour | null;
  verification: AuditVerification;
}

export interface AuditDetailOptions {
  db?: DashboardDb;
  /** Injected by the integration tests so they verify against the ring they signed with. */
  keys?: VerifyKeys;
}

export interface AuditDetailQueryScoped extends AuditDetailQuery {
  /**
   * Whose record this must be. The record is looked up by id FIRST (the gateway's reader is the
   * one that knows about versions) and the app it belongs to is checked immediately afterwards;
   * a record outside the scope returns null - the same answer as an id that does not exist - and
   * nothing about it is read, verified or rendered.
   */
  scope: AppScope;
}

const neighbourOf = (row: AuditRecordRow | null): ChainNeighbour | null =>
  row === null
    ? null
    : {
        auditId: row.id,
        recordHash: row.recordHash,
        seq: row.seq,
        ts: row.ts,
        decision: row.decision,
        reason: row.reason,
        isLatest: row.isLatest,
      };

/** The row at seq +- 1 of the same app, or null at either end of the chain. */
const atSeq = async (
  reader: AuditReader,
  appId: string,
  seq: number,
): Promise<AuditRecordRow | null> => (seq < 1 ? null : reader.findBySeq(appId, seq));

const parseRecord = (record: unknown): AuditRecord | null => {
  const parsed = AuditRecord.safeParse(record);
  return parsed.success ? parsed.data : null;
};

export const loadAuditDetail = async (
  query: AuditDetailQueryScoped,
  options: AuditDetailOptions = {},
): Promise<AuditDetail | null> => {
  const db = options.db ?? dashboardDb();
  const keys = options.keys ?? verifyKeys();
  const reader = createAuditReader(db);

  const found = await reader.findVersion({ auditId: query.auditId, version: query.version });
  if (found === null) {
    return null;
  }
  const { row } = found;
  if (!(await appIsVisible(query.scope, row.appId, db))) {
    return null;
  }

  const [ctx, previous, next, versions, appName, latest] = await Promise.all([
    buildVerifyContext(reader, row),
    atSeq(reader, row.appId, row.seq - 1),
    atSeq(reader, row.appId, row.seq + 1),
    listAuditVersions(row.id, db),
    appNameOf(row.appId, db),
    reader.findLatest(row.id),
  ]);
  const superseded =
    row.supersedesHash === null ? null : await reader.findByHash(row.supersedesHash);
  const supersededBy =
    latest !== null &&
    latest.recordHash !== row.recordHash &&
    latest.supersedesHash === row.recordHash
      ? latest
      : null;

  const result = verify(row.record, keys.ring, ctx);

  return {
    record: parseRecord(row.record),
    recordJson: JSON.stringify(row.record, null, 2),
    recordHash: row.recordHash,
    auditId: row.id,
    appId: row.appId,
    appName,
    seq: row.seq,
    isLatest: row.isLatest,
    ts: row.ts,
    attestRendered: row.attestRendered,
    versions,
    previous: neighbourOf(previous),
    next: neighbourOf(next),
    superseded: neighbourOf(superseded),
    supersededBy: neighbourOf(supersededBy),
    verification: {
      valid: result.valid,
      checks: result.checks.map((check) => ({
        name: check.name,
        ok: check.ok,
        detail: check.detail ?? '',
        description: describeCheck(check.name),
      })),
      failed: result.checks.filter((check) => !check.ok).map((check) => check.name),
      keyIssue: keys.issue,
    },
  };
};
