import type { Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from './app-env.js';

/**
 * JSON body parsing shared by the POST routes (/v1/evaluate, /v1/attest, /v1/events): a body
 * that is not JSON or does not satisfy the contract schema is a 400 with code invalid_request
 * and a message that names paths and expected types, never values (zod's messages do not echo
 * input). Routes render it with errorResponse.
 */
export const INVALID_REQUEST_CODE = 'invalid_request';

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; message: string };

/** `path: message` for the first issues. Zod messages name types and options, not values. */
export const summarizeIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string =>
  issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

export const parseJsonBody = async <S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
  name: string,
): Promise<ParsedBody<z.output<S>>> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, message: 'request body is not valid JSON' };
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, message: `invalid ${name}: ${summarizeIssues(result.error.issues)}` };
};
