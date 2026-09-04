import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ATTEST_PATH, createClient, EVALUATE_PATH } from './client.js';
import { hashModelOutput } from './hash.js';
import { forStream } from './stream.js';
import {
  API_KEY,
  AUDIT_ID,
  BASE_URL,
  bodyOf,
  callsTo,
  jsonResponse,
  REQUEST,
  routedFetch,
  SUPPRESS_BODY,
} from './test-support.js';
import type { AdgateClient, FetchLike } from './types.js';

const CHUNKS = ['Managed Postgres ', 'with a free tier ', 'is the least hassle.'];
const JOINED = CHUNKS.join('');
const JOINED_HASH = `sha256:${createHash('sha256').update(JOINED, 'utf8').digest('hex')}`;

const clientWith = (fetch: FetchLike): AdgateClient =>
  createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch });

describe('forStream', () => {
  it('attests once on finish with the hash of the joined chunks', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST);

    for (const chunk of CHUNKS) {
      stream.onChunk(chunk);
    }
    const result = await stream.finish();

    expect(result.text).toBe(JOINED);
    expect(result.decision.audit_id).toBe(AUDIT_ID);
    expect(result.attest).toEqual({ ok: true, status: 204 });

    const attests = callsTo(calls, ATTEST_PATH);
    expect(attests).toHaveLength(1);
    expect(bodyOf(attests[0]!)).toEqual({
      audit_id: AUDIT_ID,
      model_output_hash: JOINED_HASH,
      rendered: true,
    });
    // Chunked hashing must equal hashing the whole string in one go.
    expect(JOINED_HASH).toBe(await hashModelOutput(JOINED));
    expect(attests[0]?.init.body).not.toContain('Postgres');
  });

  it('hashes the empty string when no chunk ever arrived', async () => {
    const { fetch, calls } = routedFetch();
    const result = await forStream(clientWith(fetch), REQUEST).finish();

    expect(result.text).toBe('');
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['model_output_hash']).toBe(
      `sha256:${createHash('sha256').update('').digest('hex')}`,
    );
  });

  it('is idempotent: a second finish returns the first result and sends no second attest', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST);
    stream.onChunk(JOINED);

    const first = stream.finish();
    const second = stream.finish();
    expect(second).toBe(first);

    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    expect(a.text).toBe(JOINED);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(1);
  });

  it('ignores chunks that arrive after finish', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST);
    stream.onChunk(JOINED);
    const pending = stream.finish();
    stream.onChunk(' and more text');

    const result = await pending;
    expect(result.text).toBe(JOINED);
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['model_output_hash']).toBe(JOINED_HASH);
  });

  it('sends no attest after abort and resolves with attest null', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST);
    stream.onChunk(CHUNKS[0]!);
    stream.abort();
    stream.onChunk(CHUNKS[1]!);

    const result = await stream.finish();

    expect(result.attest).toBeNull();
    expect(result.text).toBe(CHUNKS[0]);
    expect(result.decision.audit_id).toBe(AUDIT_ID);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);
    expect(callsTo(calls, EVALUATE_PATH)).toHaveLength(1);
  });

  it('resolves decisionPromise independently of finish', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST);

    const decision = await stream.decisionPromise;
    expect(decision.decision).toBe('serve');
    expect(decision.audit_id).toBe(AUDIT_ID);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);

    stream.onChunk(JOINED);
    const result = await stream.finish();
    expect(result.decision).toBe(decision);
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(1);
  });

  it('skips attest when evaluate never produced an audit id', async () => {
    const { fetch, calls } = routedFetch({
      evaluate: () => jsonResponse(503, { error: { code: 'unavailable', message: 'boom' } }),
    });
    const stream = forStream(clientWith(fetch), REQUEST);
    stream.onChunk(JOINED);

    const result = await stream.finish();

    expect(result.text).toBe(JOINED);
    expect(result.decision.decision).toBe('suppress');
    expect(result.decision.reason).toBe('error');
    expect(result.decision.audit_id).toBeNull();
    expect(result.attest).toBeNull();
    expect(callsTo(calls, ATTEST_PATH)).toHaveLength(0);
  });

  it('defaults rendered to false on suppress and lets finish override it', async () => {
    const suppress = routedFetch({ evaluate: () => jsonResponse(200, SUPPRESS_BODY) });
    const stream = forStream(clientWith(suppress.fetch), REQUEST);
    stream.onChunk(JOINED);
    await stream.finish();
    expect(bodyOf(callsTo(suppress.calls, ATTEST_PATH)[0]!)['rendered']).toBe(false);

    const serve = routedFetch();
    const second = forStream(clientWith(serve.fetch), REQUEST, { rendered: true });
    second.onChunk(JOINED);
    await second.finish({ rendered: false });
    expect(bodyOf(callsTo(serve.calls, ATTEST_PATH)[0]!)['rendered']).toBe(false);
  });

  it('passes the decision to a rendered predicate at finish time', async () => {
    const { fetch, calls } = routedFetch();
    const stream = forStream(clientWith(fetch), REQUEST, {
      rendered: (decision) => decision.decision === 'serve',
    });
    stream.onChunk(JOINED);
    await stream.finish();
    expect(bodyOf(callsTo(calls, ATTEST_PATH)[0]!)['rendered']).toBe(true);
  });
});
