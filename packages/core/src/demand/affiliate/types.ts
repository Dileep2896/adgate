import type { AffiliateConfig, AffiliateNetwork, CatalogCreative } from '@adgateio/schemas';

import type { Clock } from '../response.js';

/**
 * Affiliate link building (docs/BUILD_GUIDE.md Phase 3 item 2, docs/decisions.md item 6).
 * THE APP OWNER BRINGS THEIR OWN AFFILIATE ACCOUNTS: AffiliateConfig carries the owner's own
 * public program ids and tags, which the builders fill into catalog url_templates so that the
 * owner, not adgate, earns the commission. adgate holds no payout details, API keys or account
 * credentials for any network and never calls one; a builder is pure string work.
 */

export interface AffiliateBuildInput<Config> {
  /** A catalog url_template: {{program_id}}, {{campaign_id}}, {{tag}}, {{u}}, {{destination}}. */
  template: string;
  /** The app owner's public identifiers for this network. */
  config: Config;
  /** Landing page for {{u}} / {{destination}}; a template that names it fails without one. */
  destination?: string | undefined;
}

/** A tracked URL, or a short machine-readable reason (never message text) why none was built. */
export type AffiliateBuildResult = { ok: true; url: string } | { ok: false; error: string };

export type AffiliateUrlBuilder<Config> = (
  input: AffiliateBuildInput<Config>,
) => AffiliateBuildResult;

export interface AffiliateAdapterOptions {
  catalog: readonly CatalogCreative[];
  /** The network this adapter serves: the policy's affiliate demand entry `network`. */
  network: AffiliateNetwork;
  /** The app owner's affiliate identifiers. No entry for `network` means no candidates. */
  config: AffiliateConfig;
  /** Clock for latency_ms, in milliseconds. Defaults to Date.now (fake-timer friendly). */
  now?: Clock | undefined;
}
