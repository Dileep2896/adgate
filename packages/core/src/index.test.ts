import * as schemas from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@adgate/core', () => {
  it('exports the canonical JSON and policy helpers', () => {
    expect(typeof core.canonicalize).toBe('function');
    expect(typeof core.sha256Hex).toBe('function');
    expect(typeof core.sha256Prefixed).toBe('function');
    expect(typeof core.policyHash).toBe('function');
    expect(typeof core.loadPolicyFromYaml).toBe('function');
    expect(typeof core.mergeOverrides).toBe('function');
  });

  it('exports the policy engine and the region helpers', () => {
    expect(typeof core.evaluatePolicy).toBe('function');
    expect(typeof core.isRegionAllowed).toBe('function');
    expect(typeof core.expandRegions).toBe('function');
    expect(core.EU_MEMBER_STATES).toHaveLength(27);
  });

  it('exports the rules classifier', () => {
    expect(typeof core.classifyByRules).toBe('function');
    expect(typeof core.normalizeText).toBe('function');
    expect(typeof core.computeRulesVersion).toBe('function');
    expect(core.RULES_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(core.classifyByRules('best vpn for public wifi').method).toBe('rules');
  });

  it('exports the LLM classifier, its fake and the versioned prompt', () => {
    expect(typeof core.OpenAiCompatibleClassifier).toBe('function');
    expect(typeof core.FakeLlmClassifier).toBe('function');
    expect(typeof core.fakeLlmFromFixtures).toBe('function');
    expect(typeof core.fakeLlmSuccess).toBe('function');
    expect(typeof core.parseLlmContent).toBe('function');
    expect(typeof core.computePromptVersion).toBe('function');
    expect(core.CLASSIFIER_PROMPT.length).toBeGreaterThan(200);
    expect(core.PROMPT_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(core.PROMPT_VERSION).not.toBe(core.RULES_VERSION);
    expect(core.DEFAULT_LLM_TIMEOUT_MS).toBe(400);
    expect(core.LLM_FAILURE_REASONS).toEqual([
      'timeout',
      'parse',
      'invalid',
      'http',
      'network',
      'aborted',
    ]);
  });

  it('exports the classify orchestrator, its cache and text preparation', () => {
    expect(typeof core.classify).toBe('function');
    expect(typeof core.prepareText).toBe('function');
    expect(typeof core.createLruCache).toBe('function');
    expect(typeof core.classifyCacheKey).toBe('function');
    expect(typeof core.mergeClassifications).toBe('function');
    expect(typeof core.failClosedClassification).toBe('function');
    expect(core.DEFAULT_PREPARE_OPTIONS).toEqual({ maxMessages: 4, maxChars: 4000 });
    expect(core.DEFAULT_CACHE_MAX_ENTRIES).toBe(50_000);
    expect(core.DEFAULT_CACHE_TTL_MS).toBe(600_000);
  });

  it('re-exports PolicyValidationError from @adgate/schemas', () => {
    expect(core.PolicyValidationError).toBe(schemas.PolicyValidationError);
  });
});
