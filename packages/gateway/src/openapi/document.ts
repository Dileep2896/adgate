import { CONTRACT_SCHEMAS, type ContractSchemaName, toJsonSchemaObject } from '@adgateio/schemas';

import { buildPaths, COMPONENT_SCHEMA_PREFIX, type PathsObject } from './paths.js';

/**
 * GET /openapi.json (docs/api.md: generated from the Zod schemas). buildOpenApiDocument
 * assembles an OpenAPI 3.1.0 document once at startup: components.schemas is every
 * CONTRACT_SCHEMAS entry as the same JSON Schema 2020-12 object packages/schemas/json holds
 * (3.1 speaks that dialect natively, so nothing is downgraded), with any internal `$ref`
 * pointed at #/components/schemas/<Name>, and paths (openapi/paths.ts) reference those
 * components. The result is deep-frozen so a route can never mutate it between requests.
 */
export const OPENAPI_VERSION = '3.1.0';
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
/** Where zod would put reused sub-schemas inside one file; hoisted into the components. */
export const DEFS_PREFIX = '#/$defs/';

export type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string; license: { name: string } };
  jsonSchemaDialect: string;
  servers?: { url: string }[];
  paths: PathsObject;
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, Record<string, unknown>>;
  };
}

export interface OpenApiDocumentOptions {
  /** PUBLIC_BASE_URL, listed under `servers` when known. */
  serverUrl?: string | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Returns a copy of `schema` in which every `#/$defs/<X>` reference points at
 * `#/components/schemas/<X>`, hoisting each `$defs` entry into `hoisted` on the way (the same
 * name with a different definition is an error: components are a flat namespace).
 */
export const rewriteRefs = (schema: unknown, hoisted: Record<string, JsonSchema>): unknown => {
  if (Array.isArray(schema)) {
    return schema.map((entry) => rewriteRefs(entry, hoisted));
  }
  if (!isObject(schema)) {
    return schema;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith(DEFS_PREFIX)) {
      out[key] = `${COMPONENT_SCHEMA_PREFIX}${value.slice(DEFS_PREFIX.length)}`;
    } else if (key === '$defs' && isObject(value)) {
      for (const [name, definition] of Object.entries(value)) {
        const rewritten = rewriteRefs(definition, hoisted) as JsonSchema;
        const existing = hoisted[name];
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(rewritten)) {
          throw new Error(`openapi: $defs entry ${name} conflicts with an existing component`);
        }
        hoisted[name] = rewritten;
      }
    } else {
      out[key] = rewriteRefs(value, hoisted);
    }
  }
  return out;
};

/** Freezes `value` and everything reachable from it. */
export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
  }
  return value;
};

/** components.schemas: one entry per contract schema, refs rewritten, $defs hoisted. */
export const buildComponentSchemas = (): Record<string, JsonSchema> => {
  const names = Object.keys(CONTRACT_SCHEMAS) as ContractSchemaName[];
  const hoisted: Record<string, JsonSchema> = {};
  const schemas: Record<string, JsonSchema> = {};
  for (const name of names) {
    schemas[name] = rewriteRefs(toJsonSchemaObject(name), hoisted) as JsonSchema;
  }
  for (const [name, definition] of Object.entries(hoisted)) {
    const existing = schemas[name];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(`openapi: hoisted $defs entry ${name} conflicts with the ${name} schema`);
    }
    schemas[name] ??= definition;
  }
  return schemas;
};

export const buildOpenApiDocument = (options: OpenApiDocumentOptions = {}): OpenApiDocument => {
  const document: OpenApiDocument = {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'adgate gateway',
      version: '1',
      description:
        'Neutral policy, verification and mediation gateway for ads inside AI chat and agents. ' +
        'docs/api.md is the contract; this document is generated from the Zod schemas that ' +
        'implement it. Every non-2xx body except /v1/evaluate is { error: { code, message } }.',
      license: { name: 'Apache-2.0' },
    },
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    ...(options.serverUrl === undefined ? {} : { servers: [{ url: options.serverUrl }] }),
    paths: buildPaths(),
    components: {
      schemas: buildComponentSchemas(),
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Authorization: Bearer <api_key>. Keys have a role: app (evaluate, attest, events, ' +
            'its own audit records) or advertiser_read (audit records naming its creatives).',
        },
      },
    },
  };
  return deepFreeze(document);
};
