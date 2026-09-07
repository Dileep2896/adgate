import type { DeliverabilityReason } from '@adgate/schemas';

/**
 * WHERE ON THIS SCREEN THE FIX IS MADE. The `detail` sentence @adgate/core produces already names
 * the change ("add an affiliate entry for impact to the app's policy demand list"); it does not
 * know that the app's page has a Policy editor and an Affiliate accounts form right below the
 * line reporting it. This is the pointer, and nothing more - the sentence itself is never
 * rewritten, because an operator reading `check-catalog` and an operator reading the dashboard
 * have to be reading the same words.
 *
 * Type-only import, so this module ships no zod and a client component could hold it safely.
 */

/** Named sections of /apps/[id], as their headings read. */
export const FIX_HERE: Record<DeliverabilityReason, string | null> = {
  // Reactivating happens on the creative, not on the app.
  inactive: null,
  source_not_enabled: 'Policy',
  network_not_enabled: 'Policy',
  affiliate_not_configured: 'Affiliate accounts',
  region_never_allowed: 'Policy',
  // Both of these are edits to the creative itself.
  no_target_categories: null,
  all_categories_blocked: 'Policy',
};

/**
 * "Fix it under Affiliate accounts below." for a reason this page can fix, or null for one that
 * belongs to a creative. Kept as one sentence so a caller never assembles copy out of fragments.
 */
export const fixLocationSentence = (reason: DeliverabilityReason | null): string | null => {
  if (reason === null) {
    return null;
  }
  const section = FIX_HERE[reason];
  return section === null ? null : `Fix it under ${section} below.`;
};

/**
 * The count line the creatives list and the app page share: never "2/3", always words, and never
 * shown at all when there is only one app to judge against (a private creative has exactly one,
 * and "blocked for 1 of 1 apps" is noise).
 */
export const blockedForApps = (blocked: number, judged: number): string | null =>
  judged <= 1 ? null : `blocked for ${String(blocked)} of ${String(judged)} apps`;
