import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONTRACT_SCHEMAS } from '@adgate/schemas';
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { findRepoRoot } from '../env-file.js';
import { createLogger } from '../logger.js';
import { collectLogs } from '../test-support/logs.js';
import { buildOpenApiDocument, deepFreeze, type JsonSchema, rewriteRefs } from './document.js';
import { COMPONENT_SCHEMA_PREFIX } from './paths.js';
import { OPENAPI_CACHE_CONTROL } from './route.js';

/** The generated document: valid OpenAPI 3.1, every documented route, every $ref resolvable. */
const document = buildOpenApiDocument({ serverUrl: 'https://gateway.test' });

const EXPECTED_ROUTES: Record<string, string[]> = {
  '/v1/evaluate': ['post'],
  '/v1/attest': ['post'],
  '/v1/events': ['post'],
  '/c/{audit_id}': ['get'],
  '/v1/audit/{id}': ['get'],
  '/v1/verify/{id}': ['get'],
  '/healthz': ['get'],
  '/openapi.json': ['get'],
};

/** Every `$ref` string anywhere in `value`. */
const collectRefs = (value: unknown, refs: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRefs(entry, refs));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') {
        refs.push(entry);
      } else {
        collectRefs(entry, refs);
      }
    }
  }
  return refs;
};

/** Resolves a `#/a/b/c` JSON pointer inside `root`, or undefined. */
const resolvePointer = (root: unknown, ref: string): unknown =>
  ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      root,
    );

describe('buildOpenApiDocument', () => {
  it('validates as OpenAPI 3.1.0', async () => {
    const validator = new Validator();
    const result = await validator.validate(document as unknown as Record<string, unknown>);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toBeUndefined();
    expect(result.valid).toBe(true);
    expect(validator.version).toBe('3.1');
  });

  it('lists every docs/api.md route with its method, bearer security on the key routes', () => {
    expect(Object.keys(document.paths).sort()).toEqual(Object.keys(EXPECTED_ROUTES).sort());
    for (const [path, methods] of Object.entries(EXPECTED_ROUTES)) {
      expect(Object.keys(document.paths[path] ?? {}), path).toEqual(methods);
    }
    const secured = [
      '/v1/evaluate',
      '/v1/attest',
      '/v1/events',
      '/v1/audit/{id}',
      '/v1/verify/{id}',
    ];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const operation of Object.values(item)) {
        expect(operation['security'], path).toEqual(
          secured.includes(path) ? [{ bearer: [] }] : undefined,
        );
      }
    }
    expect(document.components.securitySchemes['bearer']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.servers).toEqual([{ url: 'https://gateway.test' }]);
  });

  it('documents the statuses the routes answer', () => {
    const responses = (path: string, method: string): string[] =>
      Object.keys((document.paths[path]?.[method]?.['responses'] as Record<string, unknown>) ?? {});
    expect(responses('/v1/evaluate', 'post')).toEqual([
      '200',
      '400',
      '401',
      '403',
      '413',
      '429',
      'default',
    ]);
    expect(responses('/v1/attest', 'post')).toEqual([
      '204',
      '400',
      '401',
      '404',
      '409',
      '429',
      'default',
    ]);
    expect(responses('/v1/events', 'post')).toEqual([
      '204',
      '400',
      '401',
      '403',
      '404',
      '429',
      'default',
    ]);
    expect(responses('/c/{audit_id}', 'get')).toEqual(['302', '404', 'default']);
    expect(responses('/v1/audit/{id}', 'get')).toEqual(['200', '401', '404', 'default']);
    expect(responses('/v1/verify/{id}', 'get')).toEqual(['200', '401', '404', 'default']);
    const redirect = document.paths['/c/{audit_id}']?.['get']?.['responses'] as Record<
      string,
      { headers: Record<string, unknown> }
    >;
    expect(Object.keys(redirect['302']?.headers ?? {})).toContain('Location');
    const audit = document.paths['/v1/audit/{id}']?.['get']?.['parameters'] as { name: string }[];
    expect(audit.map((p) => p.name)).toEqual(['id', 'version']);
  });

  it('has one component per contract schema and every $ref resolves inside the document', () => {
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      Object.keys(CONTRACT_SCHEMAS).sort(),
    );
    const refs = collectRefs(document);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      expect(ref.startsWith(COMPONENT_SCHEMA_PREFIX), ref).toBe(true);
      expect(resolvePointer(document, ref), ref).toBeDefined();
    }
  });

  it('carries the EvaluateRequest schema file as its component, modulo the $ref rewrite', () => {
    const root = findRepoRoot();
    if (root === null) {
      throw new Error('repo root not found');
    }
    const file = JSON.parse(
      readFileSync(join(root, 'packages/schemas/json/EvaluateRequest.schema.json'), 'utf8'),
    ) as JsonSchema;
    expect(document.components.schemas['EvaluateRequest']).toEqual(rewriteRefs(file, {}));
  });

  it('is deep-frozen and rebuilds identically', () => {
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.paths['/v1/evaluate'])).toBe(true);
    expect(Object.isFrozen(document.components.schemas['AuditRecord'])).toBe(true);
    expect(() => {
      (document.paths as Record<string, unknown>)['/x'] = {};
    }).toThrow(TypeError);
    expect(buildOpenApiDocument({ serverUrl: 'https://gateway.test' })).toEqual(document);
    expect(buildOpenApiDocument().servers).toBeUndefined();
  });
});

describe('rewriteRefs', () => {
  it('points $defs references at the components and hoists the definitions', () => {
    const hoisted: Record<string, JsonSchema> = {};
    const out = rewriteRefs(
      {
        type: 'object',
        properties: { a: { $ref: '#/$defs/Inner' }, b: { items: { $ref: '#/$defs/Inner' } } },
        $defs: { Inner: { type: 'string' } },
      },
      hoisted,
    );
    expect(out).toEqual({
      type: 'object',
      properties: {
        a: { $ref: '#/components/schemas/Inner' },
        b: { items: { $ref: '#/components/schemas/Inner' } },
      },
    });
    expect(hoisted).toEqual({ Inner: { type: 'string' } });
    expect(() => rewriteRefs({ $defs: { Inner: { type: 'number' } } }, hoisted)).toThrow(
      /conflicts/,
    );
    expect(deepFreeze({ a: { b: 1 } })).toEqual({ a: { b: 1 } });
  });
});

describe('GET /openapi.json', () => {
  it('serves the document publicly with a five minute cache', async () => {
    const { stream } = collectLogs();
    const app = createApp({
      logger: createLogger({ level: 'silent' }, stream),
      corsAllowedOrigins: [],
    });
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe(OPENAPI_CACHE_CONTROL);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toContain('/v1/evaluate');
  });
});
