import type { Classification } from '@adgateio/schemas';

import { PROMPT_VERSION } from './prompt.js';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  type LlmClassifier,
  type LlmClassifyFailure,
  type LlmClassifyOptions,
  type LlmClassifyResult,
  type LlmClassifySuccess,
  type LlmFailureReason,
} from './types.js';

/**
 * Test double for the LLM stage. Unit tests never touch the network (CLAUDE.md), so S08 and the
 * gateway tests drive the classifier with this instead of OpenAiCompatibleClassifier. It records
 * every text it was asked about so tests can assert the LLM was, or was not, consulted.
 */
export type FakeLlmMode = 'timeout' | 'parse' | 'throw' | 'hang';

export type FakeLlmScript = LlmClassifyResult | ((text: string) => LlmClassifyResult) | FakeLlmMode;

export type LlmClassificationFields = Pick<
  Classification,
  'commercial_intent' | 'categories' | 'sensitive' | 'confidence'
>;

/** A success result; unspecified fields default to a confident, general, serve-able answer. */
export const fakeLlmSuccess = (
  fields: Partial<LlmClassificationFields>,
  latencyMs = 5,
): LlmClassifySuccess => ({
  ok: true,
  classification: {
    commercial_intent: fields.commercial_intent ?? 0.9,
    categories: fields.categories ?? ['general'],
    sensitive: fields.sensitive ?? [],
    confidence: fields.confidence ?? 0.9,
    method: 'llm',
    prompt_version: PROMPT_VERSION,
  },
  latency_ms: latencyMs,
});

export const fakeLlmFailure = (
  reason: LlmFailureReason,
  latencyMs = 5,
  detail?: string,
): LlmClassifyFailure =>
  detail === undefined
    ? { ok: false, reason, latency_ms: latencyMs }
    : { ok: false, reason, latency_ms: latencyMs, detail };

export class FakeLlmClassifier implements LlmClassifier {
  /** Every text passed to classify, in order (held in memory only, never logged). */
  readonly calls: string[] = [];

  constructor(private readonly script: FakeLlmScript) {}

  get callCount(): number {
    return this.calls.length;
  }

  reset(): void {
    this.calls.length = 0;
  }

  /**
   * 'timeout' and 'parse' return the matching typed failure. 'throw' rejects on purpose, which
   * a real LlmClassifier never does, so callers can prove they convert a throw into a
   * rules-only result; 'hang' never settles, so callers can prove their own deadline fires.
   * A function script is called with the text; a result is returned as is.
   */
  async classify(text: string, opts?: LlmClassifyOptions): Promise<LlmClassifyResult> {
    this.calls.push(text);
    if (opts?.signal?.aborted) {
      return fakeLlmFailure('aborted', 0, 'aborted before the request started');
    }
    const script = this.script;
    if (script === 'throw') {
      throw new Error('FakeLlmClassifier: throw mode');
    }
    if (script === 'hang') {
      return new Promise<LlmClassifyResult>(() => undefined);
    }
    if (script === 'timeout') {
      return fakeLlmFailure(
        'timeout',
        DEFAULT_LLM_TIMEOUT_MS,
        `no response within ${DEFAULT_LLM_TIMEOUT_MS} ms`,
      );
    }
    if (script === 'parse') {
      return fakeLlmFailure('parse', 5, 'model content is not valid JSON');
    }
    return typeof script === 'function' ? script(text) : script;
  }
}
