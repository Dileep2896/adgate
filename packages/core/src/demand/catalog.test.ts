import { readFileSync } from 'node:fs';

import { SeedCreative, CatalogCreative } from '@adgate/schemas';
import { describe, expect, it } from 'vitest';

import { encodeUlidTime, isUlid } from '../ids/ulid.js';
import { CREATIVE_ID_PREFIX, assignCreativeIds, creativeId } from './catalog.js';
import { sequentialUlidOptions } from './direct.fixture.js';

const seeds = SeedCreative.array().parse(
  JSON.parse(
    readFileSync(new URL('../../../../examples/creatives.seed.json', import.meta.url), 'utf8'),
  ),
);

describe('assignCreativeIds', () => {
  it('gives every seed a cr_ ULID, in order, without mutating the seeds', () => {
    const before = structuredClone(seeds);
    const catalog = assignCreativeIds(seeds);
    expect(catalog).toHaveLength(seeds.length);
    for (const [index, entry] of catalog.entries()) {
      expect(entry.id.startsWith(CREATIVE_ID_PREFIX)).toBe(true);
      expect(isUlid(entry.id.slice(CREATIVE_ID_PREFIX.length))).toBe(true);
      expect(CatalogCreative.parse(entry)).toEqual(entry);
      const { id, ...rest } = entry;
      expect(id).toBeDefined();
      expect(rest).toEqual(seeds[index]);
    }
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(seeds.length);
    expect(seeds).toEqual(before);
  });

  it('is deterministic and ascending with injected time and randomness', () => {
    const ids = assignCreativeIds(seeds, sequentialUlidOptions(1_700_000_000_000)).map(
      (entry) => entry.id,
    );
    expect(ids).toEqual(assignCreativeIds(seeds, sequentialUlidOptions()).map((c) => c.id));
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe(`cr_${encodeUlidTime(1_700_000_000_000)}0000000000000001`);
  });

  it('creativeId builds one prefixed id', () => {
    expect(creativeId({ now: () => 0, random: () => new Uint8Array(10) })).toBe(
      'cr_00000000000000000000000000',
    );
  });
});
