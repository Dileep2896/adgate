import type { ClassifyFixtureCase } from '@adgateio/schemas';

/**
 * The pure scoring half of `eval-classifier` (src/scripts/eval-classifier.ts): fixture case plus
 * what a real model actually returned, in and a report out. Nothing here touches env, the
 * network, the filesystem or the clock, so eval-classifier-score.test.ts can prove the evaluator
 * cannot silently report a pass — the run is the expensive part, the arithmetic is not.
 *
 * The one property that gates the exit code is sensitive recall: every expected sensitive
 * category present on every sensitive case. Intent bands and categories are reported and never
 * fatal; they are a tuning signal, and no model reaches 100 percent on them today.
 *
 * `servable` applies the default policy's three classification gates to each result, so a
 * confidence change (merge.ts) can be measured and not just asserted. A sensitive case can only
 * come out servable by losing every one of its flags, which is already a sensitive miss and
 * already exit code 1; the count is printed so that safety property is visible rather than
 * inferred.
 */

export type EvalGroup = 'sensitive' | 'serve' | 'low';

/**
 * The classification half of the policy engine's serve decision (packages/core policy/evaluate:
 * rules 3, 4 and 5). The other rules are about the request, not the classification, so they
 * cannot be scored from a fixture.
 */
export interface ServeGates {
  min_confidence: number;
  min_commercial_intent: number;
}

/** What one classify() call returned, flattened. Nothing here can carry message text. */
export interface EvalObservation {
  commercial_intent: number;
  categories: readonly string[];
  sensitive: readonly string[];
  /** Classification.confidence, after mergeClassifications. */
  confidence: number;
  /** Classification.method: llm, rules or cached. */
  method: string;
  /** ClassifyOutcome.source: merged, rules_short_circuit, rules_fallback or cache. */
  source: string;
  /** ClassifyOutcome.latency_ms (the whole classify() call, not just the HTTP round trip). */
  latency_ms: number;
  /** ClassifyOutcome.llm_failure when the LLM stage did not contribute. */
  llm_failure?: string | undefined;
}

export interface EvalResult {
  fixture: ClassifyFixtureCase;
  observed: EvalObservation;
}

export interface EvalBand {
  min: number;
  max: number;
}

export interface EvalCaseScore {
  id: string;
  /** The case's `text`: for a multi-turn case, its final user turn, not the whole window. */
  text: string;
  /** Messages classified: 1 for a single-turn case, otherwise the case's own turn count. */
  turns: number;
  group: EvalGroup;
  intent: number;
  confidence: number;
  /** Would pass the default policy's classification gates. Must be false on a sensitive case. */
  servable: boolean;
  band: EvalBand;
  bandOk: boolean;
  /** Expected sensitive categories the classifier did not return. Non-empty = the run fails. */
  missingSensitive: string[];
  /** Sensitive categories on a case that must have none. Reported, never fatal. */
  falseSensitive: string[];
  /** null when the case lists no categories_any. */
  categoryOk: boolean | null;
  source: string;
}

/**
 * Fixture ids are prefixed by intent: s = sensitive (must be flagged), c = commercial (must be
 * servable), l = low intent (must not be). Anything else is treated as low intent, which asserts
 * the least.
 */
export const groupOf = (id: string): EvalGroup => {
  if (id.startsWith('s')) {
    return 'sensitive';
  }
  return id.startsWith('c') ? 'serve' : 'low';
};

/** The declared band, widened to [0, 1] for a case that carries neither bound. */
export const bandOf = (fixture: ClassifyFixtureCase): EvalBand => ({
  min: fixture.expect.intent_min ?? 0,
  max: fixture.expect.intent_max ?? 1,
});

export const withinBand = (fixture: ClassifyFixtureCase, intent: number): boolean => {
  const band = bandOf(fixture);
  return intent >= band.min && intent <= band.max;
};

/** At least one of categories_any present; true when the case lists none, null when scoring. */
export const hasListedCategory = (
  fixture: ClassifyFixtureCase,
  categories: readonly string[],
): boolean =>
  fixture.expect.categories_any === undefined ||
  fixture.expect.categories_any.some((category) => categories.includes(category));

/** No sensitive flag, confidence at the floor, intent at the floor: what a serve needs. */
export const isServable = (observed: EvalObservation, gates: ServeGates): boolean =>
  observed.sensitive.length === 0 &&
  observed.confidence >= gates.min_confidence &&
  observed.commercial_intent >= gates.min_commercial_intent;

export const scoreCase = ({ fixture, observed }: EvalResult, gates: ServeGates): EvalCaseScore => {
  const group = groupOf(fixture.id);
  return {
    id: fixture.id,
    text: fixture.text,
    turns: fixture.messages?.length ?? 1,
    group,
    intent: observed.commercial_intent,
    confidence: observed.confidence,
    servable: isServable(observed, gates),
    band: bandOf(fixture),
    bandOk: withinBand(fixture, observed.commercial_intent),
    missingSensitive: fixture.expect.sensitive.filter(
      (category) => !observed.sensitive.includes(category),
    ),
    falseSensitive: group === 'sensitive' ? [] : [...observed.sensitive],
    categoryOk:
      fixture.expect.categories_any === undefined
        ? null
        : hasListedCategory(fixture, observed.categories),
    source: observed.source,
  };
};

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? 0;
};

const tallyOf = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};

export interface EvalSummary {
  model: string;
  base_url: string;
  cases: number;
  by_group: Record<EvalGroup, number>;
  sensitive: {
    /** Sensitive cases with every expected category present. */
    recalled_cases: number;
    cases: number;
    /** Expected (case, category) pairs found. */
    found_categories: number;
    expected_categories: number;
    /** 0 to 1 over the pairs; 1 is the only passing value. */
    recall: number;
  };
  false_positives: {
    /** Non-sensitive cases that came back with any sensitive flag. */
    cases: number;
    checked: number;
  };
  bands: { ok: number; checked: number };
  categories: { ok: number; checked: number };
  /** The gates `servable` was scored against, so a report states its own thresholds. */
  gates: ServeGates;
  /** Cases per group that would pass those gates. `sensitive` must be 0. */
  servable: Record<EvalGroup, number>;
  /** Cases carrying a `messages` array. Their score is the half a single sentence cannot show. */
  multi_turn: number;
  sources: Record<string, number>;
  methods: Record<string, number>;
  llm_failures: Record<string, number>;
  latency: { mean_ms: number; p95_ms: number; samples: number };
  /**
   * Every case scored, in fixture order. The report prints only the misses (failuresOf); --json
   * carries the whole list so a CI job can trend an individual case's intent over prompt edits,
   * which is finer grained than the pass counts above.
   */
  per_case: EvalCaseScore[];
}

/** The cases the report lists: a sensitive miss, a false positive, a band or a category miss. */
export const failuresOf = (summary: EvalSummary): EvalCaseScore[] =>
  summary.per_case.filter(
    (score) =>
      score.missingSensitive.length > 0 ||
      score.falseSensitive.length > 0 ||
      !score.bandOk ||
      score.categoryOk === false,
  );

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export interface SummarizeOptions {
  model: string;
  baseUrl: string;
  gates: ServeGates;
}

const servableIn = (scores: readonly EvalCaseScore[], group: EvalGroup): number =>
  scores.filter((score) => score.group === group && score.servable).length;

export const summarize = (
  results: readonly EvalResult[],
  { model, baseUrl, gates }: SummarizeOptions,
): EvalSummary => {
  const scores = results.map((result) => scoreCase(result, gates));
  const sensitive = scores.filter((score) => score.group === 'sensitive');
  const nonSensitive = scores.filter((score) => score.group !== 'sensitive');
  const expectedCategories = results
    .filter((result) => groupOf(result.fixture.id) === 'sensitive')
    .reduce((sum, result) => sum + result.fixture.expect.sensitive.length, 0);
  const missedCategories = sensitive.reduce((sum, score) => sum + score.missingSensitive.length, 0);
  const withCategories = scores.filter((score) => score.categoryOk !== null);
  const latencies = results.map((result) => result.observed.latency_ms).sort((a, b) => a - b);
  const mean = latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length;
  return {
    model,
    base_url: baseUrl,
    cases: scores.length,
    by_group: {
      sensitive: sensitive.length,
      serve: scores.filter((score) => score.group === 'serve').length,
      low: scores.filter((score) => score.group === 'low').length,
    },
    sensitive: {
      recalled_cases: sensitive.filter((score) => score.missingSensitive.length === 0).length,
      cases: sensitive.length,
      found_categories: expectedCategories - missedCategories,
      expected_categories: expectedCategories,
      recall:
        expectedCategories === 0
          ? 1
          : round((expectedCategories - missedCategories) / expectedCategories),
    },
    false_positives: {
      cases: nonSensitive.filter((score) => score.falseSensitive.length > 0).length,
      checked: nonSensitive.length,
    },
    bands: { ok: scores.filter((score) => score.bandOk).length, checked: scores.length },
    categories: {
      ok: withCategories.filter((score) => score.categoryOk === true).length,
      checked: withCategories.length,
    },
    gates,
    servable: {
      sensitive: servableIn(scores, 'sensitive'),
      serve: servableIn(scores, 'serve'),
      low: servableIn(scores, 'low'),
    },
    multi_turn: scores.filter((score) => score.turns > 1).length,
    sources: tallyOf(results.map((result) => result.observed.source)),
    methods: tallyOf(results.map((result) => result.observed.method)),
    llm_failures: tallyOf(
      results.flatMap((result) =>
        result.observed.llm_failure === undefined ? [] : [result.observed.llm_failure],
      ),
    ),
    latency: {
      mean_ms: Math.round(mean),
      p95_ms: Math.round(percentile(latencies, 95)),
      samples: latencies.length,
    },
    per_case: scores,
  };
};

/**
 * 1 only when a sensitive category was missed. A band or category miss is a tuning signal, not a
 * broken safety property, so it never fails the command (see the module comment).
 */
export const exitCodeFor = (summary: EvalSummary): 0 | 1 =>
  summary.sensitive.found_categories < summary.sensitive.expected_categories ? 1 : 0;

const pct = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`;

const tallyLine = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `${key} ${String(n)}`)
    .join(', ') || 'none';

const quote = (text: string, width = 62): string =>
  `"${text.length > width ? `${text.slice(0, width - 1)}…` : text}"`;

/**
 * The quoted case text, marked with its turn count when the case is multi-turn: the quoted
 * sentence is only the final user turn, and reading a band miss without knowing that is how you
 * conclude a perfectly good prompt is broken.
 */
const label = (score: EvalCaseScore): string =>
  score.turns > 1 ? `${quote(score.text)} (${String(score.turns)} turns)` : quote(score.text);

const num = (value: number): string => value.toFixed(2);

const listSection = (
  title: string,
  scores: readonly EvalCaseScore[],
  line: (score: EvalCaseScore) => string,
): string[] =>
  scores.length === 0
    ? [`${title}: none`]
    : [`${title} (${String(scores.length)})`, ...scores.map(line)];

export const renderReport = (summary: EvalSummary): string => {
  const failures = failuresOf(summary);
  const missed = failures.filter((score) => score.missingSensitive.length > 0);
  const falsePositive = failures.filter((score) => score.falseSensitive.length > 0);
  const bandMiss = failures.filter((score) => !score.bandOk);
  const categoryMiss = failures.filter((score) => score.categoryOk === false);
  return [
    `adgate eval-classifier: ${String(summary.cases)} fixture cases against ${summary.model} at ${summary.base_url}`,
    '',
    ...(missed.length === 0
      ? ['sensitive misses: none']
      : [
          `sensitive misses (${String(missed.length)})  <-- fails the run`,
          ...missed.map(
            (score) =>
              `  ${score.id}  missing ${score.missingSensitive.join(',')}  ${label(score)}`,
          ),
        ]),
    ...listSection(
      'sensitive false positives',
      falsePositive,
      (score) => `  ${score.id}  flagged ${score.falseSensitive.join(',')}  ${label(score)}`,
    ),
    ...listSection(
      'intent band misses',
      bandMiss,
      (score) =>
        `  ${score.id}  ${num(score.intent)} outside [${num(score.band.min)}, ${num(score.band.max)}]  ${label(score)}`,
    ),
    ...listSection(
      'category misses',
      categoryMiss,
      (score) => `  ${score.id}  no listed category  ${label(score)}`,
    ),
    '',
    'summary',
    `  cases                ${String(summary.cases)} (${String(summary.by_group.sensitive)} sensitive, ${String(summary.by_group.serve)} serve, ${String(summary.by_group.low)} low intent)`,
    `  sensitive recall     ${String(summary.sensitive.found_categories)}/${String(summary.sensitive.expected_categories)} categories on ${String(summary.sensitive.recalled_cases)}/${String(summary.sensitive.cases)} cases (${pct(summary.sensitive.found_categories, summary.sensitive.expected_categories)})`,
    `  sensitive false pos  ${String(summary.false_positives.cases)} of ${String(summary.false_positives.checked)} non-sensitive cases`,
    `  intent bands         ${String(summary.bands.ok)}/${String(summary.bands.checked)} (${pct(summary.bands.ok, summary.bands.checked)})`,
    `  categories           ${String(summary.categories.ok)}/${String(summary.categories.checked)} (${pct(summary.categories.ok, summary.categories.checked)})`,
    `  would serve          serve ${String(summary.servable.serve)}/${String(summary.by_group.serve)}, low ${String(summary.servable.low)}/${String(summary.by_group.low)}, SENSITIVE ${String(summary.servable.sensitive)}/${String(summary.by_group.sensitive)}${summary.servable.sensitive === 0 ? '' : '  <-- must be 0'}`,
    `  serve gates          no sensitive flag, confidence >= ${num(summary.gates.min_confidence)}, intent >= ${num(summary.gates.min_commercial_intent)}`,
    `  multi-turn cases     ${String(summary.multi_turn)} of ${String(summary.cases)}`,
    `  source               ${tallyLine(summary.sources)}`,
    `  method               ${tallyLine(summary.methods)}`,
    `  llm failures         ${tallyLine(summary.llm_failures)}`,
    `  latency              mean ${String(summary.latency.mean_ms)} ms  p95 ${String(summary.latency.p95_ms)} ms  over ${String(summary.latency.samples)} classify() calls`,
    `  exit code            ${String(exitCodeFor(summary))}${exitCodeFor(summary) === 0 ? '' : ' (sensitive recall below 100%)'}`,
    '',
  ].join('\n');
};

export const renderJson = (summary: EvalSummary): string =>
  `${JSON.stringify({ ...summary, exit_code: exitCodeFor(summary) }, null, 2)}\n`;
