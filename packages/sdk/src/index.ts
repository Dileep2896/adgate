/**
 * @adgateio/sdk core entry: works in Node 20 and browsers, no runtime dependencies.
 * `@adgateio/sdk/react` (S24) and `@adgateio/sdk/ai` (S25) are separate entries.
 */
export {
  ATTEST_PATH,
  createClient,
  DEFAULT_TIMEOUT_MS,
  EVALUATE_PATH,
  EVENTS_PATH,
  failClosedEvaluate,
} from './client.js';
export { withGeneration } from './generation.js';
export { isEvaluateResponse } from './guards.js';
export {
  CLIENT_FAILURE_PROMPT_SEED,
  CLIENT_FAILURE_PROMPT_VERSION,
  hashModelOutput,
} from './hash.js';
export { forStream } from './stream.js';
export type {
  AdgateClient,
  AttestOptions,
  AttestRequest,
  AttestResult,
  Classification,
  ClientError,
  ClientErrorKind,
  ClientOptions,
  Creative,
  Decision,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResponse,
  EvaluateResult,
  EventRequest,
  EventType,
  FetchInit,
  FetchLike,
  FetchResponseLike,
  Logger,
  PostResult,
  RenderedOption,
  StreamFinishOptions,
  StreamHandle,
  StreamOptions,
  StreamResult,
  SuppressReason,
  TrackOptions,
  TrackResult,
  WithGenerationOptions,
  WithGenerationResult,
} from './types.js';
