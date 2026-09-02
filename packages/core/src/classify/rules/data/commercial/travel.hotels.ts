import type { CommercialRuleSet } from '../../types.js';

/** Hotels and lodging. "suite" is omitted (test suite). */
export const TRAVEL_HOTELS: CommercialRuleSet = {
  category: 'travel.hotels',
  products: [
    'hotel', 'hotels', 'hostel', 'hostels', 'airbnb', 'vrbo', 'booking com', 'hotels com',
    'agoda', 'trivago', 'marriott', 'hilton', 'hyatt', 'ihg', 'accor', 'four seasons',
    'ritz carlton', 'boutique hotel', 'hotel room', 'hotel deals', 'hotel deal', 'resort',
    'resorts', 'all inclusive', 'all inclusive resort', 'ryokan', 'capsule hotel',
    'vacation rental', 'holiday rental', 'serviced apartment', 'bed and breakfast', 'b and b',
    'bnb', 'guesthouse', 'guest house', 'motel', 'inn', 'lodge', 'cabin rental', 'villa rental',
    'villa', 'hotel booking', 'place to stay', 'places to stay', 'where to stay',
    'accommodation', 'accommodations', 'lodging', 'hotel points', 'marriott bonvoy', 'bonvoy',
    'hilton honors', 'world of hyatt', 'expedia',
  ],
  topics: [
    'stay', 'staying', 'night', 'nights', 'trip', 'travel', 'vacation', 'holiday', 'check in',
    'check out', 'room', 'rooms', 'reservation', 'reservations', 'book a room', 'shibuya',
    'shinjuku', 'downtown', 'city center', 'city centre', 'neighborhood', 'neighbourhood',
    'walking distance', 'tokyo', 'kyoto', 'osaka', 'paris', 'london', 'rome', 'barcelona',
    'lisbon', 'bangkok', 'bali', 'new york', 'europe', 'japan', 'italy', 'a night', 'per night',
    'near the station',
  ],
  patterns: [
    String.raw`\bhotels? (in|near|around|close to|by|at) \w+\b`,
    String.raw`\b(under|below|less than|around|about|for) \d+ (a|per) night\b`,
    String.raw`\b(where|place|places|somewhere) to stay\b`,
    String.raw`\b(cheap|cheapest|best|good|nice|luxury|budget|boutique) (hotels?|hostels?|resorts?|airbnbs?)\b`,
  ],
};
