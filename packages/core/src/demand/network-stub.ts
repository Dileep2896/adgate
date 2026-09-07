import type {
  DemandRequest,
  DemandResponse,
  DemandSource,
  NetworkAdapterConfig,
} from '@adgateio/schemas';

import { type Clock, demandResponse, describeError, latencySince, safeNow } from './response.js';
import type { DemandAdapter, DemandFetchOptions } from './types.js';

/**
 * Shared body of the partner network stubs (koah.ts, gravity.ts). docs/decisions.md item 10:
 * "Koah and Gravity adapters are stubs until partner API access exists. Reason: do not build
 * against guessed request shapes." A stub is a complete DemandAdapter that never yields a
 * candidate: without enabled: true plus both credentials it answers not_configured, with them
 * it answers not_implemented, because the partner request shape is unknown and a guess is what
 * item 10 forbids. It keeps only a boolean from its config, so the api_key can never reach a
 * response, the audit trace or a log. Synchronous and pure like DirectAdapter: timeoutMs cannot
 * be exceeded and no network is ever touched (purity.test.ts).
 */
export const NETWORK_NOT_CONFIGURED = 'not_configured';
export const NETWORK_NOT_IMPLEMENTED = 'not_implemented';

export interface NetworkAdapterOptions {
  /** Clock for latency_ms, in milliseconds. Defaults to Date.now (fake-timer friendly). */
  now?: Clock | undefined;
}

const isPresent = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** enabled: true with a non-blank api_key and base_url. Anything else is not configured. */
export const isNetworkConfigured = (config: NetworkAdapterConfig): boolean =>
  config.enabled === true && isPresent(config.api_key) && isPresent(config.base_url);

export class NetworkStubAdapter<
  Source extends DemandSource = DemandSource,
> implements DemandAdapter {
  readonly source: Source;
  private readonly configured: boolean;
  private readonly now: Clock;

  constructor(source: Source, config: NetworkAdapterConfig, options: NetworkAdapterOptions = {}) {
    this.source = source;
    this.configured = isNetworkConfigured(config);
    this.now = options.now ?? Date.now;
  }

  async fetch(_req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse> {
    const start = safeNow(this.now);
    try {
      if (opts.signal?.aborted) {
        return this.respond(start, 'aborted');
      }
      if (!this.configured) {
        return this.respond(start, NETWORK_NOT_CONFIGURED);
      }
      return this.respond(start, NETWORK_NOT_IMPLEMENTED);
    } catch (error) {
      return this.respond(start, describeError(error));
    }
  }

  private respond(start: number, error: string): DemandResponse {
    return demandResponse(this.source, [], latencySince(this.now, start), error);
  }
}
