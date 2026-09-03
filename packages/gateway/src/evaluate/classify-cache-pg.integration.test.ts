import { createLruCache, failClosedClassification } from '@adgate/core';
import type { Classification } from '@adgate/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { classifyCache } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { createLayeredClassifyCache, createPgClassifyCache } from './classify-cache-pg.js';

const url = requireTestDatabaseUrl();
let handle: DbHandle;
let lines: string[];
const log = () => {
  const logs = collectLogs();
  lines = logs.lines;
  return createLogger({ level: 'debug' }, logs.stream);
};

const KEY = `sha256:${'1'.repeat(64)}`;
const VALUE: Classification = {
  ...failClosedClassification(),
  commercial_intent: 0.8,
  confidence: 0.9,
  method: 'llm',
};

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 2 });
});

beforeEach(async () => {
  await truncateAllTables(handle.sql);
});

afterAll(async () => {
  await handle.close();
});

describe('createPgClassifyCache', () => {
  it('round-trips a classification and upserts on the same key', async () => {
    const pg = createPgClassifyCache(handle.db);
    const logger = log();
    expect(await pg.get(KEY, logger)).toBeUndefined();
    await pg.set(KEY, VALUE, logger);
    expect(await pg.get(KEY, logger)).toEqual(VALUE);
    await pg.set(KEY, { ...VALUE, confidence: 0.5 }, logger);
    expect((await pg.get(KEY, logger))?.confidence).toBe(0.5);
    expect(await handle.db.select().from(classifyCache)).toHaveLength(1);
  });

  it('expires rows after the TTL by the injected clock', async () => {
    let t = 1_000_000;
    const pg = createPgClassifyCache(handle.db, { now: () => t, ttlMs: 600_000 });
    const logger = log();
    await pg.set(KEY, VALUE, logger);
    t += 599_999;
    expect(await pg.get(KEY, logger)).toEqual(VALUE);
    t += 2;
    expect(await pg.get(KEY, logger)).toBeUndefined();
  });

  it('ignores a row that is not a Classification', async () => {
    await handle.db.insert(classifyCache).values({
      hash: KEY,
      classification: { nope: true } as unknown as Classification,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const pg = createPgClassifyCache(handle.db);
    expect(await pg.get(KEY, log())).toBeUndefined();
    expect(lines.some((line) => line.includes('not a Classification'))).toBe(true);
  });

  it('swallows database errors on both paths and logs the error name only', async () => {
    const closed = createDb(url, { max: 1 });
    await closed.close();
    const pg = createPgClassifyCache(closed.db);
    const logger = log();
    expect(await pg.get(KEY, logger)).toBeUndefined();
    await expect(pg.set(KEY, VALUE, logger)).resolves.toBeUndefined();
    const warnings = lines.filter((line) => line.includes('"level":40'));
    expect(warnings).toHaveLength(2);
    expect(warnings.every((line) => line.includes('"error_name":'))).toBe(true);
  });
});

describe('createLayeredClassifyCache', () => {
  it('reports lru, pg or miss and writes through to Postgres', async () => {
    const lru = createLruCache();
    const layered = createLayeredClassifyCache(lru, createPgClassifyCache(handle.db));
    const logger = log();

    const miss = await layered.open(KEY, logger);
    expect(miss.source).toBe('miss');
    expect(miss.cache.get(KEY)).toBeUndefined();
    miss.cache.set(KEY, VALUE);
    expect(miss.cache.get(KEY)).toEqual(VALUE);
    await miss.flush();
    expect(await handle.db.select().from(classifyCache)).toHaveLength(1);

    expect((await layered.open(KEY, logger)).source).toBe('lru');
    layered.clear();
    const fromPg = await layered.open(KEY, logger);
    expect(fromPg.source).toBe('pg');
    expect(fromPg.cache.get(KEY)).toEqual(VALUE);
    expect(lru.get(KEY)).toEqual(VALUE);
  });
});
