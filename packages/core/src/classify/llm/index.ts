/**
 * LLM classifier stage: the LlmClassifier interface, the OpenAI compatible implementation, the
 * versioned prompt and the test fake. Public surface of packages/core/src/classify/llm.
 */
export { FakeLlmClassifier, fakeLlmFailure, fakeLlmSuccess } from './fake.js';
export type { FakeLlmMode, FakeLlmScript, LlmClassificationFields } from './fake.js';
export {
  FIXTURE_LLM_CONFIDENCE,
  fakeLlmFromFixtures,
  fixtureLlmResult,
  unknownTextLlmResult,
} from './fixtures.js';
export type { ClassifyFixtureCase, ClassifyFixtureExpect } from './fixtures.js';
export {
  CHAT_COMPLETIONS_PATH,
  OpenAiCompatibleClassifier,
  buildChatCompletionsBody,
  buildChatCompletionsUrl,
} from './openai.js';
export {
  normalizeCategories,
  normalizeSensitive,
  parseLlmContent,
  toLlmClassification,
} from './output.js';
export type { LlmContentParse } from './output.js';
export { CLASSIFIER_PROMPT, PROMPT_VERSION, computePromptVersion } from './prompt.js';
export { DEFAULT_LLM_TIMEOUT_MS, LLM_FAILURE_REASONS } from './types.js';
export type {
  LlmClassification,
  LlmClassifier,
  LlmClassifierConfig,
  LlmClassifyFailure,
  LlmClassifyOptions,
  LlmClassifyResult,
  LlmClassifySuccess,
  LlmFailureReason,
  LlmFetch,
  LlmFetchInit,
  LlmFetchResponse,
} from './types.js';
