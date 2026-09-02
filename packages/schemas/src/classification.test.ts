import { describe, expect, it } from 'vitest';

import { Classification } from './classification.js';

const valid = {
  commercial_intent: 0.5,
  categories: ['software.devtools.database', 'general'],
  sensitive: ['health'],
  confidence: 0.7,
  method: 'rules',
  prompt_version: 'sha256:abc',
};

describe('Classification', () => {
  it('accepts a full classification', () => {
    expect(Classification.parse(valid)).toEqual(valid);
  });

  it('bounds commercial_intent and confidence to 0..1', () => {
    expect(Classification.safeParse({ ...valid, commercial_intent: 0 }).success).toBe(true);
    expect(Classification.safeParse({ ...valid, commercial_intent: 1 }).success).toBe(true);
    expect(Classification.safeParse({ ...valid, commercial_intent: 1.01 }).success).toBe(false);
    expect(Classification.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
  });

  it('validates categories and sensitive against the taxonomies', () => {
    expect(Classification.safeParse({ ...valid, categories: ['unknown.thing'] }).success).toBe(
      false,
    );
    expect(Classification.safeParse({ ...valid, sensitive: ['unknown'] }).success).toBe(false);
    expect(Classification.safeParse({ ...valid, sensitive: [] }).success).toBe(true);
  });

  it('accepts only llm or rules as method and requires prompt_version', () => {
    expect(Classification.safeParse({ ...valid, method: 'llm' }).success).toBe(true);
    expect(Classification.safeParse({ ...valid, method: 'magic' }).success).toBe(false);
    expect(Classification.safeParse({ ...valid, prompt_version: '' }).success).toBe(false);
  });
});
