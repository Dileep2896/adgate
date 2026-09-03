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

/**
 * The padded text with every whole-token occurrence of each phrase blanked out. The tokens
 * around a masked phrase keep their spaces, so they still match; repeated or adjacent
 * occurrences are all removed.
 */
export const maskPhrases = (padded: string, phrases: readonly string[]): string => {
  let masked = padded;
  for (const phrase of phrases) {
    const needle = ` ${phrase} `;
    let at = masked.indexOf(needle);
    while (at !== -1) {
      masked = `${masked.slice(0, at)}  ${masked.slice(at + needle.length)}`;
      at = masked.indexOf(needle, at + 1);
    }
  }
  return masked;
};

/** True when `phrase` (normalized) occurs as whole tokens in `normalized`. */
export const containsPhrase = (normalized: string, phrase: string): boolean =>
  phrase !== '' && padText(normalized).includes(` ${phrase} `);
