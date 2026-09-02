import type { CommercialRuleSet } from '../../types.js';

/**
 * Flights and air travel. Bare "miles" is deliberately absent ("convert 5 miles" is a unit
 * conversion); "delta" and "southwest" appear only with "airlines".
 */
export const TRAVEL_FLIGHTS: CommercialRuleSet = {
  category: 'travel.flights',
  products: [
    'flights', 'flight', 'cheap flights', 'plane tickets', 'plane ticket', 'airfare',
    'airline tickets', 'airline ticket', 'flight deals', 'flight deal', 'round trip',
    'one way ticket', 'nonstop flight', 'direct flight', 'red eye', 'business class',
    'premium economy', 'first class', 'economy class', 'upgrade to business', 'airline',
    'airlines', 'delta airlines', 'delta air lines', 'united airlines', 'american airlines',
    'southwest airlines', 'jetblue', 'alaska airlines', 'ryanair', 'easyjet', 'lufthansa',
    'emirates', 'qatar airways', 'google flights', 'skyscanner', 'priceline', 'momondo',
    'expedia', 'travel points', 'airline miles', 'frequent flyer', 'frequent flyer miles',
    'award flight', 'award travel', 'lounge access', 'priority pass', 'tsa precheck',
    'global entry', 'checked bag', 'carry on bag', 'carry on luggage', 'luggage', 'suitcase',
    'travel backpack', 'packing cubes', 'travel pillow', 'travel insurance', 'flight tracker',
  ],
  topics: [
    'flying', 'fly', 'airport', 'airports', 'layover', 'layovers', 'nonstop', 'non stop',
    'itinerary', 'trip', 'travel', 'traveling', 'travelling', 'vacation', 'holiday',
    'destination', 'jet lag', 'boarding', 'baggage', 'sfo', 'lax', 'jfk', 'lhr', 'nrt', 'hnd',
    'cdg', 'tokyo', 'london', 'paris', 'new york', 'europe', 'asia', 'japan', 'italy', 'spain',
    'france', 'germany', 'mexico', 'bali', 'thailand', 'vietnam', 'hawaii', 'iceland',
    'portugal', 'greece', 'abroad', 'overseas', 'international', 'passport', 'week trip',
    'two week trip',
  ],
  patterns: [
    String.raw`\bflights? (from|to) \w+\b`,
    String.raw`\b(fly|flying) (from|to) \w+\b`,
    String.raw`\b(round trip|one way|nonstop|direct|cheap|cheapest|business class|economy|international|domestic) (flights?|tickets?|fares?|airfare)\b`,
  ],
};
