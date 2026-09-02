import type { CommercialRuleSet } from '../../types.js';

/** Sportswear and fitness gear. "run", "runner" and "training" are omitted (dev vocabulary). */
export const SHOPPING_SPORTSWEAR: CommercialRuleSet = {
  category: 'shopping.sportswear',
  products: [
    'running shoes', 'trail running shoes', 'trail shoes', 'running shoe', 'sneakers',
    'hiking boots', 'hiking shoes', 'cycling shoes', 'gym shoes', 'workout shoes',
    'cross trainers', 'cleats', 'football boots', 'soccer cleats', 'basketball shoes',
    'tennis shoes', 'walking shoes', 'insoles', 'running socks', 'sports bra', 'sports bras',
    'leggings', 'yoga pants', 'yoga mat', 'gym bag', 'workout clothes', 'gym clothes',
    'activewear', 'athleisure', 'running shorts', 'running jacket', 'rain jacket',
    'cycling jersey', 'bib shorts', 'wetsuit', 'swimsuit', 'swim goggles', 'ski jacket',
    'ski pants', 'base layer', 'base layers', 'compression socks', 'compression shorts',
    'hydration vest', 'running vest', 'hydration pack', 'water bottle', 'running belt',
    'heart rate monitor', 'dumbbells', 'kettlebell', 'resistance bands', 'pull up bar',
    'jump rope', 'foam roller', 'treadmill', 'exercise bike', 'peloton', 'rowing machine',
    'home gym', 'squat rack', 'barbell', 'weight bench', 'nike', 'adidas', 'hoka', 'brooks',
    'asics', 'salomon', 'lululemon', 'under armour', 'new balance', 'saucony', 'altra',
    'merrell', 'patagonia', 'arcteryx', 'north face', 'garmin watch',
  ],
  topics: [
    'running', 'trail running', 'hiking', 'gym', 'workout', 'workouts', 'marathon',
    'half marathon', '5k', '10k', 'cycling', 'biking', 'swimming', 'yoga', 'pilates', 'crossfit',
    'weightlifting', 'lifting', 'jogging', 'athletic', 'athletics', 'sportswear', 'sport',
    'sports', 'fitness', 'exercise', 'muddy', 'trail', 'trails', 'race', 'races', 'triathlon',
    'ultramarathon', 'climbing', 'bouldering', 'skiing', 'snowboarding', 'surfing', 'tennis',
    'soccer', 'basketball', 'football', 'golf', 'pickleball', 'kayak', 'mud',
  ],
  patterns: [
    String.raw`\b(running|hiking|trail|cycling|gym|workout|training|tennis|basketball|soccer|golf|walking|climbing|ski|swim) (shoes|boots|gear|clothes|apparel|kit|shorts|shirt|shirts|jacket|jackets|socks|gloves|watch|bag|pants|tights)\b`,
  ],
};
