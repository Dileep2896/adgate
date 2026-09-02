import type { SensitiveRuleSet } from '../../types.js';

/** Gambling: betting, casinos, lotteries. "slots", "bet" and "odds" alone are weak. */
export const GAMBLING: SensitiveRuleSet = {
  category: 'gambling',
  strong: [
    'sportsbook', 'sportsbooks', 'bet on', 'betting', 'wager', 'wagers', 'wagering', 'casino',
    'casinos', 'online casino', 'online poker', 'poker', 'blackjack', 'roulette', 'slot machine',
    'slot machines', 'online slots', 'lottery', 'lotto', 'powerball', 'mega millions', 'jackpot',
    'gamble', 'gambling', 'gambler', 'bookie', 'bookmaker', 'bookmakers', 'parlay', 'parlays',
    'point spread', 'moneyline', 'over under', 'draftkings', 'fanduel', 'betmgm', 'bet365',
    'win real money', 'real money games', 'scratch cards', 'baccarat', 'craps', 'sports betting',
    'prop bet', 'prop bets', 'place a bet', 'betting odds', 'win money', 'keno', 'daily fantasy',
    'prediction market', 'polymarket',
  ],
  weak: [
    'bet', 'bets', 'odds', 'stake', 'stakes', 'slots', 'bingo', 'fantasy football', 'real money',
    'payout', 'bankroll',
  ],
  patterns: [
    String.raw`\b(win|make) (real )?money (at|on|playing|from) (online )?(poker|slots|casino|blackjack|roulette|betting|sports)\b`,
    String.raw`\bbet(ting)? (on|against) (the )?\w+ (game|games|match|matches|race|races)\b`,
  ],
};
