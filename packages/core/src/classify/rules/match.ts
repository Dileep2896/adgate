/**
 * Phrase and pattern matching over normalized text (see normalize.ts). Phrases are matched as
 * whole tokens by padding both sides with a space, so "ci" matches "best ci service" but not
 * "circleci", and multi-word phrases match contiguous tokens. Patterns are regexes over the
 * unpadded normalized text; they are compiled once (no `g` flag, so `test` is stateless).
 */
export interface CompiledPattern {
  source: string;
  regex: RegExp;
}

export const compilePatterns = (sources: readonly string[]): CompiledPattern[] =>
  sources.map((source) => ({ source, regex: new RegExp(source) }));

export const padText = (normalized: string): string => ` ${normalized} `;

/** Every phrase that occurs as whole tokens in the padded normalized text, in list order. */
export const findPhrases = (padded: string, phrases: readonly string[]): string[] =>
  phrases.filter((phrase) => padded.includes(` ${phrase} `));

/** The source of every pattern that matches the normalized text, in list order. */
export const findPatterns = (normalized: string, patterns: readonly CompiledPattern[]): string[] =>
  patterns.filter(({ regex }) => regex.test(normalized)).map(({ source }) => source);

/** True when `phrase` (normalized) occurs as whole tokens in `normalized`. */
export const containsPhrase = (normalized: string, phrase: string): boolean =>
  phrase !== '' && padText(normalized).includes(` ${phrase} `);
