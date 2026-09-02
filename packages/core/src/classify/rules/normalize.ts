import { ALIASES } from './data/aliases.js';

/**
 * Text normalization shared by the classifier and the keyword data: Unicode NFKC, lowercase,
 * apostrophes deleted (so "don't" becomes the single token "dont"), every other run of
 * non-letter, non-digit characters becomes one space, whitespace collapsed and trimmed, then
 * aliases (typos, variants, contractions) replaced on whole tokens. The output is a single
 * space separated token string, which keeps multi-word phrase matching a plain substring test
 * on word boundaries (see match.ts).
 */
const APOSTROPHES = /['‘’ʼ`´]/g;
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

// A Map rather than the record so tokens like "constructor" never hit Object.prototype.
const ALIAS_MAP: ReadonlyMap<string, string> = new Map(Object.entries(ALIASES));

export const normalizeText = (text: string): string => {
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, ' ')
    .trim();
  if (folded === '') {
    return '';
  }
  return folded
    .split(' ')
    .map((token) => ALIAS_MAP.get(token) ?? token)
    .join(' ');
};
