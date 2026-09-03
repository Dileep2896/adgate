import { z } from 'zod';

import { ContentCategory, SensitiveCategory } from './taxonomy.js';

/**
 * Shape of fixtures/classify-fixtures.json, the classifier's golden set. The file is test data
 * shared by several packages (core's rules and orchestrator tests, the fixture-seeded fake LLM,
 * the Python SDK), so it is parsed with this one schema instead of being cast per test file.
 * Not a wire contract: not in CONTRACT_SCHEMAS, no JSON Schema file.
 */
export const ClassifyFixtureExpect = z.object({
  sensitive: z.array(SensitiveCategory),
  categories_any: z.array(ContentCategory).optional(),
  intent_min: z.number().min(0).max(1).optional(),
  intent_max: z.number().min(0).max(1).optional(),
});
export type ClassifyFixtureExpect = z.infer<typeof ClassifyFixtureExpect>;

export const ClassifyFixtureCase = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  expect: ClassifyFixtureExpect,
  note: z.string().optional(),
});
export type ClassifyFixtureCase = z.infer<typeof ClassifyFixtureCase>;

export const ClassifyFixture = z.object({
  version: z.number().int().min(1),
  notes: z.string().optional(),
  categories_taxonomy: z.array(z.string().min(1)),
  sensitive_taxonomy: z.array(z.string().min(1)),
  cases: z.array(ClassifyFixtureCase).min(1),
});
export type ClassifyFixture = z.infer<typeof ClassifyFixture>;
