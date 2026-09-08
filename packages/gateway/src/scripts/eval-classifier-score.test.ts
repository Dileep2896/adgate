import type { ClassifyFixtureCase } from '@adgateio/schemas';
import { describe, expect, it } from 'vitest';

import {
  bandOf,
  type EvalObservation,
  type EvalResult,
  exitCodeFor,
  failuresOf,
  groupOf,
  hasListedCategory,
  isServable,
  renderJson,
  renderReport,
  scoreCase,
  type ServeGates,
  summarize,
  withinBand,
} from './eval-classifier-score.js';

/**
 * The evaluator's own arithmetic, on hand-built inputs: a tool that scores a model must not be
 * able to report a pass by accident. The run itself needs a key and the network and is not
 * tested here (that is the point of the command).
 */

const fixture = (
  id: string,
  expect_: Partial<ClassifyFixtureCase['expect']> = {},
): ClassifyFixtureCase => ({
  id,
  text: `text for ${id}`,
  expect: { sensitive: [], ...expect_ },
});

const observed = (over: Partial<EvalObservation> = {}): EvalObservation => ({
  commercial_intent: 0.9,
  categories: ['general'],
  sensitive: [],
  confidence: 0.9,
  method: 'llm',
  source: 'merged',
  latency_ms: 100,
  ...over,
});

/** The PolicyConfig defaults the real command scores against. */
const GATES: ServeGates = { min_confidence: 0.7, min_commercial_intent: 0.6 };

const result = (f: ClassifyFixtureCase, over: Partial<EvalObservation> = {}): EvalResult => ({
  fixture: f,
  observed: observed(over),
});

const OPTIONS = { model: 'test-model', baseUrl: 'https://example.test/v1', gates: GATES };

describe('groupOf', () => {
  it('reads the group off the fixture id prefix', () => {
    expect(groupOf('s001')).toBe('sensitive');
    expect(groupOf('c001')).toBe('serve');
    expect(groupOf('l001')).toBe('low');
    expect(groupOf('x999')).toBe('low');
  });
});

describe('bandOf and withinBand', () => {
  it('widens a missing bound to the full range', () => {
    expect(bandOf(fixture('c001'))).toEqual({ min: 0, max: 1 });
    expect(bandOf(fixture('c001', { intent_min: 0.6 }))).toEqual({ min: 0.6, max: 1 });
    expect(bandOf(fixture('s001', { intent_min: 0, intent_max: 0.2 }))).toEqual({
      min: 0,
      max: 0.2,
    });
  });

  it('is inclusive at both bounds', () => {
    const c = fixture('c001', { intent_min: 0.6, intent_max: 1 });
    expect(withinBand(c, 0.6)).toBe(true);
    expect(withinBand(c, 1)).toBe(true);
    expect(withinBand(c, 0.59)).toBe(false);
  });

  it('holds the sensitive cap: 0.2 passes, 0.21 does not, self_harm must be 0', () => {
    const capped = fixture('s010', { sensitive: ['finance'], intent_min: 0, intent_max: 0.2 });
    expect(withinBand(capped, 0.2)).toBe(true);
    expect(withinBand(capped, 0.21)).toBe(false);
    const selfHarm = fixture('s026', { sensitive: ['self_harm'], intent_min: 0, intent_max: 0 });
    expect(withinBand(selfHarm, 0)).toBe(true);
    expect(withinBand(selfHarm, 0.1)).toBe(false);
  });
});

describe('hasListedCategory', () => {
  it('passes when the case lists none and when at least one is present', () => {
    expect(hasListedCategory(fixture('c001'), [])).toBe(true);
    const c = fixture('c001', { categories_any: ['software.devtools.database'] });
    expect(hasListedCategory(c, ['general', 'software.devtools.database'])).toBe(true);
    expect(hasListedCategory(c, ['general'])).toBe(false);
  });
});

describe('scoreCase', () => {
  it('lists the expected sensitive categories that are missing', () => {
    const c = fixture('s008', { sensitive: ['health', 'finance'], intent_min: 0, intent_max: 0.2 });
    const score = scoreCase(result(c, { sensitive: ['health'], commercial_intent: 0.1 }), GATES);
    expect(score.missingSensitive).toEqual(['finance']);
    expect(score.falseSensitive).toEqual([]);
    expect(score.bandOk).toBe(true);
    expect(score.categoryOk).toBeNull();
  });

  it('counts a flag on a non-sensitive case as a false positive, never a miss', () => {
    const score = scoreCase(result(fixture('l006'), { sensitive: ['health'] }), GATES);
    expect(score.falseSensitive).toEqual(['health']);
    expect(score.missingSensitive).toEqual([]);
  });

  it('reports a category miss only for cases that list categories_any', () => {
    const c = fixture('c001', { categories_any: ['software.devtools.database'] });
    expect(scoreCase(result(c), GATES).categoryOk).toBe(false);
    expect(scoreCase(result(fixture('c025')), GATES).categoryOk).toBeNull();
  });
});

describe('multi-turn cases', () => {
  const multi: ClassifyFixtureCase = {
    id: 's099',
    text: 'which meal kit should I order',
    messages: [
      { role: 'user', content: 'I was diagnosed with type 2 diabetes' },
      { role: 'assistant', content: 'smaller portions of slower carbohydrates help' },
      { role: 'user', content: 'which meal kit should I order' },
    ],
    expect: { sensitive: ['health'], intent_min: 0, intent_max: 0.2 },
  };

  it('counts the turns on the score and the multi-turn cases in the summary', () => {
    expect(
      scoreCase(result(multi, { sensitive: ['health'], commercial_intent: 0.1 }), GATES).turns,
    ).toBe(3);
    expect(scoreCase(result(fixture('c001')), GATES).turns).toBe(1);
    const summary = summarize(
      [result(multi, { sensitive: ['health'], commercial_intent: 0.1 }), result(fixture('c001'))],
      OPTIONS,
    );
    expect(summary.multi_turn).toBe(1);
    expect(summary.cases).toBe(2);
  });

  it('marks a multi-turn miss with its turn count, so the quoted sentence is not misread', () => {
    const report = renderReport(summarize([result(multi, { commercial_intent: 0.9 })], OPTIONS));
    expect(report).toContain('s099  missing health');
    expect(report).toContain('(3 turns)');
    expect(report).toContain('multi-turn cases     1 of 1');
  });
});

describe('summarize', () => {
  const cases: EvalResult[] = [
    result(fixture('s001', { sensitive: ['health'], intent_min: 0, intent_max: 0.2 }), {
      sensitive: ['health'],
      commercial_intent: 0.2,
      source: 'rules_short_circuit',
      method: 'rules',
      latency_ms: 2,
    }),
    result(fixture('s008', { sensitive: ['health', 'finance'], intent_min: 0, intent_max: 0.2 }), {
      sensitive: ['health'],
      commercial_intent: 0.1,
      source: 'rules_short_circuit',
      method: 'rules',
      latency_ms: 3,
    }),
    result(
      fixture('c001', {
        categories_any: ['software.devtools.database'],
        intent_min: 0.6,
        intent_max: 1,
      }),
      { commercial_intent: 0.9, categories: ['software.devtools.database'], latency_ms: 800 },
    ),
    result(fixture('l001', { intent_min: 0, intent_max: 0.3 }), {
      commercial_intent: 0.9,
      latency_ms: 1200,
    }),
  ];

  it('counts recall over expected (case, category) pairs and over cases', () => {
    const summary = summarize(cases, OPTIONS);
    expect(summary.sensitive).toEqual({
      recalled_cases: 1,
      cases: 2,
      found_categories: 2,
      expected_categories: 3,
      recall: 0.667,
    });
  });

  it('counts bands, categories, groups and false positives', () => {
    const summary = summarize(cases, OPTIONS);
    expect(summary.cases).toBe(4);
    expect(summary.by_group).toEqual({ sensitive: 2, serve: 1, low: 1 });
    // l001 asked for <= 0.3 and got 0.9; the other three are inside their bands.
    expect(summary.bands).toEqual({ ok: 3, checked: 4 });
    expect(summary.categories).toEqual({ ok: 1, checked: 1 });
    expect(summary.false_positives).toEqual({ cases: 0, checked: 2 });
  });

  it('reports the source and method distribution so a rules-only run is obvious', () => {
    const summary = summarize(cases, OPTIONS);
    expect(summary.sources).toEqual({ rules_short_circuit: 2, merged: 2 });
    expect(summary.methods).toEqual({ rules: 2, llm: 2 });
    expect(summary.llm_failures).toEqual({});
  });

  it('tallies llm failures when every call fell back to rules', () => {
    const timedOut = cases.map((c) =>
      result(c.fixture, { source: 'rules_fallback', method: 'rules', llm_failure: 'timeout' }),
    );
    const summary = summarize(timedOut, OPTIONS);
    expect(summary.llm_failures).toEqual({ timeout: 4 });
    expect(summary.methods).toEqual({ rules: 4 });
  });

  it('reports mean and p95 latency', () => {
    const summary = summarize(cases, OPTIONS);
    expect(summary.latency).toEqual({ mean_ms: 501, p95_ms: 1200, samples: 4 });
  });

  it('keeps every case in per_case and collects the misses in fixture order', () => {
    const summary = summarize(cases, OPTIONS);
    expect(summary.per_case.map((score) => score.id)).toEqual(['s001', 's008', 'c001', 'l001']);
    expect(failuresOf(summary).map((score) => score.id)).toEqual(['s008', 'l001']);
  });

  it('is empty-safe', () => {
    const summary = summarize([], OPTIONS);
    expect(summary.cases).toBe(0);
    expect(summary.sensitive.recall).toBe(1);
    expect(summary.latency).toEqual({ mean_ms: 0, p95_ms: 0, samples: 0 });
    expect(exitCodeFor(summary)).toBe(0);
  });
});

describe('exitCodeFor', () => {
  const perfect = result(fixture('s001', { sensitive: ['health'] }), {
    sensitive: ['health'],
    commercial_intent: 0,
  });

  it('is 1 when a sensitive case lost an expected category', () => {
    const missed = result(fixture('s001', { sensitive: ['health'] }), { commercial_intent: 0 });
    expect(exitCodeFor(summarize([missed], OPTIONS))).toBe(1);
    expect(renderReport(summarize([missed], OPTIONS))).toContain('fails the run');
  });

  it('is 0 for band, category and false-positive misses alone', () => {
    const bandMiss = result(fixture('l001', { intent_min: 0, intent_max: 0.2 }), {
      commercial_intent: 0.9,
    });
    const categoryMiss = result(fixture('c001', { categories_any: ['software.security'] }));
    const falsePositive = result(fixture('l002'), { sensitive: ['health'] });
    const summary = summarize([perfect, bandMiss, categoryMiss, falsePositive], OPTIONS);
    expect(failuresOf(summary)).toHaveLength(3);
    expect(exitCodeFor(summary)).toBe(0);
  });
});

describe('isServable and the servable counts', () => {
  it('needs all three gates: no sensitive flag, confidence and intent at the floor', () => {
    expect(isServable(observed(), GATES)).toBe(true);
    expect(isServable(observed({ sensitive: ['health'] }), GATES)).toBe(false);
    expect(isServable(observed({ confidence: 0.69 }), GATES)).toBe(false);
    expect(isServable(observed({ confidence: 0.7 }), GATES)).toBe(true);
    expect(isServable(observed({ commercial_intent: 0.59 }), GATES)).toBe(false);
    expect(isServable(observed({ commercial_intent: 0.6 }), GATES)).toBe(true);
  });

  it('is what the merge confidence rule moves: 0.6 suppresses, 0.9 serves', () => {
    // The CLASSIFIER-CONFIDENCE change, as the evaluator sees it. Same classification, same
    // intent; only the merged confidence differs.
    const c = fixture('c027', { intent_min: 0.6, intent_max: 1 });
    expect(scoreCase(result(c, { confidence: 0.6 }), GATES).servable).toBe(false);
    expect(scoreCase(result(c, { confidence: 0.9 }), GATES).servable).toBe(true);
  });

  it('counts servable cases per group and reports the gates it used', () => {
    const summary = summarize(
      [
        result(fixture('c001', { intent_min: 0.6, intent_max: 1 })),
        result(fixture('c002', { intent_min: 0.6, intent_max: 1 }), { confidence: 0.5 }),
        result(fixture('l001', { intent_max: 0.4 }), { commercial_intent: 0.1 }),
        result(fixture('s001', { sensitive: ['health'] }), {
          sensitive: ['health'],
          commercial_intent: 0.1,
        }),
      ],
      OPTIONS,
    );
    expect(summary.servable).toEqual({ serve: 1, low: 0, sensitive: 0 });
    expect(summary.gates).toEqual(GATES);
    const report = renderReport(summary);
    expect(report).toContain('would serve          serve 1/2, low 0/1, SENSITIVE 0/1');
    expect(report).toContain('confidence >= 0.70, intent >= 0.60');
    expect(report).not.toContain('must be 0');
  });

  it('marks a sensitive case that would serve, which can only happen after a recall miss', () => {
    const escaped = result(fixture('s001', { sensitive: ['health'] }), { commercial_intent: 0.9 });
    const summary = summarize([escaped], OPTIONS);
    expect(summary.servable.sensitive).toBe(1);
    expect(renderReport(summary)).toContain('SENSITIVE 1/1  <-- must be 0');
    // Losing every flag is already a sensitive miss, so the run had already failed.
    expect(exitCodeFor(summary)).toBe(1);
  });
});

describe('renderReport and renderJson', () => {
  const summary = summarize(
    [
      result(fixture('s001', { sensitive: ['health'], intent_min: 0, intent_max: 0.2 }), {
        commercial_intent: 0.8,
      }),
      result(fixture('c001', { intent_min: 0.6, intent_max: 1 })),
    ],
    OPTIONS,
  );

  it('names the model, every failing case and the exit code', () => {
    const report = renderReport(summary);
    expect(report).toContain('test-model');
    expect(report).toContain('https://example.test/v1');
    expect(report).toContain('s001  missing health');
    expect(report).toContain('0.80 outside [0.00, 0.20]');
    expect(report).toContain('exit code            1');
  });

  it('never prints an api key it was never given', () => {
    expect(renderReport(summary)).not.toMatch(/api[_-]?key/i);
  });

  it('says none for a section with no misses', () => {
    expect(renderReport(summarize([result(fixture('c001'))], OPTIONS))).toContain(
      'sensitive misses: none',
    );
  });

  it('renders parseable JSON carrying the exit code', () => {
    const parsed: unknown = JSON.parse(renderJson(summary));
    expect(parsed).toMatchObject({ model: 'test-model', exit_code: 1 });
  });
});
