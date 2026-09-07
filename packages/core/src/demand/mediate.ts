import type {
  Candidate,
  DemandRequest,
  DemandResponse,
  DemandResponseSummary,
  DemandSource,
  DemandTrace,
  ExcludedCandidate,
  PolicyConfig,
} from '@adgateio/schemas';

import { isExcludedDomain } from './exclusions.js';
import { type Clock, describeError, latencySince, safeNow } from './response.js';
import { compareByRevenue } from './select.js';
import { DEFAULT_DEMAND_TIMEOUT_MS, type DemandAdapter } from './types.js';

/**
 * Mediation (docs/BUILD_GUIDE.md Phase 3; docs/decisions.md item 5: no auction). The caller
 * passes the enabled adapters in policy demand order. They all run in parallel, each under its
 * own timer and AbortController, so the slowest source can hold the answer back by at most
 * timeoutMs; a late answer is ignored. Candidates whose advertiser_domain matches a competitor
 * exclusion (policy or request) are dropped and listed in trace.excluded, the rest are ranked by
 * compareByRevenue (select.ts: ecpm_estimate * targeting_match, then ecpm_estimate, then
 * creative id, the same order the adapters cut their top 3 with) and the first wins. The trace
 * is the audit record's `demand` block (docs/audit.md): counts, latencies measured by the
 * mediator's clock, and short error codes. A failing adapter is recorded by its error NAME only
 * (describeError), never a message. mediate() never throws and never rejects; with nothing
 * selected the gateway records no_fill. Invariant on every path, the last-resort catch included:
 * trace.responses has exactly one entry per requested source, in adapter order.
 */
export const MEDIATION_TIMEOUT_ERROR = 'timeout';
export const MEDIATION_ABORTED_ERROR = 'aborted';
export const ADAPTER_ERROR_PREFIX = 'adapter_error:';

/** Cap on an adapter's error string in the trace (the affiliate adapter already cuts at 200). */
const MAX_ERROR_LENGTH = 200;

export interface MediateOptions {
  /** Per-adapter budget in milliseconds. Defaults to DEFAULT_DEMAND_TIMEOUT_MS. */
  timeoutMs?: number | undefined;
  /** Clock for latency_ms. Defaults to Date.now (fake-timer friendly). */
  now?: Clock | undefined;
  /** Caller-side cancellation: every adapter's signal follows it. */
  signal?: AbortSignal | undefined;
}

export interface MediationResult {
  selected: Candidate | null;
  /** The source of `selected`; also trace.selected. */
  selected_source: DemandSource | null;
  trace: DemandTrace;
}

/** What one adapter contributed: its trace entry plus the candidates it answered with. */
interface Settled {
  summary: DemandResponseSummary;
  candidates: readonly Candidate[];
}

const summarize = (
  source: DemandSource,
  candidates: number,
  latency_ms: number,
  error?: string,
): DemandResponseSummary =>
  error === undefined || error === ''
    ? { source, candidates, latency_ms }
    : { source, candidates, latency_ms, error: error.slice(0, MAX_ERROR_LENGTH) };

const sanitizeTimeout = (timeoutMs: number | undefined): number =>
  timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? Math.round(timeoutMs)
    : DEFAULT_DEMAND_TIMEOUT_MS;

const isResponse = (value: unknown): value is DemandResponse =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { candidates?: unknown }).candidates);

/**
 * One adapter under its own deadline. Settles with the adapter's answer, a timeout entry or an
 * aborted entry, whichever comes first. The timer and the abort listener are released on every
 * path, and the adapter's signal is aborted whenever its answer is no longer wanted.
 */
const fetchOne = (
  adapter: DemandAdapter,
  req: DemandRequest,
  timeoutMs: number,
  now: Clock,
  external: AbortSignal | undefined,
): Promise<Settled> =>
  new Promise<Settled>((resolve) => {
    const source = adapter.source;
    const start = safeNow(now);
    const failed = (error: string, latency_ms = latencySince(now, start)): Settled => ({
      summary: summarize(source, 0, latency_ms, error),
      candidates: [],
    });
    if (external?.aborted) {
      // Nothing to call and nothing to clean up: the adapter is never invoked.
      resolve(failed(MEDIATION_ABORTED_ERROR));
      return;
    }

    const controller = new AbortController();
    let done = false;
    const onAbort = () => {
      controller.abort();
      finish(failed(MEDIATION_ABORTED_ERROR));
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(failed(MEDIATION_TIMEOUT_ERROR, timeoutMs));
    }, timeoutMs);
    function finish(settled: Settled): void {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
      resolve(settled);
    }
    external?.addEventListener('abort', onAbort, { once: true });

    // An async wrapper turns a synchronous throw from fetch() into a rejection.
    const call = async () => adapter.fetch(req, { timeoutMs, signal: controller.signal });
    call().then(
      (response) => {
        if (!isResponse(response)) {
          finish(failed(`${ADAPTER_ERROR_PREFIX}InvalidResponse`));
          return;
        }
        const error = typeof response.error === 'string' ? response.error : undefined;
        finish({
          summary: summarize(source, response.candidates.length, latencySince(now, start), error),
          candidates: response.candidates,
        });
      },
      (error: unknown) => {
        finish(failed(`${ADAPTER_ERROR_PREFIX}${describeError(error)}`));
      },
    );
  });

const sourcesOf = (adapters: readonly DemandAdapter[]): DemandSource[] => {
  try {
    return adapters.map((adapter) => adapter.source);
  } catch {
    return [];
  }
};

/** Every requested source failed the same way (the last-resort path): one entry each. */
const failedAll = (adapters: readonly DemandAdapter[], error: string): MediationResult => {
  const requested = sourcesOf(adapters);
  return {
    selected: null,
    selected_source: null,
    trace: {
      requested,
      responses: requested.map((source) => summarize(source, 0, 0, error)),
      excluded: [],
      selected: null,
    },
  };
};

const mediateOrThrow = async (
  adapters: readonly DemandAdapter[],
  req: DemandRequest,
  policy: Pick<PolicyConfig, 'competitor_exclusions'>,
  options: MediateOptions,
): Promise<MediationResult> => {
  const now = options.now ?? Date.now;
  const timeoutMs = sanitizeTimeout(options.timeoutMs);
  const exclusions = [...policy.competitor_exclusions, ...req.exclusions];
  const jobs = adapters.map((adapter) => ({
    source: adapter.source,
    settled: fetchOne(adapter, req, timeoutMs, now, options.signal),
  }));
  const requested = jobs.map((job) => job.source);

  const outcomes = await Promise.allSettled(jobs.map((job) => job.settled));

  const responses: DemandResponseSummary[] = [];
  const excluded: ExcludedCandidate[] = [];
  const eligible: { source: DemandSource; candidate: Candidate }[] = [];
  for (const [index, job] of jobs.entries()) {
    const outcome = outcomes[index];
    if (outcome === undefined || outcome.status === 'rejected') {
      const name = describeError(outcome?.reason);
      responses.push(summarize(job.source, 0, 0, `${ADAPTER_ERROR_PREFIX}${name}`));
      continue;
    }
    responses.push(outcome.value.summary);
    for (const candidate of outcome.value.candidates) {
      if (isExcludedDomain(candidate.advertiser_domain, exclusions)) {
        excluded.push({
          source: job.source,
          creative_id: candidate.id,
          advertiser_domain: candidate.advertiser_domain,
          reason: 'competitor_exclusion',
        });
      } else {
        eligible.push({ source: job.source, candidate });
      }
    }
  }

  eligible.sort((a, b) => compareByRevenue(a.candidate, b.candidate));
  const winner = eligible[0];
  return {
    selected: winner?.candidate ?? null,
    selected_source: winner?.source ?? null,
    trace: { requested, responses, excluded, selected: winner?.source ?? null },
  };
};

export const mediate = async (
  adapters: readonly DemandAdapter[],
  req: DemandRequest,
  policy: Pick<PolicyConfig, 'competitor_exclusions'>,
  options: MediateOptions = {},
): Promise<MediationResult> => {
  try {
    return await mediateOrThrow(adapters, req, policy, options);
  } catch (error) {
    // Last resort (adapters, request or policy that are not what the types promise): fail
    // closed, still one trace entry per requested source, still the error name only.
    return failedAll(adapters, `${ADAPTER_ERROR_PREFIX}${describeError(error)}`);
  }
};
