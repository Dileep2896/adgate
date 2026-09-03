import { AMAZON_MARKETPLACES, type AmazonConfig } from '@adgate/schemas';

import { fillTemplate } from './template.js';
import type { AffiliateUrlBuilder } from './types.js';

/**
 * Amazon Associates link builder. THE APP OWNER BRINGS THEIR OWN ASSOCIATES ACCOUNT: `config.tag`
 * is the owner's tracking id (e.g. mysite-20), public in every tagged link; the commission is the
 * owner's. adgate never holds Product Advertising API keys, Associates credentials or payout
 * details (docs/decisions.md item 6) and never calls Amazon: this is pure string work.
 *
 * The template is an amazon.<storefront> URL, optionally with {{tag}} or {{u}}. The result always
 * carries tag=<owner tag>, replacing any tag the template had, so a catalog entry can never
 * attribute a click to someone else's account. Only amazon.<storefront> and www.amazon.<storefront>
 * hosts qualify; amzn.to short links are rejected because a tag cannot be attached to a redirect.
 * With config.marketplace set the host must be that storefront (tags are storefront-specific).
 */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STOREFRONT_HOST = new RegExp(
  `^(?:www\\.)?amazon\\.(?:${AMAZON_MARKETPLACES.map(escapeRegExp).join('|')})$`,
);

/** True for amazon.<storefront> or www.amazon.<storefront>, of the given storefront when set. */
export const isAmazonHost = (host: string, marketplace?: string | undefined): boolean => {
  const lower = host.toLowerCase();
  if (marketplace !== undefined) {
    return lower === `amazon.${marketplace}` || lower === `www.amazon.${marketplace}`;
  }
  return STOREFRONT_HOST.test(lower);
};

/**
 * `url` with tag=<tag> as its last query parameter: any existing tag parameter is dropped, the
 * rest of the query is kept verbatim and the fragment stays at the end.
 */
export const setTagParam = (url: string, tag: string): string => {
  const hashIndex = url.indexOf('#');
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex);
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = base.indexOf('?');
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : base.slice(queryIndex + 1);
  const kept = query.split('&').filter((pair) => pair !== '' && !pair.startsWith('tag='));
  kept.push(`tag=${encodeURIComponent(tag)}`);
  return `${path}?${kept.join('&')}${fragment}`;
};

export const buildAmazonUrl: AffiliateUrlBuilder<AmazonConfig> = ({
  template,
  config,
  destination,
}) => {
  const filled = fillTemplate(template, { tag: config.tag, destination });
  if (!filled.ok) {
    return filled;
  }
  // fillTemplate only succeeds on a parseable absolute http(s) URL.
  const host = new URL(filled.url).hostname;
  if (!isAmazonHost(host)) {
    return { ok: false, error: 'not_amazon_host' };
  }
  if (config.marketplace !== undefined && !isAmazonHost(host, config.marketplace)) {
    return { ok: false, error: 'marketplace_mismatch' };
  }
  return { ok: true, url: setTagParam(filled.url, config.tag) };
};
