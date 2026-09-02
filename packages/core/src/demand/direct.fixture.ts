import type { CatalogCreative, Classification, DemandRequest, Surface } from '@adgate/schemas';

import type { UlidOptions } from '../ids/ulid.js';

/**
 * Test fixture (not exported from the package): builders for catalog creatives and demand
 * requests, plus deterministic ULID options so assigned ids are stable and sort in order.
 */
export const CHAT_SURFACE: Surface = { type: 'chat', placement: 'after_answer' };

export const DATABASE_CLASSIFICATION: Classification = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'rules',
  prompt_version: 'sha256:test-rules',
};

export const creative = (overrides: Partial<CatalogCreative> = {}): CatalogCreative => ({
  id: 'cr_01',
  advertiser: 'Test Advertiser',
  advertiser_domain: 'advertiser.test',
  headline: 'Headline',
  body: 'Body',
  cta: 'Go',
  url_template: 'https://advertiser.test/?ref=adgate',
  target_categories: ['software.devtools.database'],
  target_regions: [],
  keywords: [],
  ecpm: 5,
  source: 'direct',
  active: true,
  ...overrides,
});

export const request = (overrides: Partial<DemandRequest> = {}): DemandRequest => ({
  app_id: 'app_test',
  classification: DATABASE_CLASSIFICATION,
  surface: CHAT_SURFACE,
  user: { region: 'US' },
  exclusions: [],
  ...overrides,
});

/** A fixed clock and a counter in the last random byte: ids are stable and ascending. */
export const sequentialUlidOptions = (timeMs = 1_700_000_000_000): UlidOptions => {
  let counter = 0;
  return {
    now: () => timeMs,
    random: (length: number) => {
      const bytes = new Uint8Array(length);
      counter += 1;
      bytes[length - 1] = counter;
      return bytes;
    },
  };
};
