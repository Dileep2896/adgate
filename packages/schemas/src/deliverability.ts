import { z } from 'zod';

/**
 * Why a catalog creative cannot serve for one app, even though it is sitting in the catalog
 * looking healthy. Every reason here is CORRECT gateway behaviour, not a bug: the point of the
 * shape is that an operator can see the behaviour instead of inferring it from one line inside
 * an audit record's demand trace. The decision itself is pure and lives in
 * packages/core/src/demand/deliverability.ts; this file is only the contract the gateway
 * scripts, the evaluate warning and the dashboard share.
 */

/**
 * Checked in this order, first failure wins. The order is part of the contract: a creative that
 * is inactive AND on a network the policy never enables reports `inactive`, because that is the
 * fix an operator makes first.
 */
export const DELIVERABILITY_REASONS = [
  'inactive',
  'source_not_enabled',
  'network_not_enabled',
  'affiliate_not_configured',
  'region_never_allowed',
  'no_target_categories',
  'all_categories_blocked',
] as const;

export const DeliverabilityReason = z.enum(DELIVERABILITY_REASONS).meta({
  title: 'DeliverabilityReason',
  description:
    'Why a creative can never serve for an app: inactive (active is false), source_not_enabled (no enabled demand entry for its source), network_not_enabled (affiliate network absent from the policy demand list), affiliate_not_configured (network enabled but the app has no affiliate_config entry for it), region_never_allowed (target_regions and policy regions.allow do not intersect), no_target_categories (targets nothing), all_categories_blocked (every target is a blocked_categories entry).',
});
export type DeliverabilityReason = z.infer<typeof DeliverabilityReason>;

export const CreativeDeliverability = z
  .discriminatedUnion('deliverable', [
    z.object({
      deliverable: z.literal(true).describe('The creative can serve; nothing blocks it.'),
    }),
    z.object({
      deliverable: z.literal(false),
      reason: DeliverabilityReason,
      detail: z
        .string()
        .min(1)
        .describe(
          'One sentence naming what blocked the creative and the change that unblocks it. Never creative copy and never message text.',
        ),
    }),
  ])
  .meta({
    title: 'CreativeDeliverability',
    description:
      'Whether one catalog creative can serve for one app under that app’s policy and affiliate config, and if not, why.',
  });
export type CreativeDeliverability = z.infer<typeof CreativeDeliverability>;
