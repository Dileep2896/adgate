import type { ClientErrorKind, FetchLike } from './types.js';

/**
 * One JSON POST with a bearer key, a hard deadline and caller abort support. Never throws: the
 * outcome is either the response (any status, body read as text) or a typed failure. The
 * deadline is raced as a promise as well as signalled, so the call settles on time even when a
 * transport ignores its AbortSignal.
 */
export type HttpOutcome =
  | { kind: 'response'; status: number; text: string }
  | { kind: Extract<ClientErrorKind, 'network' | 'timeout' | 'aborted'> };

export type PostJsonInput = {
  fetch: FetchLike | undefined;
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
};

export const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`;

export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

export const postJson = async (input: PostJsonInput): Promise<HttpOutcome> => {
  const external = input.signal;
  if (external?.aborted) {
    return { kind: 'aborted' };
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<HttpOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timeout' });
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([send(input, controller.signal, external), deadline]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
};

const send = async (
  input: PostJsonInput,
  signal: AbortSignal,
  external: AbortSignal | undefined,
): Promise<HttpOutcome> => {
  // Called as a plain function on purpose: browsers throw "Illegal invocation" when the
  // platform fetch is invoked as a method of another object.
  const fetchImpl = input.fetch;
  try {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('no fetch implementation available');
    }
    const response = await fetchImpl(input.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
      signal,
    });
    const text = await response.text();
    return { kind: 'response', status: response.status, text };
  } catch {
    if (external?.aborted) {
      return { kind: 'aborted' };
    }
    if (signal.aborted) {
      return { kind: 'timeout' };
    }
    return { kind: 'network' };
  }
};
