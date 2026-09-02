import type { SensitiveRuleSet } from '../../types.js';

/** Politics: elections, parties, legislation, geopolitics, ideology. */
export const POLITICS: SensitiveRuleSet = {
  category: 'politics',
  strong: [
    'vote', 'votes', 'voting', 'voter', 'voters', 'vote for', 'election', 'elections',
    'electoral', 'midterm', 'midterms', 'ballot', 'ballots', 'democrat', 'democrats',
    'democratic party', 'republican', 'republicans', 'gop', 'congress', 'congressman',
    'congresswoman', 'senate', 'senator', 'senators', 'parliament', 'parliamentary', 'trump',
    'biden', 'obama', 'kamala harris', 'putin', 'zelensky', 'netanyahu', 'hamas', 'immigration',
    'immigrants', 'immigrant', 'border wall', 'abortion', 'gun control', 'second amendment',
    'supreme court', 'legislation', 'legislature', 'lawmakers', 'left wing', 'right wing',
    'far right', 'far left', 'political', 'politics', 'politician', 'politicians',
    'geopolitics', 'geopolitical', 'war in ukraine', 'ukraine war', 'gaza', 'israel palestine',
    'nato', 'sanctions', 'tariff', 'tariffs', 'socialism', 'socialist', 'communism',
    'communist', 'fascism', 'fascist', 'marxist', 'marxism', 'referendum', 'impeach',
    'impeachment', 'filibuster', 'executive order', 'prime minister', 'propaganda', 'liberals',
    'conservatives', 'partisan', 'bipartisan', 'democracy', 'authoritarian', 'dictator',
    'dictatorship', 'regime', 'coup', 'white house', 'capitol', 'minimum wage',
    'medicare for all', 'universal healthcare', 'green new deal', 'deportation', 'deport',
    'deported',
  ],
  weak: [
    'liberal', 'conservative', 'governor', 'mayor', 'city council', 'activist', 'protest',
    'protests', 'ideology', 'campaign', 'polls', 'polling', 'economy', 'government', 'bill',
    'climate change', 'welfare', 'unions', 'president',
  ],
  patterns: [
    String.raw`\b(who|whom) (should|do|will|would) i vote\b`,
    String.raw`\b(immigration|healthcare|tax|climate|gun|voting|abortion|border) (bill|law|reform|policy|policies)\b`,
  ],
};
