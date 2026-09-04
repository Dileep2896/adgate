import type { ContractSchemaName } from '@adgate/schemas';

import { BODY_LIMIT_BYTES } from '../body-limit.js';
import { REMAINING_HEADER, RETRY_AFTER_HEADER } from '../rate-limit/middleware.js';

/**
 * The `paths` of the OpenAPI document: every route docs/api.md describes, with summaries in
 * the spirit of that document and every status a route can answer. Only structure lives
 * here; the schemas are #/components/schemas references built in openapi/document.ts.
 */
export type OperationObject = Record<string, unknown>;
export type PathItemObject = Record<string, OperationObject>;
export type PathsObject = Record<string, PathItemObject>;

export const COMPONENT_SCHEMA_PREFIX = '#/components/schemas/';

export const componentRef = (name: ContractSchemaName): { $ref: string } => ({
  $ref: `${COMPONENT_SCHEMA_PREFIX}${name}`,
});

const json = (name: ContractSchemaName) => ({ 'application/json': { schema: componentRef(name) } });

const header = (description: string, schema: Record<string, unknown> = { type: 'string' }) => ({
  description,
  schema,
});

const error = (description: string, headers?: Record<string, unknown>) => ({
  description,
  ...(headers === undefined ? {} : { headers }),
  content: json('ErrorResponse'),
});

const UNAUTHORIZED = error('unauthorized: missing, malformed, unknown or revoked API key.', {
  'WWW-Authenticate': header('Bearer realm="adgate"'),
});
const PAYLOAD_TOO_LARGE = error(`payload_too_large: the body exceeds ${BODY_LIMIT_BYTES} bytes.`);
const RATE_LIMITED = error('rate_limited: the API key emptied its token bucket.', {
  [RETRY_AFTER_HEADER]: header('Whole seconds to wait before retrying (at least 1).', {
    type: 'integer',
    minimum: 1,
  }),
  [REMAINING_HEADER]: header('Tokens left in the bucket (0 here).', { type: 'integer' }),
});
const DEFAULT_ERROR = error(
  'Any other failure: 500 internal_error, 503 unavailable (authentication store down; Retry-After: 1).',
);

const secured = { security: [{ bearer: [] }] };

const requestBody = (name: ContractSchemaName) => ({ required: true, content: json(name) });

const auditIdParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  description: 'The audit_id returned by POST /v1/evaluate.',
  schema: componentRef('AuditId'),
});

const versionParam = {
  name: 'version',
  in: 'query',
  required: false,
  description:
    'record_hash of a specific stored version (an attested record has two). Default: the latest.',
  schema: componentRef('Sha256Hash'),
};

const RECORD_HASH = header('record_hash of the version served.');
const NOT_VISIBLE = error('not_found: unknown id or version, or not visible to this key.');

export const buildPaths = (): PathsObject => ({
  '/v1/evaluate': {
    post: {
      ...secured,
      operationId: 'evaluate',
      summary: 'Decide whether a sponsored slot may be shown for this turn and which creative.',
      description:
        'Always HTTP 200 once the body validates, even on internal errors (decision suppress, ' +
        'reason error). An audit_id is returned for every evaluation; creative.url points at ' +
        'the gateway click redirect, never at the advertiser. Requires an app key.',
      requestBody: requestBody('EvaluateRequest'),
      responses: {
        '200': {
          description: 'The decision.',
          headers: { [REMAINING_HEADER]: header('Tokens left in the rate limit bucket.') },
          content: json('EvaluateResponse'),
        },
        '400': error('invalid_request: the body is not JSON or not an EvaluateRequest.'),
        '401': UNAUTHORIZED,
        '403': error("forbidden: app_id is not the key's app, or the key role is not app."),
        '413': PAYLOAD_TOO_LARGE,
        '429': RATE_LIMITED,
        default: DEFAULT_ERROR,
      },
    },
  },
  '/v1/attest': {
    post: {
      ...secured,
      operationId: 'attest',
      summary: 'Record the hash of the finished model output against an audit record.',
      description:
        'Called by the SDK after the answer is complete. The record is re-hashed and re-signed ' +
        'as a new version with separation_attestation true, chained to the previous version.',
      requestBody: requestBody('AttestRequest'),
      responses: {
        '204': { description: 'Attested.' },
        '400': error('invalid_request: the body is not JSON or not an AttestRequest.'),
        '401': UNAUTHORIZED,
        '404': error("not_found: no record with that audit_id belongs to the key's app."),
        '409': error('already_attested: the latest version already carries an attestation.'),
        '429': RATE_LIMITED,
        default: DEFAULT_ERROR,
      },
    },
  },
  '/v1/events': {
    post: {
      ...secured,
      operationId: 'events',
      summary: 'Record an impression, click, dismiss or conversion for an audit record.',
      description: 'Duplicate impressions for the same audit_id are ignored (still 204).',
      requestBody: requestBody('EventRequest'),
      responses: {
        '204': { description: 'Recorded (or a duplicate impression, ignored).' },
        '400': error('invalid_request: not an EventRequest, or meta over 4096 bytes serialized.'),
        '401': UNAUTHORIZED,
        '403': error('forbidden: the audit_id belongs to another app.'),
        '404': error('not_found: no record has that audit_id.'),
        '429': RATE_LIMITED,
        default: DEFAULT_ERROR,
      },
    },
  },
  '/c/{audit_id}': {
    get: {
      operationId: 'click',
      summary: "Click redirect: log a click event and send the user to the creative's destination.",
      description:
        'Public (the audit id is the capability). Affiliate links are built here with the app ' +
        "owner's own identifiers.",
      parameters: [auditIdParam('audit_id')],
      responses: {
        '302': {
          description: 'Redirect to the destination.',
          headers: {
            Location: header('The destination URL.', { type: 'string', format: 'uri' }),
            'Cache-Control': header('no-store'),
            'Referrer-Policy': header('no-referrer'),
          },
        },
        '404': error('not_found: unknown audit id, no creative, or no http(s) destination.'),
        default: DEFAULT_ERROR,
      },
    },
  },
  '/v1/audit/{id}': {
    get: {
      ...secured,
      operationId: 'getAuditRecord',
      summary: 'The full signed audit record (docs/audit.md).',
      description:
        "An app key reads its own app's records; an advertiser_read key reads records naming " +
        'its creatives. Anything else is 404.',
      parameters: [auditIdParam('id'), versionParam],
      responses: {
        '200': {
          description: 'The stored record, exactly as signed.',
          headers: { 'X-Adgate-Record-Hash': RECORD_HASH },
          content: json('AuditRecord'),
        },
        '401': UNAUTHORIZED,
        '404': NOT_VISIBLE,
        default: DEFAULT_ERROR,
      },
    },
  },
  '/v1/verify/{id}': {
    get: {
      ...secured,
      operationId: 'verifyAuditRecord',
      summary: 'Re-verify an audit record: schema, hash, chain, signature, creative, disclosure.',
      parameters: [auditIdParam('id'), versionParam],
      responses: {
        '200': {
          description: 'The verdict and every check, whatever the outcome.',
          headers: { 'X-Adgate-Record-Hash': RECORD_HASH },
          content: json('VerifyResponse'),
        },
        '401': UNAUTHORIZED,
        '404': NOT_VISIBLE,
        default: DEFAULT_ERROR,
      },
    },
  },
  '/healthz': {
    get: {
      operationId: 'healthz',
      summary: 'Liveness probe.',
      responses: { '200': { description: 'Alive.', content: json('HealthResponse') } },
    },
  },
  '/openapi.json': {
    get: {
      operationId: 'openapi',
      summary: 'This document, generated from the Zod schemas.',
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 document.',
          headers: { 'Cache-Control': header('public, max-age=300') },
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
  },
});
