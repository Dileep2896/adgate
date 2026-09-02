import type { CommercialRuleSet } from '../../types.js';

/** Travel connectivity: eSIMs, SIM cards, roaming plans, pocket wifi. */
export const TRAVEL_CONNECTIVITY: CommercialRuleSet = {
  category: 'travel.connectivity',
  products: [
    'esim', 'e sim', 'sim card', 'sim cards', 'prepaid sim', 'local sim', 'travel sim',
    'international sim', 'data plan', 'international data plan', 'roaming plan',
    'roaming package', 'airalo', 'holafly', 'nomad esim', 'ubigi', 'saily', 'truphone',
    'gigsky', 'google fi', 'pocket wifi', 'portable wifi', 'wifi hotspot', 'mobile hotspot',
    'travel router', 'hotspot device', 'skyroam', 'international plan', 'travel data',
    'unlimited data', 'prepaid plan', 'prepaid data', 'wifi egg', 'mifi', 'travel wifi',
  ],
  topics: [
    'roaming', 'roam', 'international roaming', 'data roaming', 'data abroad', 'internet abroad',
    'wifi abroad', 'phone abroad', 'carrier', 'carriers', 'mobile data', 'cellular',
    'cell service', 'network coverage', 'stay connected', 'connectivity', 'wifi', 'wi fi',
    'hotspot', 'gb of data', 'unlocked phone', 'dual sim', 't mobile', 'verizon', 'at t',
    'vodafone', 'docomo', 'softbank', 'trip', 'travel', 'abroad', 'overseas', 'europe', 'japan',
    'asia', 'two week trip', 'week trip', 'roaming charges',
  ],
  patterns: [
    String.raw`\b(esim|e sim|sim card|data plan|roaming|pocket wifi|hotspot|mobile data) (for|in|abroad|while|when|during) \b`,
    String.raw`\b(internet|data|wifi|phone|cell|cellular) (abroad|overseas|while traveling|while travelling|in europe|in japan|in asia|in mexico|on my trip|for my trip|for the trip)\b`,
  ],
};
