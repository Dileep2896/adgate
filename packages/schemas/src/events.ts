import { z } from 'zod';

import { AuditId, IsoTimestamp, Sha256Hash } from './common.js';

export const AttestRequest = z
  .object({
    audit_id: AuditId,
    model_output_hash: Sha256Hash.describe('sha256 of the complete model answer.'),
    rendered: z.boolean().describe('Whether the sponsored block was actually rendered.'),
  })
  .meta({
    title: 'AttestRequest',
    description: 'Body of POST /v1/attest, sent after the model answer is complete. Returns 204.',
  });
export type AttestRequest = z.infer<typeof AttestRequest>;

export const EventType = z.enum(['impression', 'click', 'dismiss', 'conversion']).meta({
  title: 'EventType',
});
export type EventType = z.infer<typeof EventType>;

export const EventRequest = z
  .object({
    audit_id: AuditId,
    type: EventType,
    ts: IsoTimestamp,
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({
    title: 'EventRequest',
    description:
      'Body of POST /v1/events. Returns 204. Duplicate impressions for the same audit_id are ignored.',
  });
export type EventRequest = z.infer<typeof EventRequest>;
