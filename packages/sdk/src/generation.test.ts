import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ATTEST_PATH, createClient, EVALUATE_PATH } from './client.js';
import { withGeneration } from './generation.js';
import {
  API_KEY,
  AUDIT_ID,
  BASE_URL,
  bodyOf,
  callsTo,
  emptyResponse,
  jsonResponse,
  REQUEST,
  routedFetch,
  SUPPRESS_BODY,
} from './test-support.js';
import type { AdgateClient, EvaluateResult, FetchLike } from './types.js';

const ANSWER =
  'For a side project a managed Postgres with a free tier is the least hassle.\nStart there.';
const ANSWER_HASH = `sha256:${createHash('sha256').update(ANSWER, 'utf8').digest('hex')}`;

const clientWith = (fetch: FetchLike): AdgateClient =>
  createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

/** A deferred promise, so a test can prove evaluate ran before generate resolved. */
const deferred = () => {
  let resolve: (value: string) => void = () => {};
  const promise = new Promise<string>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('withGeneration', () => {
  it('returns the answer with the decision and attests once with the full-text hash', async () => {
    const { fetch, calls } = routedFetch();
    const result = await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER));

    expect(result.answer).toBe(ANSWER);
    expect(result.decision.decision).toBe('serve');
    expect(result.decision.audit_id).toBe(AUDIT_ID);
    expect(result.attest).toEqual({ ok: true, status: 204 });

    const attests = callsTo(calls, ATTEST_PATH);
    expect(attests).toHaveLength(1);
    expect(bodyOf(attests[0]!)).toEqual({
      audit_id: AUDIT_ID,
      model_output_hash: ANSWER_HASH,
      rendered: true,
    });
    expect(attests[0]?.init.body).not.toContain('side project');
    expect(callsTo(calls, EVALUATE_PATH)).toHaveLength(1);
  });

  it('defaults rendered to false when the decision is suppress', async () => {
    const { fetch, calls } = routedFetch({ evaluate: () => jsonResponse(200, SUPPRESS_BODY) });
    const result = await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER));

    expect(result.decision.decision).toBe('suppress');
    expect(result.attest).toEqual({ ok: true, status: 204 });
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['rendered']).toBe(false);
  });

  it('honours an explicit rendered flag and a rendered predicate', async () => {
    const { fetch, calls } = routedFetch();
    await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER), {
      rendered: false,
    });
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['rendered']).toBe(false);

    const seen: EvaluateResult[] = [];
    const second = routedFetch();
    await withGeneration(clientWith(second.fetch), REQUEST, () => Promise.resolve(ANSWER), {
      rendered: (decision) => {
        seen.push(decision);
        return decision.decision === 'serve';
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.audit_id).toBe(AUDIT_ID);
    expect(bodyOf(callsTo(second.calls, ATTEST_PATH)[0]!)['rendered']).toBe(true);
  });

  it('starts evaluate before generate resolves', async () => {
    const { fetch, calls } = routedFetch();
    const answer = deferred();

    const pending = withGeneration(clientWith(fetch), REQUEST, () => answer.promise);
    await vi.waitFor(() => expect(callsTo(calls, EVALUATE_PATH)).toHaveLength(1));
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);

    answer.resolve(ANSWER);
    const result = await pending;
    expect(result.answer).toBe(ANSWER);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(1);
  });

  it('propagates a generate failure and sends no attest', async () => {
    const { fetch, calls } = routedFetch();
    const boom = new Error('the model call failed');

    await expect(
      withGeneration(clientWith(fetch), REQUEST, () => Promise.reject(boom)),
    ).rejects.toBe(boom);

    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('propagates a synchronous throw from generate', async () => {
    const { fetch, calls } = routedFetch();
    const boom = new Error('sync');
    await expect(
      withGeneration(clientWith(fetch), REQUEST, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('leaves no unhandled rejection when both evaluate and generate reject', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const attest = vi.fn(async () => ({ ok: true as const, status: 204 }));
      const broken: AdgateClient = {
        evaluate: () => Promise.reject(new Error('client contract broken')),
        attest,
        track: () => Promise.reject(new Error('unused')),
      };
      const boom = new Error('the model call failed');
      await expect(withGeneration(broken, REQUEST, () => Promise.reject(boom))).rejects.toBe(boom);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
      expect(attest).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('still returns the answer when evaluate fails, with a suppress decision and no attest', async () => {
    const { fetch, calls } = routedFetch({
      evaluate: () => jsonResponse(500, { error: { code: 'internal', message: 'boom' } }),
    });
    const result = await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER));

    expect(result.answer).toBe(ANSWER);
    expect(result.decision.decision).toBe('suppress');
    expect(result.decision.reason).toBe('error');
    expect(result.decision.audit_id).toBeNull();
    expect(result.decision.error).toEqual({ kind: 'http', status: 500 });
    expect(result.attest).toBeNull();
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('fails closed when the caller signal is already aborted', async () => {
    const { fetch, calls } = routedFetch();
    const controller = new AbortController();
    controller.abort();

    const result = await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER), {
      signal: controller.signal,
    });

    expect(result.answer).toBe(ANSWER);
    expect(result.decision.error).toEqual({ kind: 'aborted' });
    expect(result.attest).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reports a rejected attest without rejecting', async () => {
    const { fetch } = routedFetch({ attest: () => emptyResponse(409) });
    const result = await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER));
    expect(result.attest).toEqual({ ok: false, status: 409, error: 'http' });
  });

  it('survives a client whose attest breaks the never-rejects contract', async () => {
    const evaluate = createClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: routedFetch().fetch,
    }).evaluate;
    const broken: AdgateClient = {
      evaluate,
      attest: () => Promise.reject(new Error('attest exploded')),
      track: () => Promise.reject(new Error('unused')),
    };
    const result = await withGeneration(broken, REQUEST, () => Promise.resolve(ANSWER));
    expect(result.answer).toBe(ANSWER);
    expect(result.attest).toEqual({ ok: false, error: 'network' });
  });

  it('falls back to the default when a rendered predicate throws', async () => {
    const { fetch, calls } = routedFetch();
    await withGeneration(clientWith(fetch), REQUEST, () => Promise.resolve(ANSWER), {
      rendered: () => {
        throw new Error('caller bug');
      },
    });
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['rendered']).toBe(true);
  });
});
