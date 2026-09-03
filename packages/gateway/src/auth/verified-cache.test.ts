import { describe, expect, it } from 'vitest';

import type { AuthContext } from '../app-env.js';
import { createVerifiedKeyCache } from './verified-cache.js';

const auth = (key_id = 'key_1'): AuthContext => ({
  key_id,
  app_id: 'app_1',
  role: 'app',
  advertiser_id: null,
});

const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
};

describe('createVerifiedKeyCache', () => {
  it('answers the same prefix and secret and misses on any other secret', () => {
    const cache = createVerifiedKeyCache();
    cache.set('prefix', 'secret-1', auth());
    expect(cache.get('prefix', 'secret-1')).toEqual(auth());
    expect(cache.get('prefix', 'secret-2')).toBeUndefined();
    expect(cache.get('other', 'secret-1')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('hands out copies, never its own entry', () => {
    const cache = createVerifiedKeyCache();
    const stored = auth();
    cache.set('prefix', 'secret', stored);
    stored.key_id = 'key_mutated';
    const first = cache.get('prefix', 'secret');
    expect(first?.key_id).toBe('key_1');
    if (first !== undefined) {
      first.key_id = 'key_mutated_again';
    }
    expect(cache.get('prefix', 'secret')?.key_id).toBe('key_1');
  });

  it('expires entries after the ttl on the injected clock', () => {
    const { now, tick } = clock();
    const cache = createVerifiedKeyCache({ ttlMs: 60_000, now });
    cache.set('prefix', 'secret', auth());
    tick(59_999);
    expect(cache.get('prefix', 'secret')).toBeDefined();
    tick(1);
    expect(cache.get('prefix', 'secret')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('invalidates every entry of a key id and nothing else', () => {
    const cache = createVerifiedKeyCache();
    cache.set('p1', 's1', auth('key_1'));
    cache.set('p1', 's1-rotated', auth('key_1'));
    cache.set('p2', 's2', auth('key_2'));
    cache.invalidate('key_1');
    expect(cache.size).toBe(1);
    expect(cache.get('p1', 's1')).toBeUndefined();
    expect(cache.get('p2', 's2')?.key_id).toBe('key_2');
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entry past maxEntries', () => {
    const cache = createVerifiedKeyCache({ maxEntries: 2 });
    cache.set('p1', 's', auth('key_1'));
    cache.set('p2', 's', auth('key_2'));
    cache.set('p3', 's', auth('key_3'));
    expect(cache.size).toBe(2);
    expect(cache.get('p1', 's')).toBeUndefined();
    expect(cache.get('p3', 's')?.key_id).toBe('key_3');
  });

  it('rejects a non-positive ttl or size at construction', () => {
    expect(() => createVerifiedKeyCache({ ttlMs: 0 })).toThrow(RangeError);
    expect(() => createVerifiedKeyCache({ maxEntries: 0 })).toThrow(RangeError);
  });
});
