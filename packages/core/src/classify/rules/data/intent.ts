import type { IntentPattern, IntentPhrase, IntentRules } from '../types.js';

/**
 * Buying-context signals. Weights (scoring.ts): strong 0.45, medium 0.3, weak 0.15, combined
 * by noisy-OR with the category signal. Phrases are normalized (see aliases.ts).
 */
const strong = (phrase: string): IntentPhrase => ({ phrase, weight: 'strong' });
const medium = (phrase: string): IntentPhrase => ({ phrase, weight: 'medium' });
const weak = (phrase: string): IntentPhrase => ({ phrase, weight: 'weak' });

const STRONG_PHRASES = [
  'best', 'recommend', 'recommends', 'recommended', 'recommendation', 'recommendations',
  'cheapest', 'cheap', 'cheaper', 'cheaply', 'affordable', 'inexpensive', 'budget', 'low cost',
  'pricing', 'price', 'prices', 'priced', 'buy', 'buying', 'purchase', 'purchasing',
  'worth it', 'worth buying', 'worth the money', 'alternative', 'alternatives', 'alternative to',
  'vs', 'compare', 'comparison', 'comparing', 'deal', 'deals', 'discount', 'discounts', 'coupon',
  'coupons', 'promo code', 'free tier', 'hobby tier', 'free plan', 'free trial', 'top rated',
  'best rated', 'highest rated', 'looking for a', 'looking for an', 'shopping for',
  'in the market for', 'which one should i', 'what should i buy', 'what should i get',
  'what should i use', 'should i buy', 'should i get', 'should i use', 'should i switch to',
  'best value', 'bang for the buck', 'bang for your buck', 'value for money', 'on a budget',
  'cost effective', 'most affordable', 'least expensive', 'good deal', 'on sale', 'sale',
  'black friday', 'cyber monday', 'where to buy', 'where can i buy', 'where can i get',
  'where to get', 'where should i buy', 'recommendations for', 'any recommendations',
  'suggestions for', 'any suggestions', 'which is better', 'which is best', 'what is the best',
  'what are the best', 'better than', 'better alternative', 'replacement for', 'similar to',
  'how much does', 'how much is', 'how much do', 'how much would', 'how to choose', 'how to pick',
];

const MEDIUM_PHRASES = [
  'provider', 'providers', 'service', 'services', 'tool', 'tools', 'platform', 'platforms',
  'vendor', 'vendors', 'plan', 'plans', 'tier', 'tiers', 'subscription', 'subscribe', 'upgrade',
  'upgrading', 'managed', 'hosted', 'which one', 'options', 'option', 'suggest', 'suggestion',
  'suggestions', 'cost', 'costs', 'for a team of', 'for my team', 'for a small team',
  'for a startup', 'for a side project', 'for a family', 'for a small apartment',
  'for a small space', 'for a beginner', 'for beginners', 'should i pick', 'should i choose',
  'should i go with', 'go with', 'switch to', 'trial', 'demo', 'quote', 'quotes', 'per month',
  'a month', 'monthly', 'annual plan', 'worth', 'instead of',
];

const WEAK_PHRASES = [
  'which', 'should i', 'switching', 'switch', 'thinking about', 'thinking of', 'considering',
  'thoughts', 'side project', 'need a', 'need an', 'want a', 'want an', 'new', 'any good',
  'decent', 'reliable',
];

const PATTERNS: IntentPattern[] = [
  {
    source: String.raw`\bwhich (\w+ ){0,4}should i (use|pick|choose|buy|get|go with|switch to|deploy|host|try|subscribe to|sign up for|order)\b`,
    weight: 'strong',
  },
  {
    source: String.raw`\bshould i (use|deploy|buy|get|pick|choose|switch|host|try|subscribe|sign up|go with|order|upgrade|pay for)\b`,
    weight: 'strong',
  },
  { source: String.raw`\b(under|below|less than|up to|max|budget of) \d+\b`, weight: 'strong' },
  {
    source: String.raw`\b\d+ (dollars|bucks|usd|eur|euros|gbp|pounds|a month|per month|a year|per year|a night|per night)\b`,
    weight: 'strong',
  },
  {
    source: String.raw`\b(like|similar to) \w+( \w+)? but (cheaper|free|open source|simpler|better|faster|smaller|cheap)\b`,
    weight: 'strong',
  },
  { source: String.raw`\b(top|best) \d+\b`, weight: 'strong' },
];

export const INTENT_RULES: IntentRules = {
  phrases: [
    ...STRONG_PHRASES.map(strong),
    ...MEDIUM_PHRASES.map(medium),
    ...WEAK_PHRASES.map(weak),
  ],
  patterns: PATTERNS,
};
