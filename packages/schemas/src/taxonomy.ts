import { z } from 'zod';

/**
 * Classification taxonomies. These MUST stay identical to `sensitive_taxonomy` and
 * `categories_taxonomy` in fixtures/classify-fixtures.json (taxonomy.test.ts enforces it).
 * They are duplicated here because a published package cannot read the fixture at runtime.
 */
export const SENSITIVE_TAXONOMY = [
  'health',
  'finance',
  'politics',
  'legal',
  'adult',
  'gambling',
  'weapons',
  'religion',
  'self_harm',
] as const;

export const CATEGORIES_TAXONOMY = [
  'software.devtools.database',
  'software.devtools.hosting',
  'software.devtools.ci',
  'software.devtools.observability',
  'software.devtools.ai',
  'software.security',
  'software.productivity',
  'shopping.electronics',
  'shopping.home',
  'shopping.sportswear',
  'shopping.pets',
  'travel.flights',
  'travel.hotels',
  'travel.connectivity',
  'education.language',
  'education.courses',
  'entertainment.streaming',
  'food.delivery',
  'general',
] as const;

export const SensitiveCategory = z.enum(SENSITIVE_TAXONOMY).meta({
  title: 'SensitiveCategory',
  description: 'A sensitive topic that blocks ads. Matches fixtures/classify-fixtures.json.',
});
export type SensitiveCategory = z.infer<typeof SensitiveCategory>;

export const ContentCategory = z.enum(CATEGORIES_TAXONOMY).meta({
  title: 'ContentCategory',
  description: 'A commercial content category. Matches fixtures/classify-fixtures.json.',
});
export type ContentCategory = z.infer<typeof ContentCategory>;
