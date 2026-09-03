import { readFileSync } from 'node:fs';

import {
  type AffiliateConfig,
  type CatalogCreative,
  type Classification,
  type DemandRequest,
  SeedCreative,
} from '@adgate/schemas';

import { assignCreativeIds } from '../catalog.js';
import { creative, request, sequentialUlidOptions } from '../direct.fixture.js';
import { DEFAULT_DEMAND_TIMEOUT_MS } from '../types.js';

/**
 * Test fixture (not exported from the package): the seed catalog with deterministic ids, a
 * PartnerStack config, and builders for affiliate creatives and education.language requests.
 */
export const seeds = SeedCreative.array().parse(
  JSON.parse(
    readFileSync(new URL('../../../../../examples/creatives.seed.json', import.meta.url), 'utf8'),
  ),
);
export const seedCatalog = assignCreativeIds(seeds, sequentialUlidOptions());
export const fetchOptions = { timeoutMs: DEFAULT_DEMAND_TIMEOUT_MS };
export const PARTNERSTACK_CONFIG: AffiliateConfig = { partnerstack: { program_id: 'ps_123' } };

export const LANGUAGE_CLASSIFICATION: Classification = {
  commercial_intent: 0.8,
  categories: ['education.language'],
  sensitive: [],
  confidence: 0.9,
  method: 'rules',
  prompt_version: 'sha256:test-rules',
};

export const languageRequest = (overrides: Partial<DemandRequest> = {}): DemandRequest =>
  request({ classification: LANGUAGE_CLASSIFICATION, keywords: ['learn spanish'], ...overrides });

export const affiliateCreative = (overrides: Partial<CatalogCreative> = {}): CatalogCreative =>
  creative({
    source: 'affiliate',
    url_template: 'https://partner.example/track?pid={{program_id}}&u={{u}}',
    ...overrides,
  });
