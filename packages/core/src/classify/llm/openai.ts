import { parseLlmContent } from './output.js';
import { CLASSIFIER_PROMPT } from './prompt.js';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  type LlmClassifier,
  type LlmClassifierConfig,
  type LlmClassifyFailure,
  type LlmClassifyOptions,
  type LlmClassifyResult,
  type LlmFailureReason,
  type LlmFetch,
} from './types.js';

/**
 * LlmClassifier over any OpenAI compatible chat completions endpoint (OpenAI, Azure, Groq,
 * Ollama, vLLM...). One POST per call with temperature 0 and JSON mode through the injected
 * fetch; a hard timeout races the request so the call settles within timeoutMs even when the
 * transport ignores the abort signal. Never throws: every outcome is a typed LlmClassifyResult
 * (docs/api.md: fail closed).
 */
export const CHAT_COMPLETIONS_PATH = '/chat/completions';

export const buildChatCompletionsUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${CHAT_COMPLETIONS_PATH}`;

export const buildChatCompletionsBody = (model: string, text: string) => ({
  model,
  temperature: 0,
  response_format: { type: 'json_object' as const },
  messages: [
    { role: 'system' as const, content: CLASSIFIER_PROMPT },
    { role: 'user' as const, content: text },
  ],
});

const failure = (
  reason: LlmFailureReason,
  latency_ms: number,
  detail?: string,
): LlmClassifyFailure =>
  detail === undefined
    ? { ok: false, reason, latency_ms }
    : { ok: false, reason, latency_ms, detail };

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'non-Error rejection';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Extracted = { ok: true; content: string } | { ok: false; detail: string };

/** choices[0].message.content of a chat completion envelope, without trusting its shape. */
const extractContent = (body: string): Extracted => {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return { ok: false, detail: 'response body is not valid JSON' };
  }
  const choices = isRecord(envelope) ? envelope['choices'] : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first['message'] : undefined;
  const content = isRecord(message) ? message['content'] : undefined;
  return typeof content === 'string'
    ? { ok: true, content }
    : { ok: false, detail: 'response has no choices[0].message.content string' };
};

export class OpenAiCompatibleClassifier implements LlmClassifier {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: LlmFetch;

  constructor(config: LlmClassifierConfig) {
    this.url = buildChatCompletionsUrl(config.baseUrl);
    this.headers =
      config.apiKey === ''
        ? { 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    this.fetchImpl = config.fetch;
  }

  async classify(text: string, opts?: LlmClassifyOptions): Promise<LlmClassifyResult> {
    const started = Date.now();
    const external = opts?.signal;
    if (external?.aborted) {
      return failure('aborted', 0, 'aborted before the request started');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    external?.addEventListener('abort', onExternalAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<LlmClassifyFailure>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(
          failure('timeout', Date.now() - started, `no response within ${this.timeoutMs} ms`),
        );
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([
        this.request(text, controller.signal, external, started),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async request(
    text: string,
    signal: AbortSignal,
    external: AbortSignal | undefined,
    started: number,
  ): Promise<LlmClassifyResult> {
    const latency = () => Date.now() - started;
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(buildChatCompletionsBody(this.model, text)),
        signal,
      });
      if (!response.ok) {
        return failure('http', latency(), `HTTP ${response.status}`);
      }
      const extracted = extractContent(await response.text());
      if (!extracted.ok) {
        return failure('parse', latency(), extracted.detail);
      }
      const parsed = parseLlmContent(extracted.content);
      if (!parsed.ok) {
        return failure(parsed.reason, latency(), parsed.detail);
      }
      return { ok: true, classification: parsed.classification, latency_ms: latency() };
    } catch (error) {
      if (external?.aborted) {
        return failure('aborted', latency(), 'aborted by caller');
      }
      if (signal.aborted) {
        return failure('timeout', latency(), `no response within ${this.timeoutMs} ms`);
      }
      return failure('network', latency(), errorText(error));
    }
  }
}
