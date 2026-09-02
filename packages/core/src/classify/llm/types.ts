import type { Classification } from '@adgate/schemas';

/**
 * Types for the LLM stage of the classifier (docs/BUILD_GUIDE.md Phase 2, design step 2).
 * The stage never throws: every outcome is an LlmClassifyResult so the orchestrator (S08) can
 * fall back to rules on any failure without a try/catch around the happy path.
 */

/** A Classification produced by the LLM: method is 'llm' and prompt_version is PROMPT_VERSION. */
export interface LlmClassification extends Classification {
  method: 'llm';
}

export const LLM_FAILURE_REASONS = [
  'timeout',
  'parse',
  'invalid',
  'http',
  'network',
  'aborted',
] as const;
export type LlmFailureReason = (typeof LLM_FAILURE_REASONS)[number];

export interface LlmClassifySuccess {
  ok: true;
  classification: LlmClassification;
  latency_ms: number;
}

export interface LlmClassifyFailure {
  ok: false;
  reason: LlmFailureReason;
  latency_ms: number;
  /** Short diagnostic (status code, error name, schema path). Never message or model text. */
  detail?: string;
}

export type LlmClassifyResult = LlmClassifySuccess | LlmClassifyFailure;

export interface LlmClassifyOptions {
  /** Caller-side cancellation, on top of the classifier's own timeout. */
  signal?: AbortSignal | undefined;
}

export interface LlmClassifier {
  classify(text: string, opts?: LlmClassifyOptions): Promise<LlmClassifyResult>;
}

/** The slice of the fetch API the client uses; globalThis.fetch satisfies it, so do test fakes. */
export interface LlmFetchInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface LlmFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type LlmFetch = (url: string, init: LlmFetchInit) => Promise<LlmFetchResponse>;

export const DEFAULT_LLM_TIMEOUT_MS = 400;

/** Injected by the gateway from its environment; core never reads env vars itself. */
export interface LlmClassifierConfig {
  /** Base URL of an OpenAI compatible API, e.g. https://api.openai.com/v1. */
  baseUrl: string;
  /** Bearer token. An empty string sends no Authorization header (local endpoints). */
  apiKey: string;
  model: string;
  /** Hard deadline for one classification. Default DEFAULT_LLM_TIMEOUT_MS (docs/api.md). */
  timeoutMs?: number | undefined;
  /** Defaults to globalThis.fetch. Tests inject a fake; unit tests never touch the network. */
  fetch?: LlmFetch | undefined;
}
