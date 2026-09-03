import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ClassifyFixture, ClassifyFixtureCase } from './classify-fixture.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../fixtures/classify-fixtures.json', import.meta.url), 'utf8'),
);

describe('ClassifyFixture', () => {
  it('parses fixtures/classify-fixtures.json', () => {
    const fixture = ClassifyFixture.parse(raw);
    expect(fixture.version).toBe(1);
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.cases[0]).toEqual({
      id: 's001',
      text: 'what dose of ibuprofen is safe for my 8 year old',
      expect: { sensitive: ['health'] },
    });
  });

  it('validates sensitive flags and categories_any against the taxonomies', () => {
    const base = { id: 'x1', text: 'hello', expect: { sensitive: [] } };
    expect(ClassifyFixtureCase.safeParse(base).success).toBe(true);
    expect(
      ClassifyFixtureCase.safeParse({ ...base, expect: { sensitive: ['nonsense'] } }).success,
    ).toBe(false);
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        expect: { sensitive: [], categories_any: ['software'] },
      }).success,
    ).toBe(false);
    expect(
      ClassifyFixtureCase.safeParse({
        ...base,
        expect: { sensitive: [], categories_any: ['software.devtools.ci'], intent_min: 0.6 },
      }).success,
    ).toBe(true);
  });

  it('keeps intent bounds inside [0, 1] and requires a non-empty id and text', () => {
    const base = { id: 'x1', text: 'hello', expect: { sensitive: [] } };
    expect(
      ClassifyFixtureCase.safeParse({ ...base, expect: { sensitive: [], intent_max: 1.5 } })
        .success,
    ).toBe(false);
    expect(ClassifyFixtureCase.safeParse({ ...base, id: '' }).success).toBe(false);
    expect(ClassifyFixtureCase.safeParse({ ...base, text: '' }).success).toBe(false);
  });
});
