/**
 * Whole-token aliases applied after lowercasing and punctuation stripping (normalize.ts):
 * typos, brand and slang variants, and contractions (apostrophes are deleted first, so
 * "don't" arrives here as "dont"). Keys are single normalized tokens; targets are final
 * normalized token strings and are never aliased again. Every phrase in the other data files
 * must be written in target form (e.g. "bitcoin", never "crypto"; "do not", never "dont").
 */
export const ALIASES: Readonly<Record<string, string>> = {
  // contractions
  im: 'i am',
  ive: 'i have',
  dont: 'do not',
  doesnt: 'does not',
  didnt: 'did not',
  cant: 'can not',
  cannot: 'can not',
  couldnt: 'could not',
  wont: 'will not',
  wouldnt: 'would not',
  shouldnt: 'should not',
  isnt: 'is not',
  arent: 'are not',
  wasnt: 'was not',
  werent: 'were not',
  havent: 'have not',
  hasnt: 'has not',
  hadnt: 'had not',
  whats: 'what is',
  thats: 'that is',
  theres: 'there is',
  heres: 'here is',
  youre: 'you are',
  theyre: 'they are',
  wanna: 'want to',
  gonna: 'going to',
  gotta: 'got to',
  // health
  ibuprofin: 'ibuprofen',
  ibuprophen: 'ibuprofen',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  tylenol: 'acetaminophen',
  paracetamol: 'acetaminophen',
  diabetic: 'diabetes',
  diabetis: 'diabetes',
  anxious: 'anxiety',
  depressed: 'depression',
  suicidal: 'suicide',
  // finance
  crypto: 'bitcoin',
  cryptocurrency: 'bitcoin',
  cryptocurrencies: 'bitcoin',
  btc: 'bitcoin',
  eth: 'ethereum',
  // weapons
  ar15: 'ar 15',
  ak47: 'ak 47',
  // adult
  pr0n: 'porn',
  p0rn: 'porn',
  // devtools
  postgresql: 'postgres',
  psql: 'postgres',
  pgsql: 'postgres',
  mongo: 'mongodb',
  k8s: 'kubernetes',
  nextjs: 'next js',
  cicd: 'ci cd',
  // shopping and travel
  vpns: 'vpn',
  headphone: 'headphones',
  earbud: 'earbuds',
  esims: 'esim',
  // intent
  recomend: 'recommend',
  reccomend: 'recommend',
  recomendation: 'recommendation',
  recomendations: 'recommendations',
  cheepest: 'cheapest',
  cheapist: 'cheapest',
  alternitive: 'alternative',
  versus: 'vs',
};
