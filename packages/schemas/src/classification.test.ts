import { describe, expect, it } from 'vitest';

import { Classification, LlmOutput } from './classification.js';

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

  it('accepts only llm, rules or cached as method and requires prompt_version', () => {
    expect(Classification.safeParse({ ...valid, method: 'llm' }).success).toBe(true);
    expect(Classification.safeParse({ ...valid, method: 'cached' }).success).toBe(true);
    expect(Classification.safeParse({ ...valid, method: 'magic' }).success).toBe(false);
    expect(Classification.safeParse({ ...valid, prompt_version: '' }).success).toBe(false);
  });
});

describe('LlmOutput', () => {
  const raw = {
    commercial_intent: 0.84,
    categories: ['Software.Devtools.Database', 'unknown'],
    sensitive: ['Health'],
    confidence: 0.91,
  };

  it('accepts the four keys with free-form category strings (core normalizes them)', () => {
    expect(LlmOutput.parse(raw)).toEqual(raw);
    expect(LlmOutput.safeParse({ ...raw, categories: [], sensitive: [] }).success).toBe(true);
  });

  it('bounds the two numbers to 0..1 and requires numbers, not numeric strings', () => {
    expect(LlmOutput.safeParse({ ...raw, commercial_intent: 1.01 }).success).toBe(false);
    expect(LlmOutput.safeParse({ ...raw, confidence: -0.1 }).success).toBe(false);
    expect(LlmOutput.safeParse({ ...raw, confidence: '0.9' }).success).toBe(false);
  });

  it('requires every key and rejects non-string list items', () => {
    const missing = { commercial_intent: 0.5, categories: [], sensitive: [] };
    expect(LlmOutput.safeParse(missing).success).toBe(false);
    expect(LlmOutput.safeParse({ ...raw, categories: [1] }).success).toBe(false);
    expect(LlmOutput.safeParse({ ...raw, sensitive: 'health' }).success).toBe(false);
    expect(LlmOutput.safeParse([]).success).toBe(false);
  });

  it('strips unknown keys instead of rejecting them and is not a contract schema', () => {
    const parsed = LlmOutput.parse({ ...raw, reasoning: 'because' });
    expect(parsed).toEqual(raw);
  });
});
