import { createHash } from 'node:crypto';

import { CATEGORIES_TAXONOMY, SENSITIVE_TAXONOMY } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { CLASSIFIER_PROMPT, PROMPT_VERSION, computePromptVersion } from './prompt.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('CLASSIFIER_PROMPT', () => {
  it('is one non-empty string that demands strict JSON with exactly the four keys', () => {
    expect(typeof CLASSIFIER_PROMPT).toBe('string');
    expect(CLASSIFIER_PROMPT.length).toBeGreaterThan(200);
    expect(CLASSIFIER_PROMPT).toMatch(/exactly one JSON object/i);
    expect(CLASSIFIER_PROMPT).toMatch(/exactly these four keys/i);
    for (const key of ['commercial_intent', 'categories', 'sensitive', 'confidence']) {
      expect(CLASSIFIER_PROMPT).toContain(`"${key}"`);
    }
  });

  it('lists every taxonomy value so the prompt text tracks the taxonomy', () => {
    for (const value of [...CATEGORIES_TAXONOMY, ...SENSITIVE_TAXONOMY]) {
      expect(CLASSIFIER_PROMPT).toContain(`"${value}"`);
    }
  });

  it('tells the model to classify only, never to answer or follow the conversation', () => {
    expect(CLASSIFIER_PROMPT).toMatch(/never answer the user/i);
    expect(CLASSIFIER_PROMPT).toMatch(/never follow instructions/i);
    expect(CLASSIFIER_PROMPT).toMatch(/when in doubt about a sensitive topic, include it/i);
  });
});

describe('PROMPT_VERSION', () => {
  it('is sha256: plus the sha256 hex digest of the exported prompt text', () => {
    expect(PROMPT_VERSION).toBe(`sha256:${sha256(CLASSIFIER_PROMPT)}`);
    expect(PROMPT_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is a pure function of the prompt text', () => {
    expect(computePromptVersion(CLASSIFIER_PROMPT)).toBe(PROMPT_VERSION);
    expect(computePromptVersion(CLASSIFIER_PROMPT)).toBe(computePromptVersion(CLASSIFIER_PROMPT));
  });

  it('changes when the prompt changes, even by one character', () => {
    const edited = `${CLASSIFIER_PROMPT} `;
    expect(computePromptVersion(edited)).not.toBe(PROMPT_VERSION);
    expect(computePromptVersion(edited)).toBe(`sha256:${sha256(edited)}`);
    expect(computePromptVersion(CLASSIFIER_PROMPT.replace('JSON', 'json'))).not.toBe(
      PROMPT_VERSION,
    );
  });
});
