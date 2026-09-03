import type { Classification } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { sha256Prefixed } from '../audit/crypto.js';
import {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  classifyCacheKey,
  createLruCache,
} from './cache.js';
import { PROMPT_VERSION } from './llm/prompt.js';
import { RULES_VERSION } from './rules/version.js';
import type { ClassifyPolicy } from './types.js';

const entry = (confidence: number): Classification => ({
  commercial_intent: 0.5,
  categories: ['general'],
  sensitive: [],
  confidence,
  method: 'llm',
  prompt_version: 'sha256:x',
});

const clock = (start = 0) => {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
};

describe('createLruCache', () => {
  it('defaults to 50k entries and a 10 minute ttl (docs/BUILD_GUIDE.md)', () => {
    expect(DEFAULT_CACHE_MAX_ENTRIES).toBe(50_000);
    expect(DEFAULT_CACHE_TTL_MS).toBe(600_000);
    expect(createLruCache().size).toBe(0);
  });

  it('misses on unknown keys and round-trips a stored value', () => {
    const cache = createLruCache();
    expect(cache.get('a')).toBeUndefined();
    const value = entry(0.9);
    cache.set('a', value);
    expect(cache.get('a')).toBe(value);
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry on overflow', () => {
    const cache = createLruCache({ maxEntries: 2 });
    cache.set('a', entry(0.1));
    cache.set('b', entry(0.2));
    expect(cache.get('a')).toEqual(entry(0.1)); // a is now more recent than b
    cache.set('c', entry(0.3));
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual(entry(0.1));
    expect(cache.get('c')).toEqual(entry(0.3));
  });

  it('treats an overwrite as a fresh insertion', () => {
    const cache = createLruCache({ maxEntries: 2 });
    cache.set('a', entry(0.1));
    cache.set('b', entry(0.2));
    cache.set('a', entry(0.15));
    cache.set('c', entry(0.3));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual(entry(0.15));
    expect(cache.size).toBe(2);
  });

  it('expires entries after ttlMs on the injected clock and removes them', () => {
    const { now, tick } = clock(1_000);
    const cache = createLruCache({ ttlMs: 600_000, now });
    cache.set('a', entry(0.5));
    tick(599_999);
    expect(cache.get('a')).toEqual(entry(0.5));
    tick(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('gives a re-set key a fresh ttl and a get does not extend it', () => {
    const { now, tick } = clock();
    const cache = createLruCache({ ttlMs: 100, now });
    cache.set('a', entry(0.5));
    tick(60);
    expect(cache.get('a')).toBeDefined();
    tick(40);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', entry(0.6));
    tick(99);
    expect(cache.get('a')).toEqual(entry(0.6));
  });

  it('supports delete and clear', () => {
    const cache = createLruCache();
    cache.set('a', entry(0.1));
    cache.set('b', entry(0.2));
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('b')).toBeUndefined();
  });

  it('rejects invalid options at construction, never on the request path', () => {
    expect(() => createLruCache({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => createLruCache({ maxEntries: 1.5 })).toThrow(RangeError);
    expect(() => createLruCache({ ttlMs: 0 })).toThrow(RangeError);
    expect(() => createLruCache({ ttlMs: Number.NaN })).toThrow(RangeError);
    expect(() => createLruCache({ maxEntries: 1, ttlMs: 1 })).not.toThrow();
  });
});

describe('classifyCacheKey', () => {
  const strict: ClassifyPolicy = { sensitive_detection: 'strict', min_confidence: 0.7 };

  it('is sha256 over the normalized text, both classifier versions and the merge policy', () => {
    expect(classifyCacheKey('Which Postgres host?', strict)).toBe(
      sha256Prefixed(
        ['which postgres host', PROMPT_VERSION, RULES_VERSION, 'strict', '0.7'].join('\n'),
      ),
    );
    expect(classifyCacheKey('anything', strict)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('ignores case, punctuation and whitespace differences', () => {
    expect(classifyCacheKey('Hello,   World!', strict)).toBe(
      classifyCacheKey('hello world', strict),
    );
  });

  it('changes with the text and with the policy inputs that affect the merge', () => {
    const base = classifyCacheKey('hello world', strict);
    expect(classifyCacheKey('hello there', strict)).not.toBe(base);
    expect(
      classifyCacheKey('hello world', { ...strict, sensitive_detection: 'balanced' }),
    ).not.toBe(base);
    expect(classifyCacheKey('hello world', { ...strict, min_confidence: 0.8 })).not.toBe(base);
  });
});
