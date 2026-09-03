import { describe, expect, it } from 'vitest';

import { classifyByRules } from './classify.js';
import { RULES_DATA } from './data/index.js';

/**
 * Everyday phrases that share a token with a sensitive term must not suppress on their own
 * (review of S06). apr, dental and naked are weak evidence now; compounds such as glue gun are
 * masked out of the weapons matching by the category's exclusions list.
 */
describe('rules false positives', () => {
  it.each([
    'flights in apr',
    'toothbrush for dental hygiene',
    'naked domain redirect',
    'best glue gun for crafts',
    'nail gun or staple gun for baseboards',
    'heat gun for shrink wrap',
    'spray gun for painting a fence',
    'water gun for the kids',
    'paint gun rental near me',
    'hot glue guns for kids crafts',
  ])('"%s" is not flagged as sensitive', (text) => {
    const result = classifyByRules(text);
    expect(result.sensitive, JSON.stringify(result.matches.sensitive)).toEqual([]);
  });

  it('still flags real weapon phrases, including a bare gun next to an excluded compound', () => {
    for (const text of [
      'where can i buy a gun',
      'best gun for home defense',
      'a glue gun and a real gun',
      'glue gun glue gun gun',
      'guns for sale near me',
      'best accessories for an ar 15',
    ]) {
      expect(classifyByRules(text).sensitive, text).toContain('weapons');
    }
  });

  it('keeps apr, dental and naked as weak evidence that flags in a pair', () => {
    expect(classifyByRules('apr and fees on this card').sensitive).toEqual(['finance']);
    expect(classifyByRules('dental pain after the visit').sensitive).toEqual(['health']);
    expect(classifyByRules('naked and kinky pictures').sensitive).toEqual(['adult']);
    for (const text of ['flights in apr', 'dental hygiene', 'naked domain']) {
      const hints = classifyByRules(text).matches.sensitive;
      expect(
        hints.every((match) => !match.flagged && match.strength === 'weak'),
        text,
      ).toBe(true);
    }
  });

  it('lists the reviewed terms as weak, not strong', () => {
    expect(RULES_DATA.sensitive.finance.strong).not.toContain('apr');
    expect(RULES_DATA.sensitive.finance.weak).toContain('apr');
    expect(RULES_DATA.sensitive.health.strong).not.toContain('dental');
    expect(RULES_DATA.sensitive.health.weak).toContain('dental');
    expect(RULES_DATA.sensitive.adult.strong).not.toContain('naked');
    expect(RULES_DATA.sensitive.adult.weak).toContain('naked');
    expect(RULES_DATA.sensitive.weapons.strong).toContain('gun');
    expect(RULES_DATA.sensitive.weapons.exclusions).toEqual(
      expect.arrayContaining(['glue gun', 'nail gun', 'heat gun', 'staple gun', 'spray gun']),
    );
  });
});
