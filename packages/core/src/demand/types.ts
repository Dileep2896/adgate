import type { DemandRequest, DemandResponse, DemandSource } from '@adgateio/schemas';

/**
 * The demand adapter contract (docs/BUILD_GUIDE.md Phase 3). Every demand source (direct,
 * affiliate, koah, gravity) implements DemandAdapter; mediate() (S11) runs the enabled ones in
 * parallel under a per-adapter timeout and summarizes each DemandResponse into the audit
 * record's demand block. Adapters never see message text: DemandRequest carries the
 * classification and, optionally, normalized dictionary keywords from the rules classifier.
 */

/** docs/api.md latency targets: demand adapters get 250 ms each, in parallel. */
export const DEFAULT_DEMAND_TIMEOUT_MS = 250;

export interface DemandFetchOptions {
  /** Hard latency budget. Adapters that do I/O must settle (error 'timeout') by then. */
  timeoutMs: number;
  /** Caller-side cancellation. An already aborted signal yields no candidates, error 'aborted'. */
  signal?: AbortSignal | undefined;
}

export interface DemandAdapter {
  readonly source: DemandSource;
  /** Never rejects: any failure comes back as { candidates: [], error }. */
  fetch(req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse>;
}

export interface DirectAdapterOptions {
  /** Clock for latency_ms, in milliseconds. Defaults to Date.now (fake-timer friendly). */
  now?: (() => number) | undefined;
}
