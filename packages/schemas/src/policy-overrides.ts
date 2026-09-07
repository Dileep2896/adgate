import { z } from 'zod';

import {
  AdvertiserDomain,
  AffiliateNetwork,
  DisclosureLabel,
  DisclosurePosition,
  DisclosureStyle,
  PolicyCap,
  PolicyRegion,
  PolicyRetainDays,
  PolicyThreshold,
  PolicyTier,
  SensitiveDetection,
} from './policy-parts.js';
import { SensitiveCategory } from './taxonomy.js';

/**
 * PolicyOverrides is the deep-partial PolicyConfig an app may send as
 * EvaluateRequest.policy_overrides. It validates shape only; whether each value tightens or
 * loosens the stored policy is decided by mergeOverrides in @adgateio/core, which ignores loosening
 * values and reports them as OverrideRejection entries.
 *
 * No field here carries a default on purpose: a default would look like a value the caller sent.
 */

const enabled = z.boolean().optional();

export const DemandEntryOverride = z
  .discriminatedUnion('source', [
    z.strictObject({ source: z.literal('direct'), enabled }),
    z.strictObject({
      source: z.literal('affiliate'),
      network: AffiliateNetwork.optional().describe('When omitted, every affiliate entry matches.'),
      enabled,
    }),
    z.strictObject({ source: z.literal('koah'), enabled }),
    z.strictObject({ source: z.literal('gravity'), enabled }),
  ])
  .meta({ title: 'DemandEntryOverride' });
export type DemandEntryOverride = z.infer<typeof DemandEntryOverride>;

export const PolicyOverrides = z
  .strictObject({
    version: z.literal(1).optional(),
    app_id: z.string().min(1).optional(),
    serve_to_tiers: z.array(PolicyTier).optional(),
    allow_paid_tiers: z.boolean().optional(),
    blocked_categories: z.array(SensitiveCategory).optional(),
    sensitive_detection: SensitiveDetection.optional(),
    min_commercial_intent: PolicyThreshold.optional(),
    min_confidence: PolicyThreshold.optional(),
    competitor_exclusions: z.array(AdvertiserDomain).optional(),
    frequency_caps: z
      .strictObject({
        per_session: PolicyCap.optional(),
        per_user_per_day: PolicyCap.optional(),
        min_turns_between: PolicyCap.optional(),
      })
      .optional(),
    disclosure: z
      .strictObject({
        label: DisclosureLabel.optional(),
        position: DisclosurePosition.optional(),
        style: DisclosureStyle.optional(),
      })
      .optional(),
    demand: z.array(DemandEntryOverride).optional(),
    privacy: z
      .strictObject({
        store_raw_text: z.boolean().optional(),
        retain_days: PolicyRetainDays.optional(),
      })
      .optional(),
    regions: z.strictObject({ allow: z.array(PolicyRegion).optional() }).optional(),
  })
  .meta({
    title: 'PolicyOverrides',
    description:
      'Deep-partial PolicyConfig sent as EvaluateRequest.policy_overrides. Only values that make the stored policy stricter are applied; the rest are ignored and recorded as override_rejected.',
  });
export type PolicyOverrides = z.infer<typeof PolicyOverrides>;

export const OverrideRejection = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .describe(
        'Dotted path of the ignored override, e.g. frequency_caps.per_session or demand[1].',
      ),
    reason: z.string().min(1),
  })
  .meta({
    title: 'OverrideRejection',
    description:
      'A policy_overrides value that would have loosened the stored policy and was ignored.',
  });
export type OverrideRejection = z.infer<typeof OverrideRejection>;
