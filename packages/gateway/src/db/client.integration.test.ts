import { describe, expect, it } from 'vitest';

import { createDb, DEFAULT_LOCK_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS } from './client.js';
import { requireTestDatabaseUrl } from './test-support.js';

/** Every session carries the two timeouts so a wedged query or lock holder errors instead of hanging. */
const url = requireTestDatabaseUrl();

/** The session value in its base unit (ms); current_setting() would pretty-print 2000 as 2s. */
const setting = async (name: string, options = {}): Promise<string> => {
  const handle = createDb(url, { max: 1, ...options });
  try {
    const [row] = await handle.sql<{ setting: string }[]>`
      select setting from pg_settings where name = ${name}
    `;
    return row?.setting ?? '';
  } finally {
    await handle.close();
  }
};

describe('createDb session timeouts', () => {
  it('applies the defaults to every connection', async () => {
    expect(await setting('statement_timeout')).toBe(String(DEFAULT_STATEMENT_TIMEOUT_MS));
    expect(await setting('lock_timeout')).toBe(String(DEFAULT_LOCK_TIMEOUT_MS));
  });

  it('takes the configured values and 0 for none', async () => {
    expect(await setting('statement_timeout', { statementTimeoutMs: 250 })).toBe('250');
    expect(await setting('lock_timeout', { lockTimeoutMs: 0 })).toBe('0');
  });

  it('cancels a statement that outlives statement_timeout', async () => {
    const handle = createDb(url, { max: 1, statementTimeoutMs: 100 });
    try {
      const started = Date.now();
      await expect(handle.sql`select pg_sleep(2)`).rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      await handle.close();
    }
  });
});
