import type { Candidate, DemandRequest, DemandResponse, DemandSource } from '@adgate/schemas';

import { creative } from './direct.fixture.js';
import { demandResponse } from './response.js';
import type { DemandAdapter, DemandFetchOptions } from './types.js';

/**
 * Test fixture (not exported from the package): scripted demand adapters for mediation tests
 * and a candidate builder. Every script is deterministic under fake timers.
 */
export type FakeScript =
  /** Answers with the candidates, after delayMs (fake) milliseconds when set. */
  | { kind: 'respond'; candidates?: Candidate[]; error?: string; delayMs?: number }
  /** Never settles, whatever the signal says. */
  | { kind: 'hang' }
  /** Throws synchronously from fetch (a broken adapter, not a rejected promise). */
  | { kind: 'throw'; error?: unknown }
  /** Returns a rejected promise. */
  | { kind: 'reject'; error?: unknown }
  /** Resolves with something that is not a DemandResponse. */
  | { kind: 'malformed' };

export class FakeAdapter implements DemandAdapter {
  calls = 0;
  lastOptions: DemandFetchOptions | undefined;

  constructor(
    readonly source: DemandSource,
    private readonly script: FakeScript,
  ) {}

  fetch(_req: DemandRequest, opts: DemandFetchOptions): Promise<DemandResponse> {
    this.calls += 1;
    this.lastOptions = opts;
    const script = this.script;
    switch (script.kind) {
      case 'throw':
        throw script.error ?? new TypeError('fake adapter threw');
      case 'reject':
        return Promise.reject(script.error ?? new RangeError('fake adapter rejected'));
      case 'hang':
        return new Promise(() => {});
      case 'malformed':
        return Promise.resolve({ source: this.source } as DemandResponse);
      case 'respond': {
        const response = demandResponse(
          this.source,
          script.candidates ?? [],
          script.delayMs ?? 0,
          script.error,
        );
        if (script.delayMs === undefined) {
          return Promise.resolve(response);
        }
        return new Promise((resolve) => {
          setTimeout(() => resolve(response), script.delayMs);
        });
      }
    }
  }
}

export interface CandidateOverrides {
  ecpm?: number;
  match?: number;
  domain?: string;
  source?: DemandSource;
}

/** A candidate with the given scores; ecpm 5 and targeting_match 0.75 unless overridden. */
export const candidate = (id: string, overrides: CandidateOverrides = {}): Candidate => {
  const ecpm = overrides.ecpm ?? 5;
  return {
    ...creative({
      id,
      ecpm,
      advertiser_domain: overrides.domain ?? 'advertiser.test',
      source: overrides.source ?? 'direct',
    }),
    ecpm_estimate: ecpm,
    targeting_match: overrides.match ?? 0.75,
  };
};

/** An adapter that answers at once (or after delayMs) with the given candidates. */
export const respond = (
  source: DemandSource,
  candidates: Candidate[],
  extra: { delayMs?: number; error?: string } = {},
): FakeAdapter => new FakeAdapter(source, { kind: 'respond', candidates, ...extra });

export const NO_EXCLUSIONS = { competitor_exclusions: [] as string[] };
