import { type PublicKeyRing, verify } from '@adgateio/core';
import { AuditId, AuditRecord, Sha256Hash } from '@adgateio/schemas';
import type { Context } from 'hono';

import type { AppEnv } from '../app-env.js';
import { errorResponse } from '../http-error.js';
import { summarizeIssues } from '../request-body.js';
import { canReadAudit } from './authorize.js';
import type { AuditReader, AuditVersion } from './loader.js';
import { buildVerifyContext } from './verify-context.js';

/**
 * GET /v1/audit/:id and GET /v1/verify/:id (docs/api.md), mounted behind
 * bearerAuth({ roles: ['app', 'advertiser_read'] }). Both resolve the id the same way: the
 * latest version of the record (is_latest), or the version named by `?version=<record_hash>`
 * (an older, superseded version once the record was attested); the caller must be allowed to
 * see it (audit-api/authorize.ts), and every failure to resolve is the one 404 not_found body,
 * so no key learns whether an id exists elsewhere. Both answers carry the record_hash of the
 * version served in the X-Adgate-Record-Hash header.
 *
 * /v1/audit returns the stored signed JSON exactly as it is (verify recomputes over the same
 * object, so an offline verifier sees what the server sees); a stored record that no longer
 * satisfies the contract is a 500 with an error log, which should never happen. /v1/verify runs
 * core verify with the context audit-api/verify-context.ts builds and answers 200 whatever the
 * verdict. Log lines carry ids, hashes and check names, never the record.
 */
export const RECORD_HASH_HEADER = 'X-Adgate-Record-Hash';
export const VERSION_QUERY = 'version';

export interface AuditApiDeps {
  /** The verification ring loaded at boot (every key id records may carry). */
  ring: PublicKeyRing;
  reader: AuditReader;
}

type Located = { ok: true; version: AuditVersion } | { ok: false; response: Response };

/** :id and ?version= resolved to a version the caller may read, or the shared 404. */
const locate = async (c: Context<AppEnv>, reader: AuditReader, what: string): Promise<Located> => {
  const log = c.get('logger');
  const auditId = c.req.param('id') ?? '';
  const version = c.req.query(VERSION_QUERY);
  const notFound = (why: string): Located => {
    log.info({ status: 404, audit_id: auditId, why }, `${what} rejected`);
    return {
      ok: false,
      response: errorResponse(c, 404, 'not_found', `audit record ${auditId} not found`),
    };
  };
  if (!AuditId.safeParse(auditId).success) {
    return notFound('malformed id');
  }
  if (version !== undefined && !Sha256Hash.safeParse(version).success) {
    return notFound('malformed version');
  }
  const found = await reader.findVersion({ auditId, version });
  if (found === null) {
    return notFound('unknown');
  }
  const visible = canReadAudit(c.get('auth'), {
    appId: found.row.appId,
    creativeAdvertiserId: found.creativeAdvertiserId,
  });
  return visible ? { ok: true, version: found } : notFound('not visible to this key');
};

export const auditRecordRoute =
  (deps: AuditApiDeps) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const located = await locate(c, deps.reader, 'audit read');
    if (!located.ok) {
      return located.response;
    }
    const { row } = located.version;
    const log = c.get('logger');
    const parsed = AuditRecord.safeParse(row.record);
    if (!parsed.success) {
      log.error(
        {
          audit_id: row.id,
          record_hash: row.recordHash,
          seq: row.seq,
          issues: summarizeIssues(parsed.error.issues),
        },
        'stored audit record does not satisfy the contract',
      );
      return errorResponse(c, 500, 'internal_error', 'Internal error');
    }
    log.info(
      { audit_id: row.id, record_hash: row.recordHash, seq: row.seq, latest: row.isLatest },
      'audit read',
    );
    c.header(RECORD_HASH_HEADER, row.recordHash);
    return c.json(row.record);
  };

export const verifyRoute =
  (deps: AuditApiDeps) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    const located = await locate(c, deps.reader, 'verify');
    if (!located.ok) {
      return located.response;
    }
    const { row } = located.version;
    const ctx = await buildVerifyContext(deps.reader, row);
    const result = verify(row.record, deps.ring, ctx);
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
    c.get('logger').info(
      {
        audit_id: row.id,
        record_hash: row.recordHash,
        seq: row.seq,
        latest: row.isLatest,
        valid: result.valid,
        failed,
      },
      'verify',
    );
    c.header(RECORD_HASH_HEADER, row.recordHash);
    return c.json(result);
  };
