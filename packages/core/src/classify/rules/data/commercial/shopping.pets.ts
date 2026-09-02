import type { CommercialRuleSet } from '../../types.js';

/** Pets: food, supplies, care. "treats", "harness" and "crate" alone are omitted (verbs, shipping). */
export const SHOPPING_PETS: CommercialRuleSet = {
  category: 'shopping.pets',
  products: [
    'dog food', 'cat food', 'puppy food', 'kitten food', 'pet food', 'kibble', 'dog treats',
    'cat treats', 'dog bed', 'cat bed', 'pet bed', 'dog crate', 'cat tree', 'scratching post',
    'litter box', 'cat litter', 'litter', 'self cleaning litter box', 'automatic feeder',
    'pet feeder', 'pet fountain', 'dog leash', 'leash', 'dog harness', 'cat harness',
    'dog collar', 'cat collar', 'gps collar', 'dog toys', 'cat toys', 'chew toys', 'pet toys',
    'dog bowl', 'dog carrier', 'cat carrier', 'pet carrier', 'pet insurance', 'dog shampoo',
    'flea treatment', 'flea collar', 'flea and tick', 'tick treatment', 'dewormer',
    'pet camera', 'dog camera', 'pet gate', 'dog door', 'cat door', 'pet stroller', 'dog ramp',
    'dog stairs', 'aquarium', 'fish tank', 'aquarium filter', 'hamster cage', 'bird cage',
    'rabbit hutch', 'chicken coop', 'dog walker', 'pet sitter', 'dog daycare', 'dog trainer',
    'grooming kit', 'dog nail clippers', 'pet hair vacuum', 'pet hair remover', 'chewy', 'petco',
    'petsmart', 'barkbox', 'bark box', 'dry dog food', 'wet cat food', 'cat scratcher',
    'dog kennel', 'kennel',
  ],
  topics: [
    'pet', 'pets', 'dog', 'dogs', 'puppy', 'puppies', 'cat', 'cats', 'kitten', 'kittens',
    'pet hair', 'dog hair', 'cat hair', 'shedding', 'fur', 'vet', 'veterinarian', 'fleas',
    'flea', 'ticks', 'collar', 'rescue dog', 'golden retriever', 'labrador', 'german shepherd',
    'husky', 'bulldog', 'poodle', 'corgi', 'dachshund', 'chihuahua', 'beagle', 'tabby',
    'siamese', 'maine coon', 'hamster', 'guinea pig', 'rabbit', 'bunny', 'parrot', 'budgie',
    'goldfish', 'betta', 'reptile', 'gecko', 'bearded dragon', 'terrarium', 'pet friendly',
    'pet owner', 'dog owner', 'cat owner', 'walk my dog', 'dog walking', 'pet parent',
  ],
  patterns: [
    String.raw`\b(dog|cat|pet|puppy|kitten|bird|fish|hamster|rabbit) (food|treats|bed|beds|toy|toys|bowl|bowls|crate|crates|carrier|collar|collars|leash|harness|shampoo|brush|grooming|camera|gate|door|supplies|insurance|feeder|fountain)\b`,
  ],
};
