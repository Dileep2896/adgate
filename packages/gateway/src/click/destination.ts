import { buildAffiliateUrl, defaultDestination, isHttpUrl } from '@adgateio/core';
import { AffiliateConfig, AffiliateNetwork, type PolicyConfig } from '@adgateio/schemas';

/**
 * Where a click on a served creative goes (docs/api.md GET /c/:audit_id). Pure: the route loads
 * the rows and hands them in. A direct creative goes to its url_template as stored (S09:
 * resolved_url = url_template). An affiliate creative's tracked URL is REBUILT HERE, at click
 * time, from the app owner's CURRENT AffiliateConfig and the creative's network (the policy's
 * affiliate entry when the creative names none), with core's builders, so the link credits the
 * owner's own account as configured today; when it cannot be built (no config for the network,
 * a template that fails) the click still lands on the advertiser's landing page. Whatever the
 * source, only an absolute http(s) URL is ever redirected to: javascript:, data: or a relative
 * template is 'invalid_url' and the route answers 404.
 */
export interface ClickCreative {
  source: string;
  urlTemplate: string;
  network: string | null;
  programId: string | null;
  advertiserDomain: string;
}

export interface DestinationInput {
  creative: ClickCreative;
  /** apps.affiliate_config as stored (validated at write time; re-checked here, never trusted). */
  affiliateConfig: unknown;
  /** The app's stored policy, for the affiliate entry's network; null when it cannot be read. */
  policy: PolicyConfig | null;
}

/** How the destination was resolved; the route logs it (never the URL itself). */
export type DestinationVia = 'template' | 'affiliate' | 'landing_page';

export type Destination =
  { ok: true; url: string; via: DestinationVia } | { ok: false; reason: 'invalid_url' };

/** The creative's own network, else the first enabled affiliate entry of the policy. */
export const affiliateNetworkOf = (
  creative: Pick<ClickCreative, 'network'>,
  policy: PolicyConfig | null,
): AffiliateNetwork | null => {
  const own = AffiliateNetwork.safeParse(creative.network);
  if (own.success) {
    return own.data;
  }
  for (const entry of policy?.demand ?? []) {
    if (entry.source === 'affiliate' && entry.enabled) {
      return entry.network;
    }
  }
  return null;
};

const httpOnly = (url: string, via: DestinationVia): Destination =>
  isHttpUrl(url) ? { ok: true, url, via } : { ok: false, reason: 'invalid_url' };

export const resolveDestination = (input: DestinationInput): Destination => {
  const { creative } = input;
  if (creative.source !== 'affiliate') {
    return httpOnly(creative.urlTemplate, 'template');
  }
  const landing = defaultDestination({ advertiser_domain: creative.advertiserDomain });
  const network = affiliateNetworkOf(creative, input.policy);
  const config = AffiliateConfig.safeParse(input.affiliateConfig ?? {});
  if (network === null || !config.success) {
    return httpOnly(landing, 'landing_page');
  }
  const built = buildAffiliateUrl({
    network,
    template: creative.urlTemplate,
    config: config.data,
    destination: landing,
    program_id: creative.programId ?? undefined,
  });
  return built.ok ? httpOnly(built.url, 'affiliate') : httpOnly(landing, 'landing_page');
};
