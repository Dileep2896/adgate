import { z } from 'zod';

/** Verification checks in the order docs/audit.md runs them. */
export const VerifyCheckName = z
  .enum([
    'schema',
    'record_hash',
    'chain',
    'signature',
    'creative_hash',
    'disclosure_present',
    'separation_attested',
    'supersedes',
  ])
  .meta({ title: 'VerifyCheckName' });
export type VerifyCheckName = z.infer<typeof VerifyCheckName>;

export const VerifyCheck = z
  .object({
    name: VerifyCheckName,
    ok: z.boolean(),
    detail: z.string().optional().describe('Free-form detail, e.g. key_id=k_2026_09.'),
  })
  .meta({ title: 'VerifyCheck', description: 'Result of one verification check.' });
export type VerifyCheck = z.infer<typeof VerifyCheck>;

export const VerifyResponse = z
  .object({
    valid: z.boolean(),
    checks: z.array(VerifyCheck),
  })
  .meta({ title: 'VerifyResponse', description: 'Body of GET /v1/verify/:id.' });
export type VerifyResponse = z.infer<typeof VerifyResponse>;
