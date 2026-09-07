import type { EvaluateResponse } from '@adgateio/schemas';

/**
 * Structural checks on a gateway answer. The gateway validates every response against the
 * contract schema before sending it (EvaluateResponse.parse), so this is a belt-and-braces
 * guard against a proxy, a captive portal or a wrong baseUrl answering in the gateway's place.
 * It checks the fields a renderer or a follow-up call would dereference and nothing more; it is
 * deliberately not a schema validation (that is @adgateio/schemas' job, and it would cost zod in
 * the browser bundle). CLAUDE.md's "no hand-written duplicate types" holds: the TYPES come from
 * the schema package, only the runtime shape check is local.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const CREATIVE_STRING_FIELDS = [
  'id',
  'advertiser',
  'headline',
  'body',
  'cta',
  'url',
  'source',
  'disclosure_label',
] as const;

const isCreativeShape = (value: unknown): boolean =>
  isRecord(value) &&
  CREATIVE_STRING_FIELDS.every((field) => isString(value[field])) &&
  // docs/api.md gives disclosure_label a min length of 1, and a blank one would render a
  // sponsored block with no visible label. Fail closed rather than show an unlabelled ad.
  (value['disclosure_label'] as string).trim().length > 0;

const isClassificationShape = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value['commercial_intent'] === 'number' &&
  Array.isArray(value['categories']) &&
  Array.isArray(value['sensitive']) &&
  typeof value['confidence'] === 'number' &&
  isString(value['method']) &&
  isString(value['prompt_version']);

/**
 * True when `value` has the shape of a docs/api.md EvaluateResponse: a serve carries a creative
 * with every text field and a null reason, a suppress carries a null creative and a reason,
 * and both carry a string audit_id, a classification and latency_ms.
 */
export const isEvaluateResponse = (value: unknown): value is EvaluateResponse => {
  if (!isRecord(value)) {
    return false;
  }
  const { decision, reason, creative, audit_id, classification, latency_ms } = value;
  if (decision !== 'serve' && decision !== 'suppress') {
    return false;
  }
  if (!isString(audit_id) || audit_id.length === 0) {
    return false;
  }
  if (!isClassificationShape(classification) || typeof latency_ms !== 'number') {
    return false;
  }
  if (decision === 'serve') {
    return reason === null && isCreativeShape(creative);
  }
  return isString(reason) && reason.length > 0 && creative === null;
};
