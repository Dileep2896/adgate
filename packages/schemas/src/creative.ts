import { z } from 'zod';

import { CreativeId } from './common.js';

export const DemandSource = z.enum(['direct', 'affiliate', 'koah', 'gravity']).meta({
  title: 'DemandSource',
  description: 'Demand source that supplied a creative (see docs/policy.md demand list).',
});
export type DemandSource = z.infer<typeof DemandSource>;

export const Creative = z
  .object({
    id: CreativeId,
    advertiser: z.string().min(1).describe('Advertiser display name.'),
    headline: z.string().min(1),
    body: z.string(),
    cta: z.string().min(1).describe('Call-to-action label.'),
    url: z
      .string()
      .min(1)
      .describe('Always the gateway click redirect (/c/:audit_id), never the advertiser directly.'),
    source: DemandSource,
    disclosure_label: z.string().min(1).describe('Label the SDK must render, e.g. Sponsored.'),
  })
  .meta({
    title: 'Creative',
    description: 'A sponsored creative to render in a separate labeled block after the answer.',
  });
export type Creative = z.infer<typeof Creative>;
