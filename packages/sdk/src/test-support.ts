import type { EvaluateRequest, FetchInit, FetchLike, FetchResponseLike } from './types.js';

/**
 * Fakes shared by the SDK tests. Nothing here touches the network: every client is built with
 * an injected fetch that records what it was called with and answers from a script.
 */
export const API_KEY = 'ak_testprefix_' + 'x'.repeat(43);
export const BASE_URL = 'https://gateway.example.test';
export const AUDIT_ID = 'aud_01J0000000000000000000TEST';

export const REQUEST: EvaluateRequest = {
  app_id: 'app_01J0000000000000000000TEST',
  conversation_id: 'conv_1',
  turn_id: 'turn_1',
  user: { tier: 'free', region: 'US' },
  messages: [{ role: 'user', content: 'which postgres hosting should I use for a side project' }],
  surface: { type: 'chat', placement: 'after_answer', max_creatives: 1 },
};

export const SERVE_BODY = {
  decision: 'serve',
  reason: null,
  classification: {
    commercial_intent: 0.84,
    categories: ['software.devtools.database'],
    sensitive: [],
    confidence: 0.91,
    method: 'llm',
    prompt_version: `sha256:${'a'.repeat(64)}`,
  },
  creative: {
    id: 'cr_01J0000000000000000000TEST',
    advertiser: 'Example DB Cloud',
    headline: 'Managed Postgres with a free tier',
    body: 'Spin up a database in 30 seconds.',
    cta: 'Try it free',
    url: `${BASE_URL}/c/${AUDIT_ID}`,
    source: 'direct',
    disclosure_label: 'Sponsored',
  },
  audit_id: AUDIT_ID,
  latency_ms: 142,
} as const;

export const SUPPRESS_BODY = {
  decision: 'suppress',
  reason: 'low_confidence',
  classification: { ...SERVE_BODY.classification, method: 'rules', confidence: 0.2 },
  creative: null,
  audit_id: AUDIT_ID,
  latency_ms: 12,
} as const;

export type FetchCall = { url: string; init: FetchInit };

export type FakeFetch = { fetch: FetchLike; calls: FetchCall[] };

/** A fetch whose answer comes from `respond`; every call is recorded in `calls`. */
export const fakeFetch = (
  respond: (call: FetchCall) => FetchResponseLike | Promise<FetchResponseLike>,
): FakeFetch => {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
};

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const textResponse = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'text/plain' } });

export const emptyResponse = (status: number): Response => new Response(null, { status });

/** A fetch that never settles but honours its abort signal like the platform fetch does. */
export const hangingFetch = (): FakeFetch =>
  fakeFetch(
    ({ init }) =>
      new Promise<FetchResponseLike>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      }),
  );

/** A fetch that never settles and ignores its abort signal (a broken transport). */
export const deafFetch = (): FakeFetch => fakeFetch(() => new Promise<FetchResponseLike>(() => {}));

export const abortError = (): Error => {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
};

export const bodyOf = (call: FetchCall): Record<string, unknown> =>
  JSON.parse(call.init.body) as Record<string, unknown>;

export const headerOf = (call: FetchCall, name: string): string | null =>
  new Headers(call.init.headers).get(name);

export type WarnCall = { message: string; data: Record<string, unknown> | undefined };

export const fakeLogger = () => {
  const warnings: WarnCall[] = [];
  return {
    warnings,
    logger: {
      warn: (message: string, data?: Record<string, unknown>) => {
        warnings.push({ message, data });
      },
    },
  };
};
