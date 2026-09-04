import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { rateLimits } from '../db/schema.js';
import { requireTestDatabaseUrl, truncateAllTables } from '../db/test-support.js';
import { takeToken } from './limiter.js';
import { createPgRateLimiter } from './pg.js';

/** The Postgres bucket against the real table: the same numbers as takeToken, atomically. */
const url = requireTestDatabaseUrl();
let handle: DbHandle;
const T0 = new Date('2026-09-03T12:00:00.000Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const opts = { rps: 5, burst: 3 };

beforeAll(async () => {
  await runMigrations(url);
  handle = createDb(url, { max: 6 });
  await truncateAllTables(handle.sql);
});

beforeEach(async () => {
  await handle.db.delete(rateLimits);
});

afterAll(() => handle.close());

const row = async (key: string) => {
  const [found] = await handle.db.select().from(rateLimits).where(eq(rateLimits.keyId, key));
  return found;
};

describe('createPgRateLimiter', () => {
  it('rejects a bad bucket up front', () => {
    expect(() => createPgRateLimiter(handle.db, { rps: 0, burst: 1 })).toThrow(TypeError);
  });

  it('allows burst takes, refuses the next with Retry-After, and refills over time', async () => {
    const limiter = createPgRateLimiter(handle.db, opts);
    const decisions = [];
    for (let index = 0; index < 4; index += 1) {
      decisions.push(await limiter.take('key_a', T0));
    }
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions[3]?.retry_after_s).toBe(1);
    expect((await row('key_a'))?.tokens).toBe(-1);

    // 200 ms at 5 rps is one token; the refusal above cost nothing.
    expect(await limiter.take('key_a', at(200))).toEqual({
      allowed: true,
      retry_after_s: 0,
      remaining: 0,
    });
    expect(await limiter.take('key_a', at(300))).toMatchObject({ allowed: false });
    // A long pause tops up to burst, never beyond.
    const later = [];
    for (let index = 0; index < 4; index += 1) {
      later.push((await limiter.take('key_a', at(60_000))).allowed);
    }
    expect(later).toEqual([true, true, true, false]);
    expect((await row('key_a'))?.updatedAt).toEqual(at(60_000));
  });

  it('matches takeToken step for step, fractional clocks included', async () => {
    const limiter = createPgRateLimiter(handle.db, { rps: 0.7, burst: 2 });
    let state = null;
    for (const ms of [0, 0, 150, 1_337, 2_000, 2_001, 9_999]) {
      const expected = takeToken(state, at(ms), { rps: 0.7, burst: 2 });
      state = expected.state;
      expect(await limiter.take('key_b', at(ms)), `t+${ms}`).toEqual(expected.decision);
      expect((await row('key_b'))?.tokens, `t+${ms}`).toBeCloseTo(state.tokens, 9);
    }
  });

  it('never refills on a clock that went backwards and keeps the later timestamp', async () => {
    const limiter = createPgRateLimiter(handle.db, opts);
    for (let index = 0; index < 3; index += 1) {
      await limiter.take('key_c', T0);
    }
    expect((await limiter.take('key_c', at(-5_000))).allowed).toBe(false);
    expect((await row('key_c'))?.updatedAt).toEqual(T0);
  });

  it('keeps one bucket per key', async () => {
    const limiter = createPgRateLimiter(handle.db, { rps: 1, burst: 1 });
    expect((await limiter.take('key_d', T0)).allowed).toBe(true);
    expect((await limiter.take('key_d', T0)).allowed).toBe(false);
    expect((await limiter.take('key_e', T0)).allowed).toBe(true);
  });

  it('allows exactly burst of ten concurrent takes on a new key (one atomic upsert each)', async () => {
    const limiter = createPgRateLimiter(handle.db, opts);
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => limiter.take('key_f', T0)),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
    expect(decisions.filter((d) => !d.allowed)).toHaveLength(7);
    expect((await row('key_f'))?.tokens).toBe(-1);
  });

  it('rejects when the table is gone, which the middleware treats as allow-and-warn', async () => {
    const limiter = createPgRateLimiter(handle.db, opts);
    await handle.sql.unsafe('alter table rate_limits rename to rate_limits_gone');
    try {
      await expect(limiter.take('key_g', T0)).rejects.toThrow();
    } finally {
      await handle.sql.unsafe('alter table rate_limits_gone rename to rate_limits');
    }
  });
});
