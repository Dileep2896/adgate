/**
 * `@adgate/gateway/audit`: the READ side of the audit API, exposed as its own entry point so
 * the dashboard verifies a stored record exactly the way GET /v1/verify/:id does.
 *
 * The verdict of verify() depends entirely on the context it is given - the POSITIONAL
 * predecessor at seq - 1, the content hash recomputed from the creatives row, the superseded
 * version with its own predecessor, the superseding attestation of an older version - and
 * every one of those is easy to get subtly wrong a second time. audit-api/verify-context.ts is
 * the one place that builds it, and this subpath hands it to the dashboard instead of letting
 * it grow a second copy that drifts.
 *
 * Read only: nothing here writes, so a caller may use a read-only handle (the dashboard's
 * lib/db.ts opens its pool with default_transaction_read_only). The routes themselves stay in
 * the package root with Hono; this is the loader, the context builder and their types.
 */

export type { AuditRecordRow } from './attest/store.js';
export { createAuditReader } from './audit-api/loader.js';
export type { AuditReader, AuditVersion, AuditVersionQuery } from './audit-api/loader.js';
export { buildVerifyContext, creativeIdOf, supersedesHashOf } from './audit-api/verify-context.js';
export type { Db, DbOrTx } from './db/client.js';
