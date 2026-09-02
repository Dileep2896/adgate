import { containsPhrase } from '../classify/rules/match.js';
import { normalizeText } from '../classify/rules/normalize.js';
import type { RulesMatches } from '../classify/rules/types.js';

/**
 * Keyword overlap between a creative's keyword list and the request's keywords. Both sides go
 * through the classifier's normalizeText (NFKC, lowercase, punctuation stripped, aliases) so a
 * creative keyword "Postgres" meets the rules term "postgres hosting". The request keywords
 * are dictionary terms the rules classifier matched, never raw message text; the gateway builds
 * them with keywordsFromRulesMatches.
 */

/** Normalized, de-duplicated, blanks dropped; order preserved. */
export const normalizeKeywords = (keywords: readonly string[]): string[] => {
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword);
    if (normalized !== '') {
      seen.add(normalized);
    }
  }
  return [...seen];
};

/** True when either normalized keyword occurs as whole tokens inside the other. */
export const keywordMatches = (creativeKeyword: string, requestKeyword: string): boolean =>
  creativeKeyword === requestKeyword ||
  containsPhrase(requestKeyword, creativeKeyword) ||
  containsPhrase(creativeKeyword, requestKeyword);

/** The creative keywords (normalized) that at least one request keyword matches. */
export const matchedKeywords = (
  creativeKeywords: readonly string[],
  requestKeywords: readonly string[],
): string[] => {
  const request = normalizeKeywords(requestKeywords);
  return normalizeKeywords(creativeKeywords).filter((keyword) =>
    request.some((candidate) => keywordMatches(keyword, candidate)),
  );
};

/**
 * Fraction of the creative's distinct keywords that the request hits, in [0, 1]. 0 when the
 * creative lists no keywords, so keywords can only raise a score, never sink a creative.
 */
export const keywordOverlap = (
  creativeKeywords: readonly string[],
  requestKeywords: readonly string[],
): number => {
  const total = normalizeKeywords(creativeKeywords).length;
  if (total === 0) {
    return 0;
  }
  return matchedKeywords(creativeKeywords, requestKeywords).length / total;
};

/** Rule phrases are letters, digits and spaces; anything regex-like is a pattern source. */
const PATTERN_SOURCE = /[\\^$()[\]|?*+{}]/;

export const isPatternSource = (term: string): boolean => PATTERN_SOURCE.test(term);

/**
 * The commercial dictionary terms behind a RulesResult, as demand keywords: phrases only
 * (regex pattern sources are dropped), normalized and de-duplicated. Nothing here comes from
 * the message text itself, so the list is safe to pass to adapters and to persist.
 */
export const keywordsFromRulesMatches = (matches: RulesMatches): string[] =>
  normalizeKeywords(
    matches.commercial.flatMap((match) => match.terms).filter((term) => !isPatternSource(term)),
  );
