import type { CommercialRuleSet } from '../../types.js';

/**
 * Electronics. Bare words that are also dev vocabulary (monitor, mouse, ram, cpu, cable,
 * dock, pixel) are topics or omitted; specific product nouns and "X for|under" are products.
 */
export const SHOPPING_ELECTRONICS: CommercialRuleSet = {
  category: 'shopping.electronics',
  products: [
    'headphones', 'earbuds', 'earphones', 'noise cancelling headphones',
    'noise canceling headphones', 'airpods', 'wireless earbuds', '4k monitor',
    'ultrawide monitor', 'gaming monitor', 'external monitor', 'second monitor', 'laptop',
    'laptops', 'macbook', 'macbook pro', 'macbook air', 'chromebook', 'thinkpad', 'desktop pc',
    'gaming pc', 'pc build', 'graphics card', 'mechanical keyboard', 'wireless keyboard',
    'gaming mouse', 'wireless mouse', 'ergonomic mouse', 'webcam', 'microphone', 'usb mic',
    'bluetooth speaker', 'soundbar', 'television', 'oled tv', 'smart tv', 'projector', 'tablet',
    'ipad', 'kindle', 'e reader', 'ereader', 'smartphone', 'iphone', 'android phone',
    'pixel phone', 'samsung galaxy', 'smartwatch', 'smart watch', 'apple watch',
    'fitness tracker', 'fitbit', 'garmin', 'mirrorless camera', 'dslr', 'gopro',
    'action camera', 'drone', 'printer', '3d printer', 'wifi router', 'mesh wifi',
    'mesh router', 'nas', 'external hard drive', 'ssd', 'external ssd', 'usb c hub',
    'docking station', 'charger', 'power bank', 'portable charger', 'gaming console', 'ps5',
    'playstation', 'xbox', 'nintendo switch', 'steam deck', 'vr headset', 'quest 3',
    'meta quest', 'smart speaker', 'echo dot', 'google nest', 'smart plug', 'smart bulb',
    'e bike', 'electric bike', 'electric scooter', 'dash cam', 'dashcam', 'hdmi cable',
    'usb c cable', 'sd card', 'micro sd', 'memory card', 'ram upgrade', 'motherboard',
    'power supply', 'pc case', 'aio cooler', 'cpu cooler', 'monitor arm',
  ],
  topics: [
    'electronics', 'gadget', 'gadgets', 'specs', 'battery life', 'resolution', 'refresh rate',
    'bluetooth', 'wireless', 'usb c', 'hdmi', 'gpu', 'phone', 'camera', 'monitor', 'keyboard',
    'router', 'tv', 'speakers', 'audio', 'noise cancelling', 'noise canceling', 'anc', 'oled',
    '4k', '1440p', '1080p', 'mic', 'tech specs', 'unboxing', 'best buy', 'amazon',
  ],
  patterns: [
    String.raw`\b(monitor|laptop|keyboard|mouse|headphones|earbuds|webcam|mic|microphone|tablet|phone|camera|tv|speaker|printer|router|charger) (for|under|with|around|below) \b`,
    String.raw`\b(budget|cheap|gaming|wireless|portable|compact) (monitor|laptop|keyboard|mouse|headphones|earbuds|webcam|mic|tablet|phone|camera|tv|speaker|printer|router)\b`,
  ],
};
