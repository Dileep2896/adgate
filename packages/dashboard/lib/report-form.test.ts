import { describe, expect, it } from 'vitest';

import {
  defaultReportForm,
  DEFAULT_REPORT_DAYS,
  parseReportForm,
  readReportForm,
  reportFormMessage,
  REPORT_FORM_MESSAGES,
} from './report-form';

/**
 * The /reports/new form rules. A report carries its period on the page, so this parser refuses
 * what lib/audit-filters.ts would quietly replace: see the module header.
 */

const ADVERTISERS = ['adv_one', 'adv_two'];

const form = (fields: Record<string, string>) => ({
  get: (name: string): unknown => fields[name] ?? null,
});

describe('the default period', () => {
  it('is the last 30 whole UTC days including today', () => {
    const values = defaultReportForm(new Date('2026-09-30T15:00:00.000Z'));
    expect(values.to).toBe('2026-09-30');
    expect(values.from).toBe('2026-09-01');
    expect(DEFAULT_REPORT_DAYS).toBe(30);
    expect(values.advertiserId).toBe('');
  });
});

describe('reading the submitted form', () => {
  it('trims the fields and turns anything missing into an empty string', () => {
    expect(
      readReportForm(form({ advertiser: '  adv_one ', from: '2026-09-01', to: '2026-09-07' })),
    ).toEqual({ advertiserId: 'adv_one', from: '2026-09-01', to: '2026-09-07' });
    expect(readReportForm(form({}))).toEqual({ advertiserId: '', from: '', to: '' });
  });
});

describe('a valid range', () => {
  it('is a half-open [since, until) with `to` included', () => {
    const result = parseReportForm(
      { advertiserId: 'adv_one', from: '2026-09-01', to: '2026-09-07' },
      ADVERTISERS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.range.since.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // The 7th is inclusive, so the window runs to midnight at the start of the 8th.
    expect(result.range.until.toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(result.range.advertiserId).toBe('adv_one');
  });

  it('swaps a range entered backwards rather than returning nothing', () => {
    const result = parseReportForm(
      { advertiserId: 'adv_two', from: '2026-09-07', to: '2026-09-01' },
      ADVERTISERS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.range.values).toEqual({
      advertiserId: 'adv_two',
      from: '2026-09-01',
      to: '2026-09-07',
    });
    expect(result.range.since.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(result.range.until.toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });

  it('accepts a single day', () => {
    const result = parseReportForm(
      { advertiserId: 'adv_one', from: '2026-09-04', to: '2026-09-04' },
      ADVERTISERS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.range.until.getTime() - result.range.since.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('a refused form', () => {
  const cases: [string, Record<string, string>, string][] = [
    [
      'no advertiser',
      { advertiserId: '', from: '2026-09-01', to: '2026-09-07' },
      'advertiser_required',
    ],
    [
      'an advertiser that no longer exists',
      { advertiserId: 'adv_gone', from: '2026-09-01', to: '2026-09-07' },
      'advertiser_unknown',
    ],
    [
      'an empty start date',
      { advertiserId: 'adv_one', from: '', to: '2026-09-07' },
      'invalid_from',
    ],
    [
      'a start date that is not a day',
      { advertiserId: 'adv_one', from: 'yesterday', to: '2026-09-07' },
      'invalid_from',
    ],
    [
      'a start date that is not a real day',
      { advertiserId: 'adv_one', from: '2026-02-30', to: '2026-09-07' },
      'invalid_from',
    ],
    ['an empty end date', { advertiserId: 'adv_one', from: '2026-09-01', to: '' }, 'invalid_to'],
  ];

  for (const [name, values, error] of cases) {
    it(`refuses ${name} instead of reporting a period nobody asked for`, () => {
      const result = parseReportForm(values as never, ADVERTISERS);
      expect(result).toEqual({ ok: false, error });
    });
  }

  it('has a message for every error it can return, and for a failed generation', () => {
    for (const error of Object.keys(REPORT_FORM_MESSAGES)) {
      expect(reportFormMessage(error)).not.toBeNull();
    }
    expect(reportFormMessage('generate_failed')).not.toBeNull();
    expect(reportFormMessage('something else')).toBeNull();
    expect(reportFormMessage(null)).toBeNull();
  });
});
