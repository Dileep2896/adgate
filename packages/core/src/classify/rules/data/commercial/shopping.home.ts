import type { CommercialRuleSet } from '../../types.js';

/** Home: furniture, appliances, kitchen, cleaning, decor. Generic words (fan, iron, paint, tools, sheets, bed, chair) are topics or omitted. */
export const SHOPPING_HOME: CommercialRuleSet = {
  category: 'shopping.home',
  products: [
    'standing desk', 'standing desks', 'sit stand desk', 'office chair', 'ergonomic chair',
    'gaming chair', 'desk chair', 'couch', 'sofa', 'sectional', 'mattress', 'mattresses',
    'bed frame', 'pillow', 'pillows', 'duvet', 'comforter', 'bedding', 'weighted blanket',
    'blanket', 'robot vacuum', 'vacuum', 'vacuum cleaner', 'cordless vacuum', 'dyson', 'roomba',
    'air purifier', 'humidifier', 'dehumidifier', 'air fryer', 'instant pot', 'blender',
    'coffee maker', 'espresso machine', 'coffee grinder', 'electric kettle', 'kettle', 'toaster',
    'microwave', 'dishwasher', 'washing machine', 'dryer', 'fridge', 'refrigerator', 'oven',
    'stove', 'cookware', 'pots and pans', 'cast iron skillet', 'knife set', 'kitchen knife',
    'chef knife', 'cutting board', 'dining table', 'coffee table', 'bookshelf', 'shelving',
    'rug', 'rugs', 'curtains', 'blinds', 'lamp', 'desk lamp', 'floor lamp', 'smart bulb',
    'smart plug', 'smart thermostat', 'thermostat', 'nest thermostat', 'doorbell camera',
    'ring doorbell', 'security camera', 'space heater', 'ceiling fan', 'tower fan', 'ac unit',
    'portable ac', 'air conditioner', 'water filter', 'water purifier', 'storage bins',
    'closet organizer', 'monitor arm', 'desk mat', 'cable management', 'planter', 'lawn mower',
    'grill', 'bbq', 'patio furniture', 'cordless drill', 'furniture', 'home decor', 'decor',
    'wallpaper', 'moving boxes', 'tv stand', 'nightstand', 'dresser', 'wardrobe', 'shower head',
    'towels', 'bath mat', 'trash can', 'laundry basket', 'steamer', 'sewing machine', 'bidet',
    'smart lock',
  ],
  topics: [
    'home', 'apartment', 'house', 'living room', 'bedroom', 'kitchen', 'bathroom', 'home office',
    'appliance', 'appliances', 'interior', 'ikea', 'wayfair', 'desk', 'chair', 'bed',
    'cleaning', 'laundry', 'small apartment', 'small space', 'studio apartment', 'renovation',
    'remodel', 'diy', 'home improvement', 'lowes', 'home depot', 'costco', 'target store',
    'walmart', 'pet hair',
  ],
  patterns: [
    String.raw`\b(robot|cordless|stick|handheld|upright|canister) vacuums?\b`,
    String.raw`\b(standing|sit stand|l shaped|gaming|computer|office|corner) desks?\b`,
    String.raw`\b(office|ergonomic|gaming|desk|dining|accent|lounge) chairs?\b`,
    String.raw`\b(memory foam|hybrid|firm|queen|king|twin|full) (mattress|bed|bed frame)\b`,
  ],
};
