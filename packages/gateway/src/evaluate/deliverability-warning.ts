import { categoryScore, creativeDeliverability } from '@adgateio/core';
import {
  type AffiliateConfig,
  type CatalogCreative,
  type Classification,
  DELIVERABILITY_REASONS,
  type DeliverabilityReason,
  type PolicyConfig,
} from '@adgateio/schemas';
import type { Logger } from 'pino';

/**
 * The no_fill warning. When mediation selects nothing AND the catalog holds creatives that DO
 * match the turn's categories but can never serve for this app (the app has no affiliate_config,
 * or their affiliate network is on no enabled entry of the policy demand list, ...), one warn
 * line says so. Without it the only evidence is `affiliate_not_configured` buried in one entry
 * of the audit record's demand trace, which is how a catalog of twelve creatives can sit at
 * zero fill and look perfectly healthy.
 *
 * Rate limited to one line per (app, reason) per process: a busy gateway would otherwise emit
 * the same sentence on every no_fill turn. The line carries the app id, the reason and how many
 * creatives it covers - never creative copy, never message text, never a category list.
 * Diagnostics must not change a turn, so warnNoFill swallows its own errors.
 */
export const NO_FILL_BLOCKED_WARNING =
  'catalog creatives matched this turn but cannot serve for this app';

export interface NoFillWarningInput {
  appId: string;
  /** The catalog the adapters were built over (active creatives only). */
  catalog: readonly CatalogCreative[];
  classification: Pick<Classification, 'categories'>;
  policy: Pick<PolicyConfig, 'demand' | 'regions' | 'blocked_categories'>;
  affiliateConfig: AffiliateConfig;
  log: Logger;
}

/**
 * How many category-matching creatives each reason blocks, in DELIVERABILITY_REASONS order.
 * A creative that does not target the turn's categories is not counted: it was never a
 * candidate for this turn and saying so would be noise, not a finding.
 */
export const blockedReasonCounts = (
  input: Pick<NoFillWarningInput, 'catalog' | 'classification' | 'policy' | 'affiliateConfig'>,
): Map<DeliverabilityReason, number> => {
  const counts = new Map<DeliverabilityReason, number>();
  for (const creative of input.catalog) {
    if (categoryScore(creative.target_categories, input.classification.categories) === 0) {
      continue;
    }
    const result = creativeDeliverability(creative, {
      policy: input.policy,
      affiliateConfig: input.affiliateConfig,
    });
    if (result.deliverable) {
      continue;
    }
    counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);
  }
  return new Map(
    DELIVERABILITY_REASONS.filter((reason) => counts.has(reason)).map((reason) => [
      reason,
      counts.get(reason) ?? 0,
    ]),
  );
};

export interface DeliverabilityWarner {
  /** At most one line per (app, reason) for the life of this warner. Never throws. */
  warnNoFill(input: NoFillWarningInput): void;
  /** Reasons already warned about, across every app. */
  readonly size: number;
  clear(): void;
}

export const createDeliverabilityWarner = (): DeliverabilityWarner => {
  const warned = new Set<string>();
  return {
    get size() {
      return warned.size;
    },
    clear() {
      warned.clear();
    },
    warnNoFill(input) {
      try {
        for (const [reason, creatives] of blockedReasonCounts(input)) {
          const key = `${input.appId}\n${reason}`;
          if (warned.has(key)) {
            continue;
          }
          warned.add(key);
          input.log.warn({ app_id: input.appId, reason, creatives }, NO_FILL_BLOCKED_WARNING);
        }
      } catch {
        // A diagnostic never changes the answer: a broken policy or catalog row is already
        // handled by the pipeline, and this must not turn it into a failed turn.
      }
    },
  };
};
