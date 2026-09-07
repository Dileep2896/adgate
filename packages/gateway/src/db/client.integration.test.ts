import { describe, expect, it } from 'vitest';

import { createDb, DEFAULT_LOCK_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS } from './client.js';
import {
  createTestDb,
  requireTestDatabaseUrl,
  TEST_LOCK_TIMEOUT_MS,
  TEST_STATEMENT_TIMEOUT_MS,
} from './test-support.js';

/**
 * Every session carries the two timeouts so a wedged query or lock holder errors instead of
 * hanging. This is the ONE test file that opens its handles with createDb rather than
 * createTestDb (create-db-usage.test.ts holds it as the single exception): its subject is
 * createDb's own production defaults, so routing it through the test factory would test the
 * factory instead.
 */
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

/** The same reading, taken through the factory every other integration test uses. */
const testSetting = async (name: string, options = {}, env = {}): Promise<string> => {
  const handle = createTestDb(url, { max: 1, ...options }, env);
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

describe('createTestDb session timeouts', () => {
  it('gives an integration test headroom over the production budget', async () => {
    expect(TEST_STATEMENT_TIMEOUT_MS).toBeGreaterThan(DEFAULT_STATEMENT_TIMEOUT_MS);
    expect(TEST_LOCK_TIMEOUT_MS).toBeGreaterThan(DEFAULT_LOCK_TIMEOUT_MS);
    // Below vitest's testTimeout (20 s), so a genuine hang is still bounded and still reported
    // as a cancelled statement rather than as a runner timeout.
    expect(TEST_STATEMENT_TIMEOUT_MS).toBeLessThan(20_000);
    expect(TEST_LOCK_TIMEOUT_MS).toBeLessThan(TEST_STATEMENT_TIMEOUT_MS);
    expect(await testSetting('statement_timeout')).toBe(String(TEST_STATEMENT_TIMEOUT_MS));
    expect(await testSetting('lock_timeout')).toBe(String(TEST_LOCK_TIMEOUT_MS));
  });

  it('lets DB_STATEMENT_TIMEOUT_MS / DB_LOCK_TIMEOUT_MS override it, as CI does', async () => {
    const env = { DB_STATEMENT_TIMEOUT_MS: '9000', DB_LOCK_TIMEOUT_MS: '4000' };
    expect(await testSetting('statement_timeout', {}, env)).toBe('9000');
    expect(await testSetting('lock_timeout', {}, env)).toBe('4000');
    // Nonsense in the environment falls back rather than silently disabling the guard.
    expect(await testSetting('statement_timeout', {}, { DB_STATEMENT_TIMEOUT_MS: 'soon' })).toBe(
      String(TEST_STATEMENT_TIMEOUT_MS),
    );
  });

  it('keeps an explicit option, so migrations still run with no timeout at all', async () => {
    expect(await testSetting('statement_timeout', { statementTimeoutMs: 0 })).toBe('0');
    expect(await testSetting('lock_timeout', { lockTimeoutMs: 250 })).toBe('250');
  });
});
