/**
 * The /audit search state: which app, which days, which decision, which reason, and where in
 * the result set the reader is. Pure - no database, no React, no clock of its own (`now` is an
 * argument) - so every rule below is unit tested directly.
 *
 * EVERY FILTER IS A PLAIN GET PARAMETER. The search page is a form with method="get", so the
 * view an operator is looking at is entirely in the URL and can be bookmarked, pasted into a
 * ticket or handed to someone else. Nothing is stored in a cookie or in component state.
 *
 * Parsing is forgiving in exactly the way lib/creative-queries.ts is: anything unrecognised
 * falls back to the default, so a hand-edited URL narrows the search or does nothing and never
 * errors. It is not forgiving about the shape of a cursor, because a malformed cursor would
 * silently change which records are shown; an unreadable one is dropped and the first page is
 * rendered instead.
 */

export const ALL_APPS = 'all';
export const ANY_DECISION = 'any';
export const ANY_REASON = 'any';

/** Rows per page. Small enough to read, large enough that paging 1 000 records is 20 clicks. */
export const AUDIT_PAGE_SIZE = 50;

/** The date range a page with no `from`/`to` shows. */
export const DEFAULT_WINDOW_DAYS = 7;

export const DECISION_VALUES = ['serve', 'suppress'] as const;
export type AuditDecision = (typeof DECISION_VALUES)[number];

export interface AuditFilters {
  /** An app id, or ALL_APPS. */
  appId: string;
  /** Inclusive first UTC day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last UTC day, `YYYY-MM-DD`. */
  to: string;
  decision: typeof ANY_DECISION | AuditDecision;
  /** A suppress reason exactly as the gateway wrote it, or ANY_REASON. */
  reason: string;
}

/** Half-open [since, until) in real time, from the inclusive day range. */
export interface AuditWindow {
  since: Date;
  until: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of a UTC instant. */
export const utcDay = (value: Date): string => value.toISOString().slice(0, 10);

/** A day string that is both well formed and a real calendar day, else null. */
export const parseDay = (value: string): string | null => {
  if (!DAY_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || utcDay(parsed) !== value ? null : value;
};

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

const isDecision = (value: string): value is AuditDecision =>
  (DECISION_VALUES as readonly string[]).includes(value);

/** The last DEFAULT_WINDOW_DAYS days ending today, inclusive at both ends. */
export const defaultAuditFilters = (now: Date = new Date()): AuditFilters => ({
  appId: ALL_APPS,
  from: utcDay(new Date(now.getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS)),
  to: utcDay(now),
  decision: ANY_DECISION,
  reason: ANY_REASON,
});

/**
 * Query string to filters. A `from` after `to` is swapped rather than refused: the operator
 * clearly meant the range between the two dates, and an empty page would just look broken.
 */
export const parseAuditFilters = (
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): AuditFilters => {
  const defaults = defaultAuditFilters(now);
  const app = one(params['app']);
  const decision = one(params['decision']);
  const reason = one(params['reason']);
  const from = parseDay(one(params['from'])) ?? defaults.from;
  const to = parseDay(one(params['to'])) ?? defaults.to;
  return {
    appId: app === '' ? ALL_APPS : app,
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    decision: isDecision(decision) ? decision : ANY_DECISION,
    reason: reason === '' ? ANY_REASON : reason,
  };
};

/** `to` is an inclusive day, so the window ends at midnight after it. */
export const auditWindow = (filters: AuditFilters): AuditWindow => ({
  since: new Date(`${filters.from}T00:00:00.000Z`),
  until: new Date(new Date(`${filters.to}T00:00:00.000Z`).getTime() + DAY_MS),
});

/* ------------------------------------------------------------------------ the cursor --- */

/**
 * KEYSET, NOT OFFSET. A page is "the records strictly older than (ts, record_hash)", never
 * "skip 1 000 rows": OFFSET makes Postgres walk and discard every skipped row, so page 40 of an
 * audit log costs forty times page 1, and a record written while an operator is paging shifts
 * every later page by one and hides a row. (ts, record_hash) is unique - record_hash is the
 * primary key - so it totally orders the log and each record appears on exactly one page.
 */
export interface AuditCursor {
  /** `older`: the next page (further back in time). `newer`: the previous page. */
  direction: 'older' | 'newer';
  ts: Date;
  recordHash: string;
}

/** The position of one row, as it travels in a URL: `<iso ts>|<record_hash>`. */
export const encodeCursor = (row: { ts: Date; recordHash: string }): string =>
  `${row.ts.toISOString()}|${row.recordHash}`;

export interface CursorPosition {
  ts: Date;
  recordHash: string;
}

export const decodeCursor = (value: string): CursorPosition | null => {
  const separator = value.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  const ts = new Date(value.slice(0, separator));
  const recordHash = value.slice(separator + 1);
  if (Number.isNaN(ts.getTime()) || recordHash === '') {
    return null;
  }
  return { ts, recordHash };
};

export const OLDER_PARAM = 'after';
export const NEWER_PARAM = 'before';

/** The cursor the query string asks for, or null for the first page. */
export const parseAuditCursor = (
  params: Record<string, string | string[] | undefined>,
): AuditCursor | null => {
  const older = decodeCursor(one(params[OLDER_PARAM]));
  if (older !== null) {
    return { direction: 'older', ...older };
  }
  const newer = decodeCursor(one(params[NEWER_PARAM]));
  return newer === null ? null : { direction: 'newer', ...newer };
};

/**
 * The filters as a query string, with an optional cursor. Defaults are written out in full
 * rather than omitted, so the link an operator copies keeps meaning the same thing tomorrow.
 */
export const auditSearchParams = (
  filters: AuditFilters,
  cursor?: AuditCursor | null,
): URLSearchParams => {
  const params = new URLSearchParams({
    app: filters.appId,
    from: filters.from,
    to: filters.to,
    decision: filters.decision,
    reason: filters.reason,
  });
  if (cursor != null) {
    params.set(
      cursor.direction === 'older' ? OLDER_PARAM : NEWER_PARAM,
      encodeCursor({ ts: cursor.ts, recordHash: cursor.recordHash }),
    );
  }
  return params;
};

/** `/audit?...` for the given view. */
export const auditHref = (filters: AuditFilters, cursor?: AuditCursor | null): string =>
  `/audit?${auditSearchParams(filters, cursor).toString()}`;
