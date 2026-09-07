import { z } from 'zod';

import { ContentCategory, SensitiveCategory } from './taxonomy.js';

const UnitInterval = z.number().min(0).max(1);

export const ClassificationMethod = z.enum(['llm', 'rules', 'cached']).meta({
  title: 'ClassificationMethod',
  description:
    'llm when the LLM classifier answered in time, rules when only the rule stage ran, cached when a recent classification of the same text was reused.',
});
export type ClassificationMethod = z.infer<typeof ClassificationMethod>;

export const Classification = z
  .object({
    commercial_intent: UnitInterval.describe('0..1 likelihood the user is in a buying context.'),
    categories: z
      .array(ContentCategory)
      .describe('Commercial categories detected, most relevant first.'),
    sensitive: z
      .array(SensitiveCategory)
      .describe('Sensitive topics detected. Any entry blocks ads under strict detection.'),
    confidence: UnitInterval.describe('0..1 classifier confidence in this result.'),
    method: ClassificationMethod,
    prompt_version: z
      .string()
      .min(1)
      .describe('Version of the classifier prompt or rule set, e.g. sha256:<hex>.'),
  })
  .meta({
    title: 'Classification',
    description:
      'What the classifier concluded about the conversation turn. Never contains message text.',
  });
export type Classification = z.infer<typeof Classification>;

/**
 * The raw JSON object the LLM classifier prompt asks the model for (packages/core
 * classify/llm/prompt.ts). Category and sensitive values are free strings here because models
 * drift in casing and invent labels; @adgateio/core lowercases them, drops anything outside
 * SENSITIVE_TAXONOMY / CATEGORIES_TAXONOMY and only then builds a Classification. Not part of
 * the HTTP contract, so it is deliberately absent from CONTRACT_SCHEMAS.
 */
export const LlmOutput = z
  .object({
    commercial_intent: UnitInterval,
    categories: z.array(z.string()),
    sensitive: z.array(z.string()),
    confidence: UnitInterval,
  })
  .meta({
    title: 'LlmOutput',
    description: 'Strict JSON the classifier model must return; normalised to Classification.',
  });
export type LlmOutput = z.infer<typeof LlmOutput>;
