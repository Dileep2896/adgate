import { createOpenAI } from '@ai-sdk/openai';

import { createMockModel, type LanguageModelV4 } from './mock-model';

/**
 * Which language model the chat route wraps.
 *
 * - OPENAI_API_KEY set: a real OpenAI-compatible endpoint (OPENAI_BASE_URL for anything that
 *   speaks the same protocol: Ollama, vLLM, OpenRouter, Azure ...).
 * - otherwise: the offline mock in mock-model.ts, so `pnpm --filter nextjs-chat dev` works with
 *   no API key at all. adgate's wiring is identical either way; that is the whole point of the
 *   middleware sitting between the app and the provider.
 */

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export type ModelChoice = { model: LanguageModelV4; mode: 'openai' | 'mock'; label: string };

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
};

/** Resolved per request, not at module load, so `next build` never needs an API key. */
export const selectModel = (env: NodeJS.ProcessEnv = process.env): ModelChoice => {
  const apiKey = trimmed(env.OPENAI_API_KEY);
  if (apiKey === undefined) {
    const mock = createMockModel();
    return { model: mock, mode: 'mock', label: `${mock.provider}:${mock.modelId}` };
  }
  const baseURL = trimmed(env.OPENAI_BASE_URL);
  const modelId = trimmed(env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL;
  const openai = createOpenAI(baseURL === undefined ? { apiKey } : { apiKey, baseURL });
  return { model: openai(modelId), mode: 'openai', label: `openai:${modelId}` };
};
