import { METRIC_NAME_PATTERN, type MetricType } from './exposition.js';

/**
 * A small Prometheus exposition parser used by the metrics tests: it reads a scrape body back
 * and THROWS on anything a real scraper would reject, so a test that parses a body has already
 * asserted the format. Deliberately independent of registry.ts (it re-reads the text, it does
 * not share the writer's assumptions). Not a test file.
 *
 * What it enforces: every metric name matches [a-zA-Z_:][a-zA-Z0-9_:]*; a family's `# HELP` and
 * `# TYPE` lines come before any of its samples, in that order, exactly once; every sample
 * belongs to a declared family (`_bucket`, `_sum` and `_count` to their histogram); histogram
 * buckets are non-decreasing, end with le="+Inf", and that last bucket equals `_count`.
 */

export interface Sample {
  name: string;
  labels: Readonly<Record<string, string>>;
  value: number;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: MetricType;
  samples: Sample[];
}

export interface Exposition {
  families: ReadonlyMap<string, MetricFamily>;
  /** The family, or a failure naming it. */
  family(name: string): MetricFamily;
  /** The value of one series, or undefined when the series has not been recorded. */
  value(name: string, labels?: Readonly<Record<string, string>>): number | undefined;
  /** Every label value in the body, for cardinality assertions. */
  labelValues(): string[];
}

const METRIC_TYPES: readonly string[] = ['counter', 'gauge', 'histogram', 'summary', 'untyped'];
const SAMPLE_PATTERN = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?[ \t]+(\S+)$/;
const LABEL_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

const unescape = (value: string): string =>
  value.replace(/\\(["\\n])/g, (_match, char: string) => (char === 'n' ? '\n' : char));

const parseLabels = (block: string | undefined): Record<string, string> => {
  if (block === undefined) {
    return {};
  }
  const inner = block.slice(1, -1);
  const labels: Record<string, string> = {};
  const rendered: string[] = [];
  for (const match of inner.matchAll(LABEL_PATTERN)) {
    labels[match[1] ?? ''] = unescape(match[2] ?? '');
    rendered.push(match[0]);
  }
  if (rendered.join(',') !== inner) {
    throw new Error(`malformed label block: ${block}`);
  }
  return labels;
};

const parseNumber = (text: string, line: string): number => {
  if (text === '+Inf') {
    return Number.POSITIVE_INFINITY;
  }
  if (text === '-Inf') {
    return Number.NEGATIVE_INFINITY;
  }
  if (text === 'NaN') {
    return Number.NaN;
  }
  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error(`sample value is not a number: ${line}`);
  }
  return value;
};

/** The family a sample name belongs to: itself, or the histogram it is a part of. */
const familyOf = (families: Map<string, MetricFamily>, name: string): MetricFamily => {
  const direct = families.get(name);
  if (direct !== undefined) {
    return direct;
  }
  for (const suffix of ['_bucket', '_sum', '_count']) {
    if (name.endsWith(suffix)) {
      const base = families.get(name.slice(0, -suffix.length));
      if (base?.type === 'histogram') {
        return base;
      }
    }
  }
  throw new Error(`sample ${name} has no # HELP / # TYPE lines before it`);
};

const seriesKey = (labels: Readonly<Record<string, string>>): string =>
  Object.entries(labels)
    .filter(([name]) => name !== 'le')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join(',');

/** Buckets must be cumulative, end at +Inf, and agree with _count. */
const checkHistogram = (family: MetricFamily): void => {
  const perSeries = new Map<string, Sample[]>();
  for (const sample of family.samples.filter((s) => s.name === `${family.name}_bucket`)) {
    const key = seriesKey(sample.labels);
    perSeries.set(key, [...(perSeries.get(key) ?? []), sample]);
  }
  for (const [key, buckets] of perSeries) {
    const last = buckets.at(-1);
    if (last?.labels['le'] !== '+Inf') {
      throw new Error(`histogram ${family.name}{${key}} does not end with le="+Inf"`);
    }
    let previous = 0;
    for (const bucket of buckets) {
      if (bucket.value < previous) {
        throw new Error(`histogram ${family.name}{${key}} buckets are not cumulative`);
      }
      previous = bucket.value;
    }
    const count = family.samples.find(
      (sample) => sample.name === `${family.name}_count` && seriesKey(sample.labels) === key,
    );
    if (count === undefined || count.value !== last.value) {
      throw new Error(`histogram ${family.name}{${key}}: +Inf bucket and _count disagree`);
    }
  }
};

export const parseExposition = (text: string): Exposition => {
  if (!text.endsWith('\n')) {
    throw new Error('exposition body must end with a newline');
  }
  const families = new Map<string, MetricFamily>();
  const helped = new Set<string>();
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    if (line.startsWith('# ')) {
      const [, keyword, name, ...rest] = line.split(' ');
      if (keyword === 'HELP') {
        if (name === undefined || helped.has(name)) {
          throw new Error(`duplicate or nameless # HELP line: ${line}`);
        }
        helped.add(name);
        continue;
      }
      if (keyword === 'TYPE') {
        const type = rest[0] ?? '';
        if (name === undefined || !helped.has(name)) {
          throw new Error(`# TYPE without a preceding # HELP: ${line}`);
        }
        if (families.has(name) || !METRIC_TYPES.includes(type)) {
          throw new Error(`duplicate or unknown # TYPE line: ${line}`);
        }
        if (!METRIC_NAME_PATTERN.test(name)) {
          throw new Error(`invalid metric name: ${name}`);
        }
        families.set(name, { name, help: rest.join(' '), type: type as MetricType, samples: [] });
        continue;
      }
      continue;
    }
    const match = SAMPLE_PATTERN.exec(line);
    if (match === null) {
      throw new Error(`unparseable line: ${line}`);
    }
    const name = match[1] ?? '';
    const sample: Sample = {
      name,
      labels: parseLabels(match[2]),
      value: parseNumber(match[3] ?? '', line),
    };
    familyOf(families, name).samples.push(sample);
  }
  for (const family of families.values()) {
    if (family.type === 'histogram') {
      checkHistogram(family);
    }
  }
  const allSamples = (): Sample[] => [...families.values()].flatMap((family) => family.samples);
  return {
    families,
    family(name) {
      const family = families.get(name);
      if (family === undefined) {
        throw new Error(`no metric family ${name}; found ${[...families.keys()].join(', ')}`);
      }
      return family;
    },
    value(name, labels = {}) {
      const wanted = seriesKey(labels);
      const le = labels['le'];
      return allSamples().find(
        (sample) =>
          sample.name === name &&
          seriesKey(sample.labels) === wanted &&
          (le === undefined || sample.labels['le'] === le),
      )?.value;
    },
    labelValues: () => allSamples().flatMap((sample) => Object.values(sample.labels)),
  };
};
