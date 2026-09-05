import { parseDay, utcDay } from './audit-filters';

/**
 * The /reports/new form: which advertiser, which days. Pure - no database, no React, no clock
 * (`now` is an argument) - so lib/report-form.test.ts pins every rule directly.
 *
 * IT IS STRICTER THAN THE AUDIT SEARCH ON PURPOSE. lib/audit-filters.ts falls back to a default
 * window when a date will not parse, because a search that quietly shows the last seven days is
 * harmless. A report is a document handed to an advertiser with a period printed on it, so an
 * unparseable date is refused rather than replaced: generating a report for a period nobody
 * asked for is the one failure mode that would not be noticed.
 *
 * A `from` after `to` is still swapped rather than refused - the operator clearly meant the
 * range between the two dates - and both days are INCLUSIVE UTC days, so the stored period ends
 * at midnight after `to` (the same half-open [since, until) every query in this package uses).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The period a fresh form offers: the last 30 whole UTC days including today. */
export const DEFAULT_REPORT_DAYS = 30;

export interface ReportFormValues {
  advertiserId: string;
  /** Inclusive first UTC day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last UTC day, `YYYY-MM-DD`. */
  to: string;
}

export type ReportFormError =
  'advertiser_required' | 'advertiser_unknown' | 'invalid_from' | 'invalid_to';

export const REPORT_FORM_MESSAGES: Record<ReportFormError, string> = {
  advertiser_required: 'Choose an advertiser to report on.',
  advertiser_unknown: 'That advertiser no longer exists.',
  invalid_from: 'The start date must be a calendar day, as YYYY-MM-DD.',
  invalid_to: 'The end date must be a calendar day, as YYYY-MM-DD.',
};

/** The form's refusals plus the one failure that happens after it: generation itself. */
export type ReportPageError = ReportFormError | 'generate_failed';

export const REPORT_ERROR_MESSAGES: Record<ReportPageError, string> = {
  ...REPORT_FORM_MESSAGES,
  generate_failed:
    'The report could not be generated. Nothing was stored; check the gateway database and try again.',
};

/** The message for an `error` code arriving in the query string, or null when it is not ours. */
export const reportFormMessage = (error: string | null): string | null =>
  error !== null && error in REPORT_ERROR_MESSAGES
    ? REPORT_ERROR_MESSAGES[error as ReportPageError]
    : null;

export const defaultReportForm = (now: Date = new Date()): ReportFormValues => ({
  advertiserId: '',
  from: utcDay(new Date(now.getTime() - (DEFAULT_REPORT_DAYS - 1) * DAY_MS)),
  to: utcDay(now),
});

/** The form as it came back, for re-rendering after a refusal. Unknown fields become ''. */
export const readReportForm = (form: { get(name: string): unknown }): ReportFormValues => {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  return { advertiserId: text('advertiser'), from: text('from'), to: text('to') };
};

export interface ParsedReportRange {
  advertiserId: string;
  /** Inclusive. */
  since: Date;
  /** Exclusive: midnight after the inclusive `to` day. */
  until: Date;
  /** The days as submitted, after the swap, for the redirect that keeps the form filled. */
  values: ReportFormValues;
}

export type ReportFormResult =
  { ok: true; range: ParsedReportRange } | { ok: false; error: ReportFormError };

/** Validates the form against the advertisers that exist right now. */
export const parseReportForm = (
  values: ReportFormValues,
  advertiserIds: readonly string[],
): ReportFormResult => {
  if (values.advertiserId === '') {
    return { ok: false, error: 'advertiser_required' };
  }
  if (!advertiserIds.includes(values.advertiserId)) {
    return { ok: false, error: 'advertiser_unknown' };
  }
  const from = parseDay(values.from);
  if (from === null) {
    return { ok: false, error: 'invalid_from' };
  }
  const to = parseDay(values.to);
  if (to === null) {
    return { ok: false, error: 'invalid_to' };
  }
  const [first, last] = from <= to ? [from, to] : [to, from];
  return {
    ok: true,
    range: {
      advertiserId: values.advertiserId,
      since: new Date(`${first}T00:00:00.000Z`),
      until: new Date(new Date(`${last}T00:00:00.000Z`).getTime() + DAY_MS),
      values: { advertiserId: values.advertiserId, from: first, to: last },
    },
  };
};
