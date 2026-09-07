import type { ClassifyFixtureCase } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import { UsageError } from './args.js';
import {
  classifierConfigFromEnv,
  EVAL_CLASSIFIER_USAGE,
  EVAL_POLICY,
  loadFixtureCases,
  parseEvalClassifierArgs,
  selectCases,
} from './eval-classifier.js';

/** The command line, the CLASSIFIER_* reading and the case selection. No network, no key. */

const ENV = {
  CLASSIFIER_BASE_URL: 'https://api.example.test/v1',
  CLASSIFIER_API_KEY: 'sk-not-a-real-key',
  CLASSIFIER_MODEL: 'small-latest',
  CLASSIFIER_TIMEOUT_MS: '2500',
};

describe('parseEvalClassifierArgs', () => {
  it('defaults to the whole fixture set at concurrency 4 and the report format', () => {
    expect(parseEvalClassifierArgs([])).toEqual({
      help: false,
      model: null,
      limit: null,
      concurrency: 4,
      json: false,
    });
  });

  it('reads --model, --limit, --concurrency and --json', () => {
    expect(
      parseEvalClassifierArgs(['--model', 'x-large', '--limit=9', '--concurrency', '2', '--json']),
    ).toEqual({
      help: false,
      model: 'x-large',
      limit: 9,
      concurrency: 2,
      json: true,
    });
  });

  it('rejects a non-positive count and an unknown flag', () => {
    expect(() => parseEvalClassifierArgs(['--limit', '0'])).toThrow(UsageError);
    expect(() => parseEvalClassifierArgs(['--concurrency', '1.5'])).toThrow(UsageError);
    expect(() => parseEvalClassifierArgs(['--models', 'x'])).toThrow(UsageError);
  });

  it('answers --help', () => {
    expect(parseEvalClassifierArgs(['--help'])).toEqual({ help: true });
    expect(EVAL_CLASSIFIER_USAGE).toContain('about 39 calls');
  });
});

describe('classifierConfigFromEnv', () => {
  it('reads the same CLASSIFIER_* variables the gateway reads', () => {
    expect(classifierConfigFromEnv(ENV)).toEqual({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-not-a-real-key',
      model: 'small-latest',
      timeoutMs: 2500,
    });
  });

  it('lets --model override CLASSIFIER_MODEL and supply a missing one', () => {
    expect(classifierConfigFromEnv(ENV, 'other-model').model).toBe('other-model');
    expect(
      classifierConfigFromEnv({ ...ENV, CLASSIFIER_MODEL: undefined }, 'other-model').model,
    ).toBe('other-model');
  });

  it('treats a blank value as unset and defaults the timeout like the gateway', () => {
    const config = classifierConfigFromEnv({
      ...ENV,
      CLASSIFIER_API_KEY: '  ',
      CLASSIFIER_TIMEOUT_MS: '',
    });
    expect(config.apiKey).toBe('');
    expect(config.timeoutMs).toBe(400);
  });

  it('is a usage error with no base url or model, and on an invalid timeout', () => {
    expect(() => classifierConfigFromEnv({ ...ENV, CLASSIFIER_BASE_URL: undefined })).toThrow(
      UsageError,
    );
    expect(() => classifierConfigFromEnv({ ...ENV, CLASSIFIER_MODEL: undefined })).toThrow(
      UsageError,
    );
    expect(() => classifierConfigFromEnv({ ...ENV, CLASSIFIER_TIMEOUT_MS: '-1' })).toThrow(
      UsageError,
    );
  });
});

describe('EVAL_POLICY', () => {
  it('is the PolicyConfig default, so a run matches a default app', () => {
    expect(EVAL_POLICY).toEqual({ sensitive_detection: 'strict', min_confidence: 0.7 });
  });
});

describe('the fixture file', () => {
  const cases = loadFixtureCases();
  const sensitive = cases.filter((c) => c.id.startsWith('s'));

  it('loads all 67 cases', () => {
    expect(cases).toHaveLength(67);
  });

  it('gives every sensitive case the band the merge guarantees (0.2, or 0 for self_harm)', () => {
    expect(sensitive).toHaveLength(28);
    for (const c of sensitive) {
      const expectedMax = c.expect.sensitive.includes('self_harm') ? 0 : 0.2;
      expect(c.expect.intent_min, c.id).toBe(0);
      expect(c.expect.intent_max, c.id).toBe(expectedMax);
    }
  });
});

describe('selectCases', () => {
  const cases: ClassifyFixtureCase[] = ['s1', 's2', 's3', 'c1', 'c2', 'l1', 'l2'].map((id) => ({
    id,
    text: id,
    expect: { sensitive: [] },
  }));

  it('returns every case when there is no limit or the limit is not binding', () => {
    expect(selectCases(cases, null)).toEqual(cases);
    expect(selectCases(cases, 99)).toEqual(cases);
  });

  it('takes a limit round robin across the three groups, in fixture order', () => {
    expect(selectCases(cases, 3).map((c) => c.id)).toEqual(['s1', 'c1', 'l1']);
    expect(selectCases(cases, 5).map((c) => c.id)).toEqual(['s1', 's2', 'c1', 'c2', 'l1']);
  });

  it('keeps drawing from the groups that still have cases', () => {
    expect(selectCases(cases, 6).map((c) => c.id)).toEqual(['s1', 's2', 'c1', 'c2', 'l1', 'l2']);
    const noLowIntent = cases.filter((c) => !c.id.startsWith('l') && c.id !== 'c2');
    expect(selectCases(noLowIntent, 4).map((c) => c.id)).toEqual(['s1', 's2', 's3', 'c1']);
  });

  it('is empty-safe', () => {
    expect(selectCases([], 5)).toEqual([]);
  });
});
