import { describe, expect, it } from 'vitest';

import { createClient } from './client.js';
import {
  API_KEY,
  BASE_URL,
  fakeFetch,
  fakeLogger,
  jsonResponse,
  REQUEST,
  SERVE_BODY,
} from './test-support.js';

describe('evaluate: logging', () => {
  it('warns once per failure with the kind and status, never the request', async () => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => jsonResponse(401, { error: { code: 'unauthorized' } }));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });

    await client.evaluate(REQUEST);

    expect(warnings).toEqual([
      { message: 'adgate evaluate failed', data: { kind: 'http', status: 401 } },
    ]);
    expect(JSON.stringify(warnings)).not.toContain('postgres');
    expect(JSON.stringify(warnings)).not.toContain(API_KEY);
  });

  it('does not warn when the caller aborted on purpose', async () => {
    const { logger, warnings } = fakeLogger();
    const { fetch } = fakeFetch(() => jsonResponse(200, SERVE_BODY));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });
    await client.evaluate(REQUEST, { signal: AbortSignal.abort() });
    expect(warnings).toEqual([]);
  });

  it('survives a logger that throws', async () => {
    const logger = {
      warn: () => {
        throw new Error('logger exploded');
      },
    };
    const { fetch } = fakeFetch(() => Promise.reject(new Error('down')));
    const client = createClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch, logger });
    const result = await client.evaluate(REQUEST);
    expect(result.error).toEqual({ kind: 'network' });
  });
});
