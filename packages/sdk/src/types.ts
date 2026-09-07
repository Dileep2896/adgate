import type {
  AttestRequest as AttestRequestShape,
  Classification as ClassificationShape,
  Creative as CreativeShape,
  Decision as DecisionShape,
  EvaluateRequest as EvaluateRequestShape,
  EvaluateResponse as EvaluateResponseShape,
  EventRequest as EventRequestShape,
  EventType as EventTypeShape,
  SuppressReason as SuppressReasonShape,
} from '@adgateio/schemas';

/**
 * Public types of the core client. The wire shapes are the docs/api.md contract, taken from
 * @adgateio/schemas as TYPES ONLY so the runtime bundle carries no zod (build.test.ts). They are
 * re-exported as local aliases rather than `export type { X } from`, because the declaration
 * bundler drops the `type` keyword on a re-export and a consumer could then import the zod
 * schema value of the same name from this package, which does not exist at runtime.
 */
export type AttestRequest = AttestRequestShape;
export type Classification = ClassificationShape;
export type Creative = CreativeShape;
export type Decision = DecisionShape;
export type EvaluateRequest = EvaluateRequestShape;
export type EvaluateResponse = EvaluateResponseShape;
export type EventRequest = EventRequestShape;
export type EventType = EventTypeShape;
export type SuppressReason = SuppressReasonShape;

/**
 * Why a call did not produce a usable answer.
 * - network: no response was obtained. The transport failed, or the request could not be
 *   prepared (body not serialisable, SubtleCrypto missing for attest, no fetch at all).
 * - timeout: the client's own deadline (timeoutMs) expired first.
 * - http: the gateway answered with a non-2xx status (see `status`).
 * - invalid_response: a 2xx answer whose body is not JSON or not the documented shape.
 * - aborted: the caller's AbortSignal fired.
 */
export type ClientErrorKind = 'network' | 'timeout' | 'http' | 'invalid_response' | 'aborted';

export type ClientError = { kind: ClientErrorKind; status?: number };

/**
 * What evaluate resolves to. On success it is the EvaluateResponse exactly as the gateway sent
 * it. On any failure it is a suppress decision with reason 'error', `audit_id` null (the gateway
 * never answered, or answered with something unusable, so there is no record to attest or track)
 * and `error` describing what happened.
 */
export type EvaluateResult = Omit<EvaluateResponse, 'audit_id'> & {
  audit_id: string | null;
  error?: ClientError;
};

/** Outcome of attest and track: never a rejection. `status` is the HTTP status when one arrived. */
export type PostResult =
  { ok: true; status: number } | { ok: false; status?: number; error: ClientErrorKind };

export type AttestResult = PostResult;
export type TrackResult = PostResult;

/** Optional sink for failures. A library must stay silent by default, so there is no console fallback. */
export type Logger = {
  warn(message: string, data?: Record<string, unknown>): void;
};

/** The subset of the Fetch API the client needs, so fakes stay small and browsers need no polyfill. */
export type FetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

export type FetchResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

export type ClientOptions = {
  /** An `app` role API key (ak_...). Sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Gateway origin, e.g. https://adgate.example.com. A trailing slash is ignored. */
  baseUrl: string;
  /** Per-call deadline. Default 800 ms: evaluate must never hold up the answer. */
  timeoutMs?: number;
  /** Transport. Default: globalThis.fetch, present in Node 20 and every browser. */
  fetch?: FetchLike;
  /** Receives one warn per failed call. Default: nothing is logged. */
  logger?: Logger;
};

export type EvaluateOptions = { signal?: AbortSignal };

export type AttestOptions = {
  /** Whether the sponsored block was actually shown. Default true. */
  rendered?: boolean;
  signal?: AbortSignal;
};

export type TrackOptions = {
  /** ISO 8601 UTC timestamp of the event. Default: now. */
  ts?: string;
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * Whether the sponsored block was actually shown to the user, for the attest call the
 * withGeneration and forStream helpers make on the caller's behalf. A predicate is given the
 * decision, so an app that renders conditionally can answer once the decision is known.
 * Default: true for a serve decision, false for a suppress one.
 */
export type RenderedOption = boolean | ((decision: EvaluateResult) => boolean);

export type WithGenerationOptions = {
  rendered?: RenderedOption;
  /** Applies to both the evaluate and the attest request. */
  signal?: AbortSignal;
};

export type WithGenerationResult = {
  /** Exactly what `generate()` resolved to; the helper never rewrites the answer. */
  answer: string;
  decision: EvaluateResult;
  /** null when there was nothing to attest (the decision carries no audit_id). */
  attest: AttestResult | null;
};

export type StreamOptions = WithGenerationOptions;

/** Per-finish overrides; anything omitted falls back to the options forStream was built with. */
export type StreamFinishOptions = WithGenerationOptions;

export type StreamResult = {
  /** The chunks passed to onChunk, joined in arrival order. */
  text: string;
  decision: EvaluateResult;
  attest: AttestResult | null;
};

/** What forStream hands back: the decision, a chunk sink, and one terminal finish. */
export type StreamHandle = {
  /** Resolves as soon as the gateway answers, independently of the stream. Never rejects. */
  decisionPromise: Promise<EvaluateResult>;
  /**
   * Appends one chunk of the answer. Chunks must be strings: a caller streaming bytes decodes
   * them first (`new TextDecoder().decode(bytes, { stream: true })`), because a hash over
   * split multi-byte characters would not match the text the user saw.
   */
  onChunk(chunk: string): void;
  /** Awaits the decision, hashes the accumulated text and attests. Idempotent. Never rejects. */
  finish(options?: StreamFinishOptions): Promise<StreamResult>;
  /** Marks the stream failed: a later finish resolves with attest null and sends nothing. */
  abort(): void;
};

export type AdgateClient = {
  /** Asks the gateway whether a sponsored slot may follow this turn. Never rejects. */
  evaluate(request: EvaluateRequest, options?: EvaluateOptions): Promise<EvaluateResult>;
  /** Hashes the complete model answer locally and sends ONLY the hash. Never rejects. */
  attest(auditId: string, modelOutputText: string, options?: AttestOptions): Promise<AttestResult>;
  /** Records an impression, click, dismiss or conversion for an audit id. Never rejects. */
  track(auditId: string, type: EventType, options?: TrackOptions): Promise<TrackResult>;
};
