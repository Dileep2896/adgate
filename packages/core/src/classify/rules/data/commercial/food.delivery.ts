import type { CommercialRuleSet } from '../../types.js';

/** Food delivery: meal kits, delivery apps, grocery delivery. "factor" and "freshly" alone are omitted. */
export const FOOD_DELIVERY: CommercialRuleSet = {
  category: 'food.delivery',
  products: [
    'meal kit', 'meal kits', 'meal kit delivery', 'meal delivery', 'meal delivery service',
    'meal prep service', 'meal prep delivery', 'hellofresh', 'hello fresh', 'blue apron',
    'home chef', 'everyplate', 'every plate', 'dinnerly', 'green chef', 'sunbasket',
    'sun basket', 'purple carrot', 'factor meals', 'factor 75', 'cookunity', 'cook unity',
    'daily harvest', 'hungryroot', 'hungry root', 'doordash', 'door dash', 'ubereats',
    'uber eats', 'grubhub', 'postmates', 'deliveroo', 'just eat', 'instacart', 'gopuff',
    'go puff', 'amazon fresh', 'walmart grocery', 'grocery delivery', 'grocery delivery service',
    'food delivery', 'food delivery app', 'food delivery service', 'takeout app', 'takeaway app',
    'restaurant delivery', 'pizza delivery', 'meal subscription', 'snack subscription',
    'snack box', 'coffee subscription', 'protein meal delivery', 'vegan meal delivery',
    'prepared meals', 'ready made meals', 'ready meals', 'frozen meals', 'meal plan service',
    'farm box', 'csa box', 'produce delivery', 'fruit delivery', 'food subscription',
    'meal service',
  ],
  topics: [
    'delivery', 'delivered', 'deliver', 'meal', 'meals', 'dinner', 'dinners', 'lunch', 'lunches',
    'breakfast', 'groceries', 'grocery', 'takeout', 'takeaway', 'order food', 'ordering food',
    'cooking', 'cook', 'recipe', 'recipes', 'meal prep', 'meal planning', 'weeknight dinners',
    'for two people', 'for a family', 'family of four', 'vegetarian', 'vegan', 'restaurant',
    'restaurants', 'food', 'eating', 'eat', 'hungry', 'snack', 'snacks', 'coffee',
  ],
  patterns: [
    String.raw`\b(meal|food|grocery|groceries|dinner|lunch|breakfast|snack|coffee|pizza|restaurant) (kit|kits|delivery|deliveries|subscription|subscriptions|box|boxes|service|services|app|apps|plan|plans)\b`,
  ],
};
