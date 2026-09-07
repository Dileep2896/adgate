import type { ImpactConfig } from '@adgateio/schemas';

import { fillTemplate } from './template.js';
import type { AffiliateUrlBuilder } from './types.js';

/**
 * impact.com link builder. THE APP OWNER BRINGS THEIR OWN IMPACT ACCOUNT: `config` holds the
 * owner's program / media partner id ({{program_id}}) and, optionally, a campaign id
 * ({{campaign_id}}), both public in every tracked link; the commission is the owner's. adgate
 * never holds impact.com credentials, API tokens or payout details (docs/decisions.md item 6)
 * and never calls impact.com: this is pure string work. A template that names {{campaign_id}}
 * fails when the config has none; {{u}} / {{destination}} take the landing page.
 */
export const buildImpactUrl: AffiliateUrlBuilder<ImpactConfig> = ({
  template,
  config,
  destination,
}) =>
  fillTemplate(template, {
    program_id: config.program_id,
    campaign_id: config.campaign_id,
    destination,
  });
