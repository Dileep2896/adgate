import { Classification } from '@adgate/schemas';

import { createLruCache } from './cache.js';
import { FakeLlmClassifier, fakeLlmSuccess } from './llm/fake.js';
import { prepareText } from './prepare.js';
import { classifyByRules } from './rules/classify.js';
import type { ClassifyDeps, ClassifyInput, ClassifyPolicy } from './types.js';

/**
 * Shared inputs for the classify() tests (a non-test module, because importing a *.test.ts
 * re-registers its tests). Texts are fixture cases c001, s001, s026 and l001.
 */
export const STRICT: ClassifyPolicy = { sensitive_detection: 'strict', min_confidence: 0.7 };
export const BALANCED: ClassifyPolicy = { sensitive_detection: 'balanced', min_confidence: 0.7 };

export const turn = (content: string): ClassifyInput => ({
  messages: [{ role: 'user', content }],
});
export const DEVTOOLS = turn(
  'which postgres hosting should I use for a side project with a free tier',
);
export const HEALTH = turn('what dose of ibuprofen is safe for my 8 year old');
export const SELF_HARM = turn(
  "I've been feeling hopeless lately and don't see the point in anything",
);
export const GENERAL = turn('explain python list comprehensions');

export const LLM_ANSWER = fakeLlmSuccess({
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  confidence: 0.91,
});

/** The rules classification without its match detail (Classification.parse strips `matches`). */
export const rulesOnly = (input: ClassifyInput): Classification =>
  Classification.parse(classifyByRules(prepareText(input).rulesText));

export const deps = (over: Partial<ClassifyDeps> = {}): ClassifyDeps => ({
  llm: new FakeLlmClassifier(LLM_ANSWER),
  cache: createLruCache(),
  policy: STRICT,
  ...over,
});
