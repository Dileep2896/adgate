import type { PartnerStackConfig } from '@adgate/schemas';

import { fillTemplate } from './template.js';
import type { AffiliateUrlBuilder } from './types.js';

/**
 * PartnerStack link builder. THE APP OWNER BRINGS THEIR OWN PARTNERSTACK ACCOUNT: `config` holds
 * the owner's partner key / link id, which is public in every tracked link and fills
 * {{program_id}}; the commission is the owner's. adgate never holds PartnerStack credentials,
 * API keys or payout details (docs/decisions.md item 6) and never calls PartnerStack: this is
 * pure string work. {{u}} / {{destination}} take the landing page; any other placeholder fails.
 */
export const buildPartnerStackUrl: AffiliateUrlBuilder<PartnerStackConfig> = ({
  template,
  config,
  destination,
}) => fillTemplate(template, { program_id: config.program_id, destination });
