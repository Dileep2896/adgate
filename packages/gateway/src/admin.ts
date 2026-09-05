/**
 * `@adgate/gateway/admin`: the small set of WRITE operations an operator tool needs, exposed
 * as its own entry point so the dashboard can call the real thing instead of reimplementing
 * it. Registering an app mints a salt, validates and hashes the policy and issues the first
 * API key in one transaction (apps/register-app.ts); getting any of that subtly wrong in a
 * second copy is exactly the kind of drift this subpath exists to prevent.
 *
 * It is deliberately narrow: registerApp, issueApiKey and revokeApiKey, the creative editor of
 * catalog/creative-admin.ts plus the types they need, and nothing that serves traffic. Importing
 * the package root (`@adgate/gateway`) from
 * a Next.js app would drag Hono, the evaluate pipeline and the signing keys into a bundle
 * that has no use for them. Reads have their own subpath already: `@adgate/gateway/schema`
 * is the one copy of the Drizzle tables.
 *
 * Whatever calls this needs a READ-WRITE database handle. The dashboard's default handle is
 * opened read only on purpose (packages/dashboard/lib/db.ts); see lib/db-write.ts there.
 */

export {
  APP_ID_PREFIX,
  APP_SALT_BYTES,
  defaultPolicyYaml,
  registerApp,
} from './apps/register-app.js';
export type { RegisterAppInput, RegisteredApp } from './apps/register-app.js';
export { API_KEY_ID_PREFIX, issueApiKey, revokeApiKey } from './auth/repository.js';
export type { IssueApiKeyInput, IssuedApiKey, RevokeApiKeyOptions } from './auth/repository.js';
export { createCreative, setCreativeActive, updateCreative } from './catalog/creative-admin.js';
export type {
  CreativeWrite,
  CreativeWriteFailure,
  CreativeWriteResult,
} from './catalog/creative-admin.js';
export { ADVERTISER_ID_PREFIX } from './catalog/seed.js';
export type { CreativeRow } from './catalog/seed.js';
export type { Db, DbOrTx } from './db/client.js';
