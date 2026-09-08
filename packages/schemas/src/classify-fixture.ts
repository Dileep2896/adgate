import { z } from 'zod';

import { MessageRole } from './common.js';
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

/**
 * One turn of a multi-turn case, restricted to the two roles prepareText() classifies: a system
 * prompt belongs to the app and tool output is machine text, so neither reaches the classifier
 * and neither belongs in a fixture.
 */
export const ClassifyFixtureMessage = z.object({
  role: MessageRole.extract(['user', 'assistant']),
  content: z.string().min(1),
});
export type ClassifyFixtureMessage = z.infer<typeof ClassifyFixtureMessage>;

/** The content of the last message with role 'user', or undefined when there is none. */
const lastUserContent = (messages: readonly ClassifyFixtureMessage[]): string | undefined =>
  [...messages].reverse().find((message) => message.role === 'user')?.content;

/**
 * `text` is always present and is always the user turn the case is about. `messages` is the
 * optional conversation it arrived in, oldest first, for cases whose classification only makes
 * sense across turns (a product question after a debugging exchange; a shopping question whose
 * sensitive context was established two turns earlier). The invariant, enforced here so it
 * cannot rot: when `messages` is present, `text` equals the content of its last user turn. That
 * keeps every consumer that only knows about `text` working unchanged, and lets a case end on
 * an assistant turn, which is what real traffic looks like when the gateway is called after the
 * answer. Use fixtureMessages() to get the turns to classify, never `text` alone.
 */
export const ClassifyFixtureCase = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    messages: z.array(ClassifyFixtureMessage).min(2).optional(),
    expect: ClassifyFixtureExpect,
    note: z.string().optional(),
  })
  .refine((c) => c.messages === undefined || lastUserContent(c.messages) === c.text, {
    message: 'text must be the content of the last user message in messages',
    path: ['text'],
  });
export type ClassifyFixtureCase = z.infer<typeof ClassifyFixtureCase>;

/**
 * The turns a case is classified as: its own `messages`, or the single user turn `text` stands
 * for. Every consumer that feeds a case to classify(), to prepareText() or to the rules stage
 * goes through this, so a single-turn and a multi-turn case are driven the same way.
 */
export const fixtureMessages = (c: ClassifyFixtureCase): ClassifyFixtureMessage[] =>
  c.messages ?? [{ role: 'user', content: c.text }];

export const ClassifyFixture = z.object({
  version: z.number().int().min(1),
  notes: z.string().optional(),
  categories_taxonomy: z.array(z.string().min(1)),
  sensitive_taxonomy: z.array(z.string().min(1)),
  cases: z.array(ClassifyFixtureCase).min(1),
});
export type ClassifyFixture = z.infer<typeof ClassifyFixture>;
