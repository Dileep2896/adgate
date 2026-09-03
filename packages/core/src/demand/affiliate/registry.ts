import type { AffiliateConfig, AffiliateNetwork } from '@adgate/schemas';

import { buildAmazonUrl } from './amazon.js';
import { buildImpactUrl } from './impact.js';
import { buildPartnerStackUrl } from './partnerstack.js';
import type { AffiliateBuildResult, AffiliateUrlBuilder } from './types.js';

/**
 * One builder per AffiliateNetwork, plus the dispatch the adapter uses. Everything here works on
 * the app owner's own public identifiers (docs/decisions.md item 6): nothing is fetched, signed
 * or paid out by adgate. A new AffiliateNetwork value is a compile error until it has a builder.
 */
export const AFFILIATE_BUILDERS = {
  partnerstack: buildPartnerStackUrl,
  impact: buildImpactUrl,
  amazon: buildAmazonUrl,
} as const satisfies Record<AffiliateNetwork, AffiliateUrlBuilder<never>>;

/** DemandResponse.error when the app has no AffiliateConfig entry for the adapter's network. */
export const AFFILIATE_NOT_CONFIGURED = 'affiliate_not_configured';

export const isAffiliateConfigured = (
  config: AffiliateConfig,
  network: AffiliateNetwork,
): boolean => config[network] !== undefined;

export interface BuildAffiliateUrlInput {
  network: AffiliateNetwork;
  template: string;
  config: AffiliateConfig;
  destination?: string | undefined;
  /**
   * A creative-level override of the owner's id (CatalogCreative.program_id): the program id for
   * partnerstack and impact, the Associates tag for amazon. It never stands in for a missing
   * network entry, so an unconfigured network stays unconfigured.
   */
  program_id?: string | undefined;
}

export const buildAffiliateUrl = ({
  network,
  template,
  config,
  destination,
  program_id,
}: BuildAffiliateUrlInput): AffiliateBuildResult => {
  const notConfigured: AffiliateBuildResult = { ok: false, error: AFFILIATE_NOT_CONFIGURED };
  switch (network) {
    case 'partnerstack': {
      const entry = config.partnerstack;
      if (entry === undefined) {
        return notConfigured;
      }
      return AFFILIATE_BUILDERS.partnerstack({
        template,
        config: { ...entry, program_id: program_id ?? entry.program_id },
        destination,
      });
    }
    case 'impact': {
      const entry = config.impact;
      if (entry === undefined) {
        return notConfigured;
      }
      return AFFILIATE_BUILDERS.impact({
        template,
        config: { ...entry, program_id: program_id ?? entry.program_id },
        destination,
      });
    }
    case 'amazon': {
      const entry = config.amazon;
      if (entry === undefined) {
        return notConfigured;
      }
      return AFFILIATE_BUILDERS.amazon({
        template,
        config: { ...entry, tag: program_id ?? entry.tag },
        destination,
      });
    }
  }
};
