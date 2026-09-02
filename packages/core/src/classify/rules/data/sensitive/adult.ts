import type { SensitiveRuleSet } from '../../types.js';

/** Adult: pornography, sex work, explicit content. "adult" alone is weak (adult education). */
export const ADULT: SensitiveRuleSet = {
  category: 'adult',
  strong: [
    'porn', 'porno', 'pornography', 'xxx', 'nsfw', 'adult videos', 'adult video',
    'adult content', 'adult film', 'adult films', 'adult movie', 'adult movies', 'adult site',
    'adult sites', 'adult website', 'adult websites', 'adult entertainment', 'onlyfans',
    'escort', 'escorts', 'sex', 'sexual', 'sexy', 'nude', 'nudes', 'nudity', 'naked', 'erotic',
    'erotica', 'hentai', 'strip club', 'stripper', 'strippers', 'hookup', 'hookups', 'fetish',
    'bdsm', 'dildo', 'vibrator', 'sex toy', 'sex toys', 'camgirl', 'cam girl', 'prostitute',
    'prostitution', 'one night stand', 'xvideos', 'pornhub', 'sexting', 'explicit content',
    'x rated',
  ],
  weak: ['adult', 'mature', 'explicit', 'lingerie', 'kinky', 'hook up', 'dating'],
  patterns: [
    String.raw`\b(free|watch|find|best) (adult|porn|xxx|sex) (videos?|sites?|movies?|content|films?|cams?)\b`,
  ],
};
