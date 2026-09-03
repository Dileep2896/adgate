import { z } from 'zod';

import { CreativeId } from './common.js';
import { DemandSource } from './creative.js';
import { DemandResponse } from './demand.js';
import { AdvertiserDomain } from './policy-parts.js';

/**
 * The `demand` block of an audit record (docs/audit.md): what mediation asked, what each source
 * answered, which candidates competitor_exclusions removed, and which source won. Written by
 * mediate() in @adgate/core and embedded in the signed AuditRecord, so every field is a number,
 * an enum or an identifier; never message text.
 */

export const DemandResponseSummary = DemandResponse.extend({
  candidates: z
    .number()
    .int()
    .min(0)
    .describe('How many candidates the source returned (0 on failure or timeout).'),
}).meta({
  title: 'DemandResponseSummary',
  description:
    'One entry of an audit record demand.responses list: a demand adapter answer with the candidates reduced to a count. error is set when the adapter failed, timed out or was aborted.',
});
export type DemandResponseSummary = z.infer<typeof DemandResponseSummary>;

export const ExcludedCandidate = z
  .object({
    source: DemandSource,
    creative_id: CreativeId,
    advertiser_domain: AdvertiserDomain.describe(
      'The candidate advertiser domain that matched a competitor exclusion.',
    ),
    reason: z
      .literal('competitor_exclusion')
      .describe('Why the candidate was dropped. Only competitor_exclusion exists in v1.'),
  })
  .meta({
    title: 'ExcludedCandidate',
    description:
      'One entry of an audit record demand.excluded list: a candidate mediation dropped before ranking. This resolves the pending competitor_exclusions policy decision.',
  });
export type ExcludedCandidate = z.infer<typeof ExcludedCandidate>;

export const DemandTrace = z
  .object({
    requested: z
      .array(DemandSource)
      .describe('The sources queried, in policy demand order (enabled entries only).'),
    responses: z
      .array(DemandResponseSummary)
      .describe('One entry per requested source, in the same order.'),
    excluded: z
      .array(ExcludedCandidate)
      .describe('Candidates dropped by competitor_exclusions, in the order they were seen.'),
    selected: DemandSource.nullable().describe(
      'The source of the winning candidate, or null when nothing was selected (no_fill).',
    ),
  })
  .meta({
    title: 'DemandTrace',
    description:
      'The demand block of an audit record: the mediation trace for one evaluation (docs/audit.md).',
  });
export type DemandTrace = z.infer<typeof DemandTrace>;
