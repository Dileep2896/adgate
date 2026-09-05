/**
 * Display formatting shared by the pages. Pure: no React, no database, no environment, so it
 * is unit tested directly.
 */

/** How much of a `sha256:<64 hex>` hash a table cell shows before the ellipsis. */
export const HASH_HEAD_LENGTH = 14;
export const HASH_TAIL_LENGTH = 6;

/**
 * A policy hash short enough for a table cell but still recognisable: the `sha256:` prefix,
 * the first characters of the digest, an ellipsis and the last few. Anything already short
 * enough is returned unchanged, so a truncated value never gets truncated twice. The full
 * hash always sits next to this in a copy button, never only here.
 */
export const truncateHash = (hash: string): string => {
  if (hash.length <= HASH_HEAD_LENGTH + HASH_TAIL_LENGTH + 1) {
    return hash;
  }
  return `${hash.slice(0, HASH_HEAD_LENGTH)}...${hash.slice(-HASH_TAIL_LENGTH)}`;
};

/** `2026-09-04 12:34:56Z`: ISO 8601 UTC, readable, sortable, no locale surprises. */
export const formatTimestamp = (value: Date | null | undefined): string =>
  value === null || value === undefined
    ? '-'
    : `${value.toISOString().replace('T', ' ').slice(0, 19)}Z`;

/** `2026-09-04`: the date part only, for columns where the time is noise. */
export const formatDate = (value: Date | null | undefined): string =>
  value === null || value === undefined ? '-' : value.toISOString().slice(0, 10);

/** `v3` - the policy version as it appears next to a hash. */
export const formatPolicyVersion = (version: number): string => `v${String(version)}`;

/**
 * A rate as a percentage with one decimal: `60.0%`. A null rate is one whose denominator was 0
 * (see lib/metrics.ts) and renders as `-`, never as `0.0%`: "no eligible turns" and "nothing
 * filled" are different facts and an operator must be able to tell them apart.
 */
export const PERCENT_DIGITS = 1;

export const formatPercent = (value: number | null): string =>
  value === null ? '-' : `${(value * 100).toFixed(PERCENT_DIGITS)}%`;

/**
 * An estimated amount in whatever currency the creatives' ecpm is quoted in (the catalog does
 * not carry one, so neither does this): two decimals, `-` when it is unknown.
 */
export const AMOUNT_DIGITS = 2;

export const formatAmount = (value: number | null): string =>
  value === null ? '-' : value.toFixed(AMOUNT_DIGITS);

/** `12,345` - thousands separated, locale pinned so the rendered page never depends on one. */
export const formatCount = (value: number): string => value.toLocaleString('en-US');

/** `sensitive_category:health` reads as `sensitive: health` on a chart axis. */
export const formatReason = (reason: string): string =>
  reason.startsWith('sensitive_category:')
    ? `sensitive: ${reason.slice('sensitive_category:'.length)}`
    : reason;
