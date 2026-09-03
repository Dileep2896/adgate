import type { SensitiveRuleSet } from '../../types.js';

/**
 * Weapons: firearms, ammunition, other weapons. "knife" and "blade" alone are weak. Tools and
 * toys that end in "gun" are masked out before matching (exclusions) so "gun" itself can stay
 * strong; a bare "gun" elsewhere in the same text still matches.
 */
export const WEAPONS: SensitiveRuleSet = {
  category: 'weapons',
  strong: [
    'gun', 'guns', 'handgun', 'handguns', 'pistol', 'pistols', 'rifle', 'rifles', 'shotgun',
    'shotguns', 'firearm', 'firearms', 'ar 15', 'ak 47', 'glock', 'sig sauer', 'ammo',
    'ammunition', 'silencer', 'holster', 'holsters', 'concealed carry', 'ccw', 'stun gun',
    'taser', 'pepper spray', 'brass knuckles', 'switchblade', 'combat knife', 'hunting knife',
    'tactical knife', 'crossbow', 'explosive', 'explosives', 'grenade', 'grenades', 'sniper',
    'assault rifle', 'assault weapon', 'semi automatic', 'fully automatic', '9mm', 'gun shop',
    'gun store', 'gun show', 'buy a gun', 'ffl', 'bb gun', 'pellet gun', 'hunting rifle',
    'shooting range', 'gun range', 'machine gun', 'ghost gun', '3d printed gun', 'bump stock',
    'red dot sight', 'rifle scope', 'gunsmith', 'body armor', 'bulletproof vest', 'weapons',
    'gun control',
  ],
  weak: [
    'knife', 'knives', 'blade', 'sword', 'bullets', 'shooting', 'airsoft', 'arsenal', 'armed',
    'tactical', 'suppressor', 'caliber', 'calibre', 'weapon',
  ],
  patterns: [
    String.raw`\b(buy|purchase|order|find|get) (a |an |some )?(gun|handgun|pistol|rifle|shotgun|firearm|ammo|ammunition|silencer|suppressor)s?\b`,
    String.raw`\b(22|45|380|357|9) (acp|lr|magnum|caliber|cal)\b`,
    String.raw`\b(12|20|410) gauge\b`,
  ],
  exclusions: [
    'glue gun', 'glue guns', 'nail gun', 'nail guns', 'heat gun', 'heat guns', 'staple gun',
    'staple guns', 'spray gun', 'spray guns', 'water gun', 'water guns', 'paint gun',
    'paint guns', 'caulk gun', 'caulk guns', 'grease gun', 'grease guns', 'nerf gun',
    'nerf guns', 'squirt gun', 'squirt guns', 'massage gun', 'massage guns', 'rivet gun',
    'rivet guns', 'radar gun', 'radar guns', 'tattoo gun', 'tattoo guns', 'soldering gun',
    'soldering guns',
  ],
};
