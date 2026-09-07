/**
 * `@adgateio/gateway/admin`: the small set of WRITE operations an operator tool needs, exposed
 * as its own entry point so the dashboard can call the real thing instead of reimplementing
 * it. Registering an app mints a salt, validates and hashes the policy and issues the first
 * API key in one transaction (apps/register-app.ts); getting any of that subtly wrong in a
 * second copy is exactly the kind of drift this subpath exists to prevent.
 *
 * It is deliberately narrow: registerApp, issueApiKey and revokeApiKey, the creative editor of
 * catalog/creative-admin.ts, setAffiliateConfig (the ONLY writer of apps.affiliate_config
 * anywhere), the catalog readiness diagnostic of catalog/readiness.ts - so the dashboard reports
 * a blocked creative in the same words `check-catalog` prints rather than a second wording of
 * its own - the dashboard ACCOUNT logic of accounts/*.ts, plus the types they
 * need, and nothing that serves traffic. Importing
 * the package root (`@adgateio/gateway`) from
 * a Next.js app would drag Hono, the evaluate pipeline and the signing keys into a bundle
 * that has no use for them. Reads have their own subpath already: `@adgateio/gateway/schema`
 * is the one copy of the Drizzle tables.
 *
 * The accounts live here rather than in packages/dashboard for the same reason registerApp
 * does: they are writes with rules (normalization, argon2id, one address per account, an
 * enumeration-safe failure), and a rule that only a Next.js server action can reach is a rule
 * no test can exercise without a browser.
 *
 * Whatever calls this needs a READ-WRITE database handle. The dashboard's default handle is
 * opened read only on purpose (packages/dashboard/lib/db.ts); see lib/db-write.ts there.
 */

export {
  EMAIL_TAKEN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_EMAIL_MESSAGE,
  isValidEmail,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordIssues,
  USER_ID_PREFIX,
} from './accounts/credentials.js';
export {
  authenticateUser,
  changeUserPassword,
  findUserByEmail,
  findUserById,
  listUsers,
  registerUser,
  touchUserLogin,
} from './accounts/users.js';
export type {
  AccountUser,
  AuthenticateUserInput,
  AuthenticateUserResult,
  ChangePasswordResult,
  RegisterUserFailure,
  RegisterUserInput,
  RegisterUserResult,
  UserRole,
  UserRow,
} from './accounts/users.js';
export { setAffiliateConfig } from './apps/affiliate-config.js';
export type { AffiliateConfigFailure, SetAffiliateConfigResult } from './apps/affiliate-config.js';
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
export { appReadiness, blockedLines, groupBlocked, readinessLines } from './catalog/readiness.js';
export type {
  AppReadiness,
  BlockedGroup,
  CatalogApp,
  ReadinessCreative,
  ReadinessRow,
} from './catalog/readiness.js';
export { ADVERTISER_ID_PREFIX } from './catalog/seed.js';
export type { CreativeRow } from './catalog/seed.js';
export type { Db, DbOrTx } from './db/client.js';
