import type { SensitiveRuleSet } from '../../types.js';

/**
 * Religion: faiths, institutions, scripture, conversion. "convert" alone is deliberately not
 * listed (unit conversion is a common low-intent request); conversion is caught by pattern.
 */
export const RELIGION: SensitiveRuleSet = {
  category: 'religion',
  strong: [
    'religion', 'religions', 'religious', 'church', 'churches', 'mosque', 'mosques', 'synagogue',
    'synagogues', 'cathedral', 'chapel', 'bible', 'biblical', 'quran', 'koran', 'torah',
    'talmud', 'gospel', 'gospels', 'jesus', 'jesus christ', 'christ', 'christian',
    'christianity', 'christians', 'muslim', 'muslims', 'islam', 'islamic', 'jewish', 'judaism',
    'jews', 'hindu', 'hinduism', 'hindus', 'buddhist', 'buddhism', 'buddhists', 'sikh',
    'sikhism', 'atheist', 'atheism', 'agnostic', 'agnosticism', 'allah', 'prayer', 'prayers',
    'pray', 'praying', 'scripture', 'scriptures', 'baptism', 'baptized', 'baptised', 'catholic',
    'catholicism', 'protestant', 'evangelical', 'evangelicals', 'mormon', 'mormons', 'lds',
    'pastor', 'priest', 'priests', 'imam', 'rabbi', 'salvation', 'afterlife', 'pilgrimage',
    'hajj', 'ramadan', 'sermon', 'worship', 'denomination', 'denominations', 'theology',
    'theological', 'religious conversion', 'god exists', 'does god exist', 'is there a god',
    'believe in god', 'the pope', 'pope', 'vatican', 'mecca', 'sabbath', 'reincarnation',
    'bar mitzvah', 'communion',
  ],
  weak: [
    'god', 'gods', 'faith', 'spiritual', 'spirituality', 'temple', 'monk', 'holy', 'karma',
    'kosher', 'halal', 'heaven', 'sinful', 'cult', 'sect', 'confession',
  ],
  patterns: [
    String.raw`\bconvert(ing|ed)? to (christianity|islam|judaism|catholicism|buddhism|hinduism|mormonism)\b`,
    String.raw`\bwhich (religion|faith|church|denomination) (is|should)\b`,
    String.raw`\b(true|right|correct|best|one true) (religion|faith)\b`,
    String.raw`\b(stay in|leave|leaving|left) (the|my) church\b`,
  ],
};
