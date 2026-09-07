import type { AttestRequest, EventRequest } from '@adgateio/schemas';

import { isEvaluateResponse } from './guards.js';
import { CLIENT_FAILURE_PROMPT_VERSION, hashModelOutput } from './hash.js';
import { isSuccessStatus, joinUrl, postJson, type HttpOutcome } from './http.js';
import type {
  AdgateClient,
  AttestOptions,
  AttestResult,
  ClientError,
  ClientOptions,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResult,
  EventType,
  Logger,
  PostResult,
  TrackOptions,
  TrackResult,
} from './types.js';

/**
 * The framework-agnostic adgate client (docs/api.md). Every method resolves, never rejects:
 * the app must never break because of adgate. evaluate fails closed to a suppress decision with
 * reason 'error'; attest and track report { ok: false } and, when a logger was given, warn.
 * Works unchanged in Node 20 and browsers: fetch, AbortController, TextEncoder and WebCrypto
 * are the only platform APIs used, all of them injectable or global.
 */
export const DEFAULT_TIMEOUT_MS = 800;
export const EVALUATE_PATH = '/v1/evaluate';
export const ATTEST_PATH = '/v1/attest';
export const EVENTS_PATH = '/v1/events';

/** The result evaluate resolves to when the gateway never gave a usable answer. */
export const failClosedEvaluate = (error: ClientError, latency_ms: number): EvaluateResult => ({
  decision: 'suppress',
  reason: 'error',
  classification: {
    commercial_intent: 0,
    categories: ['general'],
    sensitive: [],
    confidence: 0,
    method: 'rules',
    prompt_version: CLIENT_FAILURE_PROMPT_VERSION,
  },
  creative: null,
  audit_id: null,
  latency_ms,
  error,
});

const assertOptions = (options: ClientOptions): void => {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('createClient: options object required');
  }
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
    throw new TypeError('createClient: apiKey must be a non-empty string');
  }
  if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0) {
    throw new TypeError('createClient: baseUrl must be a non-empty string');
  }
  if (
    options.timeoutMs !== undefined &&
    !(
      typeof options.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
    )
  ) {
    throw new TypeError('createClient: timeoutMs must be a positive number of milliseconds');
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** A logger is user code; it must never be able to break the never-rejects promise. */
const safeWarn = (logger: Logger | undefined, message: string, data: Record<string, unknown>) => {
  if (logger === undefined) {
    return;
  }
  try {
    logger.warn(message, data);
  } catch {
    // Deliberately swallowed: a throwing logger is the caller's bug, not a reason to fail.
  }
};

/**
 * Builds a client. Throws TypeError at construction (and only then) for a missing apiKey or
 * baseUrl or a non-positive timeoutMs: misconfiguration is a programming error best seen at
 * boot, whereas every call on the returned client resolves.
 */
export const createClient = (options: ClientOptions): AdgateClient => {
  assertOptions(options);
  const { apiKey, baseUrl, logger } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const post = (path: string, body: unknown, signal: AbortSignal | undefined) =>
    postJson({
      // Resolved per call so a fetch polyfill installed after createClient is still picked up.
      fetch: options.fetch ?? globalThis.fetch,
      url: joinUrl(baseUrl, path),
      apiKey,
      body,
      timeoutMs,
      signal,
    });

  const settle = (what: string, auditId: string, outcome: HttpOutcome): PostResult => {
    if (outcome.kind !== 'response') {
      if (outcome.kind !== 'aborted') {
        safeWarn(logger, `adgate ${what} failed`, { audit_id: auditId, error: outcome.kind });
      }
      return { ok: false, error: outcome.kind };
    }
    if (isSuccessStatus(outcome.status)) {
      return { ok: true, status: outcome.status };
    }
    // 404 (no record for this id, see the S18 fail-closed path) and 409 (already attested)
    // included: they are reported, never thrown.
    safeWarn(logger, `adgate ${what} rejected`, { audit_id: auditId, status: outcome.status });
    return { ok: false, status: outcome.status, error: 'http' };
  };

  const evaluate = async (
    request: EvaluateRequest,
    opts?: EvaluateOptions,
  ): Promise<EvaluateResult> => {
    const started = Date.now();
    const fail = (error: ClientError): EvaluateResult => {
      if (error.kind !== 'aborted') {
        safeWarn(logger, 'adgate evaluate failed', { ...error });
      }
      return failClosedEvaluate(error, Date.now() - started);
    };
    try {
      const outcome = await post(EVALUATE_PATH, request, opts?.signal);
      if (outcome.kind !== 'response') {
        return fail({ kind: outcome.kind });
      }
      if (!isSuccessStatus(outcome.status)) {
        return fail({ kind: 'http', status: outcome.status });
      }
      const body = parseJson(outcome.text);
      if (!isEvaluateResponse(body)) {
        return fail({ kind: 'invalid_response', status: outcome.status });
      }
      return body;
    } catch {
      return fail({ kind: 'network' });
    }
  };

  const attest = async (
    auditId: string,
    modelOutputText: string,
    opts?: AttestOptions,
  ): Promise<AttestResult> => {
    try {
      const body: AttestRequest = {
        audit_id: auditId,
        model_output_hash: await hashModelOutput(modelOutputText),
        rendered: opts?.rendered ?? true,
      };
      return settle('attest', auditId, await post(ATTEST_PATH, body, opts?.signal));
    } catch {
      safeWarn(logger, 'adgate attest failed', { audit_id: auditId, error: 'network' });
      return { ok: false, error: 'network' };
    }
  };

  const track = async (
    auditId: string,
    type: EventType,
    opts?: TrackOptions,
  ): Promise<TrackResult> => {
    try {
      const body: EventRequest = {
        audit_id: auditId,
        type,
        ts: opts?.ts ?? new Date().toISOString(),
        ...(opts?.meta === undefined ? {} : { meta: opts.meta }),
      };
      return settle('track', auditId, await post(EVENTS_PATH, body, opts?.signal));
    } catch {
      safeWarn(logger, 'adgate track failed', { audit_id: auditId, error: 'network' });
      return { ok: false, error: 'network' };
    }
  };

  return { evaluate, attest, track };
};
