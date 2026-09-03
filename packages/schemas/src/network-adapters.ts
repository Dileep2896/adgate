import { z } from 'zod';

/**
 * Partner ad network configuration (docs/BUILD_GUIDE.md Phase 3 item 3; docs/decisions.md
 * item 10: Koah and Gravity adapters are stubs until partner API access exists). Each config is
 * the minimum a real client would need, an on/off switch plus the credential and endpoint the
 * gateway reads from its environment, and nothing more, because the partner request shapes
 * are not known yet. Config-time input like AffiliateConfig (strict objects: an unknown key is
 * rejected so a misspelled field cannot silently leave a network unconfigured). Unlike the
 * affiliate ids, api_key IS a secret: it never enters a DemandRequest, a DemandResponse, the
 * audit record or a log line.
 */

const networkAdapterConfig = (title: string, network: string) =>
  z
    .strictObject({
      enabled: z
        .boolean()
        .default(false)
        .describe(
          `Whether the ${network} adapter may be queried. Off by default; the adapter answers not_configured while false.`,
        ),
      api_key: z
        .string()
        .min(1)
        .optional()
        .describe(
          `${network} API credential. A secret the gateway reads from its environment; never persisted, logged or written to the audit record.`,
        ),
      base_url: z
        .string()
        .min(1)
        .optional()
        .describe(`${network} API base URL, e.g. https://api.example. Required alongside api_key.`),
    })
    .meta({
      title,
      description: `The app owner's ${network} settings. Until partner API access exists the adapter answers not_implemented even when enabled with both credentials (docs/decisions.md item 10).`,
    });

export const KoahConfig = networkAdapterConfig('KoahConfig', 'Koah');
export type KoahConfig = z.infer<typeof KoahConfig>;

export const GravityConfig = networkAdapterConfig('GravityConfig', 'Gravity');
export type GravityConfig = z.infer<typeof GravityConfig>;

/** Either partner's config: the same shape, so one stub implementation serves both. */
export type NetworkAdapterConfig = KoahConfig | GravityConfig;
