import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { createClient } from '../client.js';
import { API_KEY, BASE_URL, routedFetch, type FakeFetch } from '../test-support.js';
import type { AdgateClient } from '../types.js';
import { ADGATE_METADATA_KEY, type AdgateProviderMetadata } from './middleware.js';

/**
 * Fakes for the `@adgate/sdk/ai` tests. No network and no model provider: the language model is
 * the AI SDK's own MockLanguageModelV4 and the gateway is the core test-support routedFetch.
 */
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>;
type CallParams = Parameters<WrapGenerate>[0]['params'];
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type StreamResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware['wrapStream']>>>;
export type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;
/** Named here because the provider package it comes from is not a direct dependency (TS2742). */
type WrappedModel = ReturnType<typeof wrapLanguageModel>;

/** A fully populated usage record: the provider spec has no defaults for it. */
export const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 7, text: 7, reasoning: undefined },
} as const;

export const FINISH_REASON = { unified: 'stop', raw: 'stop' } as const;

export const ANSWER = 'Use a managed Postgres with a free tier while the project is small.';

/** A doGenerate result whose text content parts join to `text`. */
export const generateResult = (texts: string[]): GenerateResult => ({
  content: texts.map((text) => ({ type: 'text' as const, text })),
  finishReason: FINISH_REASON,
  usage: USAGE,
  warnings: [],
});

/** The chunks a streaming model emits for `texts`, ending with the terminal finish part. */
export const streamScript = (texts: string[]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  ...texts.map((text) => ({ type: 'text-delta' as const, id: 't1', delta: text })),
  { type: 'text-end', id: 't1' },
  { type: 'finish', usage: USAGE, finishReason: FINISH_REASON },
];

/** A non-streaming model that answers with `texts`, wrapped in the middleware under test. */
export const wrapGenerating = (
  middleware: LanguageModelMiddleware,
  texts: string[] = [ANSWER],
): WrappedModel =>
  wrapLanguageModel({
    model: new MockLanguageModelV4({ doGenerate: generateResult(texts) }),
    middleware,
  });

export const callParams = (prompt: CallParams['prompt']): CallParams => ({ prompt });

/** A prompt whose only user text is `text`. */
export const userPrompt = (text: string): CallParams['prompt'] => [
  { role: 'user', content: [{ type: 'text', text }] },
];

/** A client wired to a fake gateway. `routes` overrides the /v1/evaluate and /v1/attest answers. */
export const fakeClient = (
  routes?: Parameters<typeof routedFetch>[0],
): { client: AdgateClient; transport: FakeFetch } => {
  const transport = routedFetch(routes);
  return {
    client: createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: transport.fetch }),
    transport,
  };
};

/** What the middleware attached, read off a generate result or a stream part. */
export const adgateMetadataOf = (value: unknown): AdgateProviderMetadata | undefined => {
  const metadata = (value as { providerMetadata?: Record<string, unknown> } | null | undefined)
    ?.providerMetadata;
  return metadata?.[ADGATE_METADATA_KEY] as AdgateProviderMetadata | undefined;
};

/** Reads a whole stream into an array, the way a consumer of the wrapped model would. */
export const collect = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const parts: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return parts;
    }
    parts.push(value);
  }
};
