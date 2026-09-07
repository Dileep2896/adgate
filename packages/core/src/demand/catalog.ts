import type { CatalogCreative, SeedCreative } from '@adgateio/schemas';

import { prefixedUlid, type UlidOptions } from '../ids/ulid.js';

/** CLAUDE.md id prefixes: creatives are cr_<ULID>. */
export const CREATIVE_ID_PREFIX = 'cr_';

export const creativeId = (options?: UlidOptions): string =>
  prefixedUlid(CREATIVE_ID_PREFIX, options);

/**
 * Turns seed entries (examples/creatives.seed.json, validated with SeedCreative) into catalog
 * creatives by assigning a fresh cr_ id to each, in order. Pass UlidOptions with a fixed clock
 * and randomness for deterministic ids in tests. Inputs are not mutated.
 */
export const assignCreativeIds = (
  seeds: readonly SeedCreative[],
  options?: UlidOptions,
): CatalogCreative[] => seeds.map((seed) => ({ id: creativeId(options), ...seed }));
