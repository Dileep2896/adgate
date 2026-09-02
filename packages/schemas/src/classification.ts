import { z } from 'zod';

import { ContentCategory, SensitiveCategory } from './taxonomy.js';

const UnitInterval = z.number().min(0).max(1);

export const ClassificationMethod = z.enum(['llm', 'rules']).meta({
  title: 'ClassificationMethod',
  description: 'llm when the LLM classifier answered in time, rules when only the rule stage ran.',
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
