import type { SensitiveRuleSet } from '../../types.js';

/**
 * Self harm: always sensitive, always suppresses, forces commercial_intent 0 (classify.ts).
 * Contractions are expanded by normalization, so phrases use "do not" / "can not" forms.
 */
export const SELF_HARM: SensitiveRuleSet = {
  category: 'self_harm',
  strong: [
    'suicide', 'kill myself', 'killing myself', 'end my life', 'ending my life', 'end it all',
    'ending it all', 'take my own life', 'taking my own life', 'hurt myself', 'hurting myself',
    'harm myself', 'harming myself', 'cut myself', 'cutting myself', 'self harm', 'self harming',
    'self injury', 'hopeless', 'feeling hopeless', 'hopelessness', 'no point in living',
    'no point in anything', 'no point in going on', 'do not see the point',
    'do not want to be here', 'do not want to live', 'do not want to exist',
    'do not want to wake up', 'do not want to be alive', 'want to die', 'wanted to die',
    'wish i was dead', 'wish i were dead', 'wish i was never born', 'better off dead',
    'better off without me', 'no reason to live', 'can not go on', 'give up on life',
    'given up on life', 'slit my wrists', 'hang myself', 'jump off a bridge', 'not worth living',
    'life is not worth', 'ending things', 'want it to end', 'want everything to end',
    'disappear forever', 'crisis line', 'suicide hotline', '988 lifeline', 'starve myself',
    'starving myself', 'punish myself', 'no one would miss me', 'nobody would miss me',
    'everyone would be better off', 'tired of living', 'tired of being alive',
    'can not do this anymore', 'do not want to go on',
  ],
  weak: [
    'worthless', 'numb', 'empty inside', 'hate myself', 'self loathing', 'pointless',
    'nothing matters', 'do not care anymore', 'can not cope', 'self destructive', 'give up',
  ],
  patterns: [
    String.raw`\b(kill|hurt|hurting|harm|harming|cut|cutting|starve|starving|punish|punishing|poison|poisoning) myself\b`,
    String.raw`\bdo not want to (be here|live|exist|wake up|be alive|go on|carry on)\b`,
    String.raw`\bend(ing)? (my|it) (life|all)\b`,
    String.raw`\b(no|not any|do not see the|what is the) point (in|of|to) (anything|living|life|going on|trying|it all)\b`,
    String.raw`\bwish i (was|were) (dead|gone|never born)\b`,
  ],
};
