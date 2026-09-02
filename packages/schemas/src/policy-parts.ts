import { z } from 'zod';

/**
 * Leaf schemas shared by PolicyConfig (policy.ts) and PolicyOverrides (policy-overrides.ts).
 * They carry validation only, never defaults: overrides must not be back-filled with defaults,
 * otherwise a partial override would silently "change" fields the caller never sent.
 */

export const PolicyTier = z
  .string()
  .min(1)
  .meta({ title: 'PolicyTier', description: 'A user tier name, e.g. free or paid.' });
export type PolicyTier = z.infer<typeof PolicyTier>;

/** ISO 3166-1 alpha-2 country code, or the token EU (docs/policy.md regions.allow). */
export const PolicyRegion = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .meta({
    title: 'PolicyRegion',
    description: 'ISO 3166-1 alpha-2 country code, or the token EU.',
  });
export type PolicyRegion = z.infer<typeof PolicyRegion>;

export const PolicyThreshold = z
  .number()
  .min(0)
  .max(1)
  .meta({ title: 'PolicyThreshold', description: 'A score threshold between 0 and 1.' });
export type PolicyThreshold = z.infer<typeof PolicyThreshold>;

export const PolicyCap = z
  .number()
  .int()
  .min(0)
  .meta({ title: 'PolicyCap', description: 'A frequency cap: a non-negative integer.' });
export type PolicyCap = z.infer<typeof PolicyCap>;

export const PolicyRetainDays = z
  .number()
  .int()
  .min(1)
  .meta({ title: 'PolicyRetainDays', description: 'Retention window in days, at least 1.' });
export type PolicyRetainDays = z.infer<typeof PolicyRetainDays>;

export const AdvertiserDomain = z.string().min(1).meta({
  title: 'AdvertiserDomain',
  description: 'An advertiser domain that must never be shown, e.g. competitor.com.',
});
export type AdvertiserDomain = z.infer<typeof AdvertiserDomain>;

export const SensitiveDetection = z.enum(['strict', 'balanced']).meta({
  title: 'SensitiveDetection',
  description: 'strict suppresses on any sensitive signal from rules OR the LLM.',
});
export type SensitiveDetection = z.infer<typeof SensitiveDetection>;

export const DisclosureLabel = z.string().min(1).meta({
  title: 'DisclosureLabel',
  description: 'Label rendered on the sponsored block. Must be non-empty.',
});
export type DisclosureLabel = z.infer<typeof DisclosureLabel>;

export const DisclosurePosition = z.literal('after_answer').meta({
  title: 'DisclosurePosition',
  description: 'Only after_answer exists in v1.',
});
export type DisclosurePosition = z.infer<typeof DisclosurePosition>;

export const DisclosureStyle = z.literal('separate_block').meta({
  title: 'DisclosureStyle',
  description: 'Only separate_block exists in v1.',
});
export type DisclosureStyle = z.infer<typeof DisclosureStyle>;

export const AffiliateNetwork = z.enum(['partnerstack', 'impact', 'amazon']).meta({
  title: 'AffiliateNetwork',
  description: 'Affiliate network used by an affiliate demand entry.',
});
export type AffiliateNetwork = z.infer<typeof AffiliateNetwork>;
