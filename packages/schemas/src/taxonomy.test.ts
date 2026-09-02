import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CATEGORIES_TAXONOMY,
  ContentCategory,
  SENSITIVE_TAXONOMY,
  SensitiveCategory,
} from './taxonomy.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/classify-fixtures.json', import.meta.url), 'utf8'),
) as { sensitive_taxonomy: string[]; categories_taxonomy: string[] };

describe('taxonomy', () => {
  it('SENSITIVE_TAXONOMY equals fixtures/classify-fixtures.json sensitive_taxonomy', () => {
    expect([...SENSITIVE_TAXONOMY]).toEqual(fixture.sensitive_taxonomy);
  });

  it('CATEGORIES_TAXONOMY equals fixtures/classify-fixtures.json categories_taxonomy', () => {
    expect([...CATEGORIES_TAXONOMY]).toEqual(fixture.categories_taxonomy);
  });

  it('SensitiveCategory accepts every taxonomy entry and nothing else', () => {
    for (const name of fixture.sensitive_taxonomy) {
      expect(SensitiveCategory.safeParse(name).success).toBe(true);
    }
    expect(SensitiveCategory.safeParse('unknown').success).toBe(false);
    expect(SensitiveCategory.safeParse('Health').success).toBe(false);
  });

  it('ContentCategory accepts every taxonomy entry and nothing else', () => {
    for (const name of fixture.categories_taxonomy) {
      expect(ContentCategory.safeParse(name).success).toBe(true);
    }
    expect(ContentCategory.safeParse('software').success).toBe(false);
  });
});
