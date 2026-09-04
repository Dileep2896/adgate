import type { wrapLanguageModel } from 'ai';

/**
 * A tiny offline language model, so the example runs with no API key and no network.
 *
 * It implements the same provider interface a real provider package implements (spec v4), which
 * is the point: `wrapLanguageModel({ model, middleware: adgateMiddleware(...) })` is byte for
 * byte the same wiring whether `model` is this mock or `openai('gpt-4o-mini')`. It streams one
 * of three canned answers, picked by keyword from the last user message, with a small delay per
 * chunk so streaming is actually visible in the UI.
 *
 * lib/model.ts picks the real provider when OPENAI_API_KEY is set and this one otherwise.
 */

/** Every AI SDK type is derived from the `ai` package, never re-declared (CLAUDE.md: no duplicates). */
type ModelArgument = Parameters<typeof wrapLanguageModel>[0]['model'];
export type LanguageModelV4 = Extract<ModelArgument, { specificationVersion: 'v4' }>;
type CallOptions = Parameters<LanguageModelV4['doGenerate']>[0];
type GenerateResult = Awaited<ReturnType<LanguageModelV4['doGenerate']>>;
type StreamResult = Awaited<ReturnType<LanguageModelV4['doStream']>>;
type StreamPart =
  StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never;

export const MOCK_PROVIDER = 'adgate-example';
export const MOCK_MODEL_ID = 'offline-canned';

/** Milliseconds between streamed chunks. Long enough to see the answer arrive word by word. */
export const MOCK_CHUNK_DELAY_MS = 35;

export const DEVTOOLS_ANSWER =
  'For a side project, start with a managed Postgres on a free tier: you get backups, ' +
  'connection pooling and a connection string in about a minute, and nothing to patch. ' +
  'Keep migrations in version control from day one, and only move to a self-hosted instance ' +
  'when the free tier stops fitting.';

export const HEALTH_ANSWER =
  'I am not able to give medical advice. Symptoms like these are worth describing to a ' +
  'clinician, who can ask the follow-up questions that actually narrow it down. If it came on ' +
  'suddenly or is getting worse, treat that as a reason to be seen sooner rather than later.';

export const GENERIC_ANSWER =
  'Here is the short version: write down the constraint that actually matters, pick the ' +
  'simplest option that satisfies it, and keep the decision reversible. Most of the time the ' +
  'boring choice is the one you will still be happy with in six months.';

const DEVTOOLS_KEYWORDS = [
  'postgres',
  'postgresql',
  'database',
  'db',
  'sql',
  'supabase',
  'neon',
  'hosting',
  'deploy',
  'devtools',
];

/**
 * Deliberately overlapping with the gateway's own health keyword list
 * (packages/core/src/classify/rules/data/sensitive/health.ts), so the canned answer and the
 * `sensitive_category:health` suppression line up in the demo.
 */
const HEALTH_KEYWORDS = [
  'health',
  'doctor',
  'clinic',
  'symptom',
  'symptoms',
  'headache',
  'migraine',
  'fever',
  'medical',
  'medication',
  'therapy',
  'diagnosis',
  'pain',
];

const hasKeyword = (text: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`, 'u').test(text));

/** The concatenated text of the last user message, lower-cased. */
export const lastUserText = (prompt: CallOptions['prompt']): string => {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (message === undefined || message.role !== 'user') {
      continue;
    }
    return message.content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .toLowerCase();
  }
  return '';
};

/** Which canned answer this question gets. Exported so the tests can pin the routing. */
export const answerFor = (prompt: CallOptions['prompt']): string => {
  const text = lastUserText(prompt);
  if (hasKeyword(text, HEALTH_KEYWORDS)) {
    return HEALTH_ANSWER;
  }
  if (hasKeyword(text, DEVTOOLS_KEYWORDS)) {
    return DEVTOOLS_ANSWER;
  }
  return GENERIC_ANSWER;
};

/** Words plus their trailing space, so joining the chunks reproduces the answer exactly. */
export const chunksOf = (answer: string): string[] =>
  answer.split(' ').map((word, index, all) => (index === all.length - 1 ? word : `${word} `));

const usageFor = (answer: string): GenerateResult['usage'] => ({
  inputTokens: { total: 16, noCache: 16, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: chunksOf(answer).length, text: chunksOf(answer).length, reasoning: undefined },
});

const FINISH_REASON: GenerateResult['finishReason'] = { unified: 'stop', raw: 'stop' };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const streamOf = (answer: string, delayMs: number): ReadableStream<StreamPart> => {
  const chunks = chunksOf(answer);
  return new ReadableStream<StreamPart>({
    async start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 'text-1' });
      for (const chunk of chunks) {
        await sleep(delayMs);
        controller.enqueue({ type: 'text-delta', id: 'text-1', delta: chunk });
      }
      controller.enqueue({ type: 'text-end', id: 'text-1' });
      controller.enqueue({
        type: 'finish',
        usage: usageFor(answer),
        finishReason: FINISH_REASON,
      });
      controller.close();
    },
  });
};

export type MockModelOptions = {
  /** Milliseconds between streamed chunks. 0 makes the stream instant (used by the tests). */
  chunkDelayMs?: number;
};

/**
 * The offline model. Nothing here is adgate-specific: it exists only so that the example has
 * something to wrap when no provider API key is configured.
 */
export const createMockModel = (options: MockModelOptions = {}): LanguageModelV4 => {
  const delayMs = options.chunkDelayMs ?? MOCK_CHUNK_DELAY_MS;
  return {
    specificationVersion: 'v4',
    provider: MOCK_PROVIDER,
    modelId: MOCK_MODEL_ID,
    supportedUrls: {},
    doGenerate: async ({ prompt }) => {
      const answer = answerFor(prompt);
      await sleep(delayMs);
      return {
        content: [{ type: 'text', text: answer }],
        finishReason: FINISH_REASON,
        usage: usageFor(answer),
        warnings: [],
      };
    },
    doStream: ({ prompt }) =>
      Promise.resolve({ stream: streamOf(answerFor(prompt), delayMs) }),
  };
};
