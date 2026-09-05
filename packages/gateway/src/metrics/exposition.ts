/**
 * The Prometheus text exposition format (version 0.0.4), written by hand.
 *
 * The format is a handful of rules - a `# HELP` and a `# TYPE` line per metric family followed
 * by `name{label="value"} number` samples, with histograms rendered as cumulative `_bucket`
 * series ending at `le="+Inf"` plus `_sum` and `_count` - so the gateway writes it itself
 * rather than taking a client library (CLAUDE.md: no dependency outside the stack list without
 * a reason). Nothing here holds state: registry.ts owns the numbers, this module turns them
 * into text.
 *
 * Names and label names are validated at registration time, never per request, so a typo is a
 * boot-time error instead of an unparseable scrape.
 */

/** A metric name: what Prometheus accepts, `:` included (reserved for recording rules). */
export const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
/** A label name. `__` prefixed names are reserved by Prometheus and rejected here. */
export const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Content-Type of a scrape body. Version 0.0.4 is the text format every Prometheus reads. */
export const EXPOSITION_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export type MetricType = 'counter' | 'gauge' | 'histogram';

/** One rendered label pair, already in the family's declared label order. */
export type LabelPair = readonly [name: string, value: string];

export const assertMetricName = (name: string): string => {
  if (!METRIC_NAME_PATTERN.test(name)) {
    throw new TypeError(`invalid metric name: ${JSON.stringify(name)}`);
  }
  return name;
};

export const assertLabelName = (name: string): string => {
  if (!LABEL_NAME_PATTERN.test(name) || name.startsWith('__')) {
    throw new TypeError(`invalid label name: ${JSON.stringify(name)}`);
  }
  return name;
};

/** HELP text: backslashes and newlines are escaped, nothing else. */
export const escapeHelp = (help: string): string =>
  help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

/** Label value: backslash, newline and double quote. */
export const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

/** A sample value. Prometheus reads Go float syntax, so exponents and Inf/NaN are fine. */
export const formatValue = (value: number): string => {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '+Inf';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-Inf';
  }
  return String(value);
};

/** The `le` label value of a bucket boundary; the last bucket is always +Inf. */
export const formatBucketBound = (bound: number): string => formatValue(bound);

export const renderLabels = (labels: readonly LabelPair[]): string =>
  labels.length === 0
    ? ''
    : `{${labels.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;

export const sampleLine = (name: string, labels: readonly LabelPair[], value: number): string =>
  `${name}${renderLabels(labels)} ${formatValue(value)}`;

/** The two comment lines that must precede a family's samples. */
export const headerLines = (name: string, help: string, type: MetricType): string[] => [
  `# HELP ${name} ${escapeHelp(help)}`,
  `# TYPE ${name} ${type}`,
];
