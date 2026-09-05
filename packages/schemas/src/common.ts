import { z } from 'zod';

/** IDs are ULIDs with a type prefix (CLAUDE.md). Examples in the docs are elided, so only the prefix is checked. */
const prefixedId = (prefix: string, title: string) =>
  z
    .string()
    .startsWith(prefix)
    .min(prefix.length + 1)
    .meta({ title, description: `Identifier with the "${prefix}" prefix.` });

export const AppId = prefixedId('app_', 'AppId');
export type AppId = z.infer<typeof AppId>;

export const AuditId = prefixedId('aud_', 'AuditId');
export type AuditId = z.infer<typeof AuditId>;

export const CreativeId = prefixedId('cr_', 'CreativeId');
export type CreativeId = z.infer<typeof CreativeId>;

/** Hashes on the wire are written as `sha256:<hex>` (docs/audit.md): the 64 lowercase hex digits of the digest. */
export const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const Sha256Hash = z
  .string()
  .regex(SHA256_HASH_PATTERN, 'expected sha256: followed by 64 lowercase hex digits')
  .meta({
    title: 'Sha256Hash',
    description: 'A SHA-256 digest written as sha256:<64 lowercase hex digits>.',
  });
export type Sha256Hash = z.infer<typeof Sha256Hash>;

/** ISO 8601 UTC timestamp with a trailing Z (CLAUDE.md). Offsets are rejected. */
export const IsoTimestamp = z.iso.datetime().meta({
  title: 'IsoTimestamp',
  description: 'ISO 8601 timestamp in UTC, e.g. 2026-09-02T18:04:11Z.',
});
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const MessageRole = z.enum(['system', 'user', 'assistant', 'tool']).meta({
  title: 'MessageRole',
});
export type MessageRole = z.infer<typeof MessageRole>;

/**
 * Longest single message the gateway accepts (32 KiB of characters). Only the last 4 messages
 * and 4,000 characters reach the classifier, so this is eight times what any caller can use;
 * it exists so one message inside a legal request body cannot carry megabytes of text into
 * hashing and logging. The 256 KiB request body limit bounds the whole request.
 */
export const MESSAGE_CONTENT_MAX_CHARS = 32 * 1024;

export const Message = z
  .object({
    role: MessageRole,
    content: z.string().max(MESSAGE_CONTENT_MAX_CHARS),
  })
  .meta({
    title: 'Message',
    description:
      'One conversation turn. Servers truncate to the last 4 messages and 4,000 characters before classification, and reject a single message over 32,768 characters.',
  });
export type Message = z.infer<typeof Message>;

export const User = z
  .object({
    tier: z
      .string()
      .min(1)
      .describe(
        'free or paid. Apps may add other strings; anything not in serve_to_tiers is suppressed.',
      ),
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe(
        'ISO 3166 alpha-2 country code. Optional; when absent the regions rule fails closed and the turn is suppressed with reason region_blocked.',
      ),
    locale: z.string().min(1).optional().describe('BCP 47 locale, e.g. en-US.'),
    user_hash: z
      .string()
      .min(1)
      .optional()
      .describe('Optional stable per-user hash (sha256). Enables per_user_per_day frequency caps.'),
  })
  .meta({ title: 'User', description: 'The end user of the app for this turn.' });
export type User = z.infer<typeof User>;

export const SurfaceType = z.enum(['chat', 'agent', 'cli']).meta({ title: 'SurfaceType' });
export type SurfaceType = z.infer<typeof SurfaceType>;

export const Surface = z
  .object({
    type: SurfaceType,
    placement: z.literal('after_answer').describe('Always after_answer in v1.'),
    max_creatives: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Upper bound on creatives to return. v1 returns at most one.'),
  })
  .meta({ title: 'Surface', description: 'Where the sponsored slot would be rendered.' });
export type Surface = z.infer<typeof Surface>;

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
    }),
  })
  .meta({
    title: 'ErrorResponse',
    description: 'Body of every 4xx/5xx response from endpoints other than /v1/evaluate.',
  });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const HealthResponse = z
  .object({ ok: z.literal(true) })
  .meta({ title: 'HealthResponse', description: 'Body of GET /healthz.' });
export type HealthResponse = z.infer<typeof HealthResponse>;
