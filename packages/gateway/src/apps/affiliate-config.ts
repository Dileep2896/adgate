import { AffiliateConfig } from '@adgate/schemas';
import { eq } from 'drizzle-orm';

import type { DbOrTx } from '../db/client.js';
import { apps } from '../db/tables/apps.js';

/**
 * Storing an app's own affiliate identifiers (`apps.affiliate_config`).
 *
 * WHOSE ACCOUNTS THESE ARE. docs/decisions.md item 6: affiliate links credit the APP OWNER's own
 * affiliate accounts, and adgate holds only the PUBLIC identifiers that already appear in a
 * tracked link - a PartnerStack program id, an impact.com program and campaign id, an Amazon
 * Associates tag. Never an API key, never a payout detail, never a login. That is what makes this
 * column safe to render back to the person who typed it, unlike an API key.
 *
 * It is validated with the contract schema before it is written, so the request path never has to
 * (evaluate/adapters.ts affiliateConfigOf parses defensively and degrades to `{}` on a bad row,
 * but a row this function wrote can always be parsed).
 *
 * AN EMPTY CONFIG IS STORED AS NULL. `{}` and NULL mean the same thing to the adapters - no
 * network is configured - and collapsing them means "cleared" has one representation in the
 * database instead of two.
 */

export type AffiliateConfigFailure = 'app_not_found' | 'invalid_config';

export type SetAffiliateConfigResult =
  | { ok: true; config: AffiliateConfig | null }
  | { ok: false; error: AffiliateConfigFailure; issues: string[] };

/** Zod issues as `path: message` lines. The VALUE is never included: an id is the owner's data. */
const issueLines = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string[] =>
  issues.map(
    (issue) => `${issue.path.map(String).join('.') || 'affiliate_config'}: ${issue.message}`,
  );

/** True when no network carries an entry, in which case the column is cleared. */
const isEmpty = (config: AffiliateConfig): boolean => Object.keys(config).length === 0;

/**
 * Replaces one app's affiliate configuration. Returns a tagged failure instead of throwing for
 * anything the caller could have got wrong, so a form renders a sentence rather than a stack
 * trace; a database error still throws, because that is not the caller's mistake.
 */
export const setAffiliateConfig = async (
  db: DbOrTx,
  appId: string,
  config: unknown,
): Promise<SetAffiliateConfigResult> => {
  const parsed = AffiliateConfig.safeParse(config ?? {});
  if (!parsed.success) {
    return { ok: false, error: 'invalid_config', issues: issueLines(parsed.error.issues) };
  }
  const stored = isEmpty(parsed.data) ? null : parsed.data;
  const rows = await db
    .update(apps)
    .set({ affiliateConfig: stored, updatedAt: new Date() })
    .where(eq(apps.id, appId))
    .returning({ id: apps.id });
  return rows.length === 0
    ? { ok: false, error: 'app_not_found', issues: [] }
    : { ok: true, config: stored };
};
