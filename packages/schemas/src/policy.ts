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
import { SENSITIVE_TAXONOMY, SensitiveCategory } from './taxonomy.js';

/**
 * PolicyConfig implements docs/policy.md: every default is the value shown in the
 * "Full example with defaults" block, unknown keys are rejected at every level, self_harm can
 * never leave blocked_categories and non-free tiers require allow_paid_tiers: true.
 */

export const FrequencyCaps = z
  .strictObject({
    per_session: PolicyCap.default(1).describe('Per conversation.'),
    per_user_per_day: PolicyCap.default(3).describe(
      'Requires user.user_hash; if absent, per_session applies only.',
    ),
    min_turns_between: PolicyCap.default(4).describe('Turns that must pass between two ads.'),
  })
  .meta({ title: 'FrequencyCaps' });
export type FrequencyCaps = z.infer<typeof FrequencyCaps>;

export const Disclosure = z
  .strictObject({
    label: DisclosureLabel.default('Sponsored'),
    position: DisclosurePosition.default('after_answer'),
    style: DisclosureStyle.default('separate_block'),
  })
  .meta({ title: 'Disclosure', description: 'How the sponsored block is labeled and placed.' });
export type Disclosure = z.infer<typeof Disclosure>;

export const Privacy = z
  .strictObject({
    store_raw_text: z
      .boolean()
      .default(false)
      .describe('When false, only hashes and classification are persisted.'),
    retain_days: PolicyRetainDays.default(90),
  })
  .meta({ title: 'Privacy' });
export type Privacy = z.infer<typeof Privacy>;

export const Regions = z
  .strictObject({
    allow: z.array(PolicyRegion).default(() => ['US', 'CA', 'GB', 'EU']),
  })
  .meta({ title: 'Regions', description: 'Regions in which ads may be served.' });
export type Regions = z.infer<typeof Regions>;

const enabled = z.boolean().default(true).describe('Only enabled sources are queried.');

/** One entry of the ordered demand list, discriminated on source (docs/policy.md demand). */
export const DemandEntry = z
  .discriminatedUnion('source', [
    z.strictObject({ source: z.literal('direct'), enabled }),
    z.strictObject({ source: z.literal('affiliate'), network: AffiliateNetwork, enabled }),
    z.strictObject({ source: z.literal('koah'), enabled }),
    z.strictObject({ source: z.literal('gravity'), enabled }),
  ])
  .meta({ title: 'DemandEntry' });
export type DemandEntry = z.infer<typeof DemandEntry>;

export const PolicyConfig = z
  .strictObject({
    version: z.literal(1).default(1).describe('Policy schema version. Only 1 exists.'),
    app_id: z.string().min(1).describe('The app this policy belongs to.'),
    serve_to_tiers: z
      .array(PolicyTier)
      .default(() => ['free'])
      .describe('Tiers that may see ads. Any other tier is suppressed with reason paid_user.'),
    allow_paid_tiers: z
      .boolean()
      .default(false)
      .describe('Must be explicitly true to include non-free tiers in serve_to_tiers.'),
    blocked_categories: z
      .array(SensitiveCategory)
      .default(() => [...SENSITIVE_TAXONOMY])
      .meta({
        description: 'Sensitive categories that suppress ads. self_harm cannot be removed.',
        // The self_harm refinement below, expressed for JSON Schema consumers.
        contains: { const: 'self_harm' },
      }),
    sensitive_detection: SensitiveDetection.default('strict'),
    min_commercial_intent: PolicyThreshold.default(0.6),
    min_confidence: PolicyThreshold.default(0.7),
    competitor_exclusions: z.array(AdvertiserDomain).default(() => []),
    frequency_caps: FrequencyCaps.default(() => FrequencyCaps.parse({})),
    disclosure: Disclosure.default(() => Disclosure.parse({})),
    demand: z
      .array(DemandEntry)
      .default((): DemandEntry[] => [
        { source: 'direct', enabled: true },
        { source: 'affiliate', network: 'partnerstack', enabled: true },
        { source: 'koah', enabled: false },
        { source: 'gravity', enabled: false },
      ])
      .describe('Ordered list; only enabled sources are queried.'),
    privacy: Privacy.default(() => Privacy.parse({})),
    regions: Regions.default(() => Regions.parse({})),
  })
  .superRefine((policy, ctx) => {
    if (!policy.blocked_categories.includes('self_harm')) {
      ctx.addIssue({
        code: 'custom',
        path: ['blocked_categories'],
        message: 'self_harm cannot be removed from blocked_categories',
      });
    }
    const nonFree = policy.serve_to_tiers.filter((tier) => tier !== 'free');
    if (nonFree.length > 0 && !policy.allow_paid_tiers) {
      ctx.addIssue({
        code: 'custom',
        path: ['serve_to_tiers'],
        message: `serve_to_tiers includes non-free tiers (${nonFree.join(', ')}); set allow_paid_tiers: true to allow this`,
      });
    }
  })
  .meta({
    title: 'PolicyConfig',
    description:
      'An app policy (docs/policy.md). Omitted fields take the documented defaults; unknown keys are rejected.',
    // The allow_paid_tiers refinement above, expressed for JSON Schema consumers.
    allOf: [
      {
        if: { properties: { allow_paid_tiers: { const: true } }, required: ['allow_paid_tiers'] },
        else: { properties: { serve_to_tiers: { items: { const: 'free' } } } },
      },
    ],
  });
export type PolicyConfig = z.infer<typeof PolicyConfig>;
/** What a policy author may write: every defaulted field is optional. */
export type PolicyConfigInput = z.input<typeof PolicyConfig>;
