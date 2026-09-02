import { z } from 'zod';

import { Classification } from './classification.js';
import { AppId, AuditId, Message, Surface, User } from './common.js';
import { Creative } from './creative.js';
import { PolicyOverrides } from './policy-overrides.js';
import { SuppressReason } from './suppress-reason.js';

export const Decision = z.enum(['serve', 'suppress']).meta({ title: 'Decision' });
export type Decision = z.infer<typeof Decision>;

export const EvaluateRequest = z
  .object({
    app_id: AppId,
    conversation_id: z
      .string()
      .min(1)
      .describe('App-side conversation id. Stored only as a salted hash.'),
    turn_id: z.string().min(1),
    user: User,
    messages: z
      .array(Message)
      .min(1)
      .optional()
      .describe('The last few turns, newest last. Required unless context_summary is sent.'),
    context_summary: z
      .string()
      .min(1)
      .optional()
      .describe('Short summary sent instead of raw messages. Required unless messages is sent.'),
    surface: Surface,
    policy_overrides: PolicyOverrides.optional().describe(
      'Partial PolicyConfig merged over the stored policy. May only make policy stricter.',
    ),
  })
  .refine((request) => request.messages !== undefined || request.context_summary !== undefined, {
    message: 'At least one of messages or context_summary is required',
    path: ['messages'],
  })
  .meta({
    title: 'EvaluateRequest',
    description: 'Body of POST /v1/evaluate.',
    // The refinement above, expressed for JSON Schema consumers.
    anyOf: [{ required: ['messages'] }, { required: ['context_summary'] }],
  });
export type EvaluateRequest = z.infer<typeof EvaluateRequest>;

export const EvaluateResponse = z
  .object({
    decision: Decision,
    reason: SuppressReason.nullable().describe('null when decision is serve.'),
    classification: Classification,
    creative: Creative.nullable().describe('null when decision is suppress.'),
    audit_id: AuditId.describe('Returned for every evaluation, including suppressions.'),
    latency_ms: z.number().int().min(0),
  })
  .refine(
    (response) =>
      response.decision !== 'serve' || (response.creative !== null && response.reason === null),
    { message: 'serve requires a creative and a null reason', path: ['decision'] },
  )
  .refine(
    (response) =>
      response.decision !== 'suppress' || (response.creative === null && response.reason !== null),
    { message: 'suppress requires a null creative and a reason', path: ['decision'] },
  )
  .meta({
    title: 'EvaluateResponse',
    description:
      'Body of POST /v1/evaluate. Always HTTP 200; internal failures suppress with reason error.',
    // The two refinements above, expressed for JSON Schema consumers.
    allOf: [
      {
        if: { properties: { decision: { const: 'serve' } } },
        then: { properties: { creative: { type: 'object' }, reason: { type: 'null' } } },
      },
      {
        if: { properties: { decision: { const: 'suppress' } } },
        then: { properties: { creative: { type: 'null' }, reason: { type: 'string' } } },
      },
    ],
  });
export type EvaluateResponse = z.infer<typeof EvaluateResponse>;
