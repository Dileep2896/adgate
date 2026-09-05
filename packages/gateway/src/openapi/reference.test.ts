import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { apiReferencePath, renderCurrentApiReference } from '../scripts/api-reference.js';
import { buildOpenApiDocument } from './document.js';
import { cell } from './markdown.js';
import { buildPaths } from './paths.js';
import { operationsOf, renderApiReference } from './reference.js';
import { componentName, constraintsOf, typeName } from './reference-schema.js';

const reference = () => renderApiReference(buildOpenApiDocument());

describe('docs/api-reference.md', () => {
  it('is byte-identical to a fresh render (run `pnpm docs:api` if this fails)', () => {
    const onDisk = readFileSync(apiReferencePath(), 'utf8');
    expect(onDisk).toBe(renderCurrentApiReference());
  });

  it('renders the same bytes every time', () => {
    expect(reference()).toBe(reference());
  });

  it('points at docs/api.md as the contract and says how to regenerate itself', () => {
    const text = reference();
    expect(text).toContain('[docs/api.md](api.md) is the contract.');
    expect(text).toContain('`pnpm docs:api`');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('renderApiReference', () => {
  const text = reference();

  it('has a section for every operation, with its method, path and auth', () => {
    for (const { method, path, operation } of operationsOf(buildOpenApiDocument())) {
      expect(text).toContain(`### ${method.toUpperCase()} ${path}`);
      const secured = Array.isArray(operation['security']);
      expect(text).toContain(`Auth: ${secured ? 'Bearer API key' : 'public'}.`);
    }
  });

  it('lists every path of the OpenAPI document in the overview table', () => {
    for (const path of Object.keys(buildPaths())) {
      expect(text).toContain(`| \`${path}\` |`);
    }
  });

  it('renders the request body fields of each POST route from the component schema', () => {
    expect(text).toContain('| `app_id` | `AppId` | yes |');
    expect(text).toContain('| `messages` | `Message[]` | no |');
    expect(text).toContain('| `model_output_hash` | `Sha256Hash` | yes |');
    expect(text).toContain('| `type` | `EventType` | yes |');
    expect(text).toContain('One of: `impression`, `click`, `dismiss`, `conversion`.');
  });

  it('renders the anyOf refinement EvaluateRequest carries', () => {
    expect(text).toContain('Additional constraints (`anyOf`)');
    expect(text).toContain('"minItems": 1');
  });

  it('renders every response code with its body schema and headers', () => {
    expect(text).toContain('| `200` | The decision. | `EvaluateResponse` |');
    expect(text).toContain('| `429` |');
    expect(text).toContain('| `default` |');
    expect(text).toContain('`Retry-After`');
    expect(text).toContain('| `204` | Attested. | no body | — |');
  });

  it('names the path and query parameters of the audit routes', () => {
    expect(text).toContain('| `id` | path | yes | `AuditId` |');
    expect(text).toContain('| `version` | query | no | `Sha256Hash` |');
  });

  it('lists every component schema', () => {
    const document = buildOpenApiDocument();
    for (const name of Object.keys(document.components.schemas)) {
      expect(text).toContain(`| \`${name}\` |`);
    }
  });
});

describe('reference helpers', () => {
  it('escapes pipes and collapses whitespace in a table cell', () => {
    expect(cell(' a | b \n c ')).toBe('a \\| b c');
  });

  it('names a schema by its component, title, members or JSON type', () => {
    expect(componentName({ $ref: '#/components/schemas/AuditId' })).toBe('AuditId');
    expect(componentName({ $ref: '#/$defs/AuditId' })).toBeNull();
    expect(typeName({ $ref: '#/components/schemas/AuditId' })).toBe('AuditId');
    expect(typeName({ type: 'object', title: 'User' })).toBe('User');
    expect(typeName({ type: 'array', items: { title: 'Message' } })).toBe('Message[]');
    expect(typeName({ type: 'string' })).toBe('string');
    expect(typeName({ enum: ['a', 'b'] })).toBe('"a" | "b"');
    expect(typeName({ const: 'after_answer' })).toBe('"after_answer"');
    expect(typeName(undefined)).toBe('any');
  });

  it('spells out the constraints a type name cannot carry', () => {
    expect(constraintsOf({ enum: ['a', 'b'] })).toEqual(['One of: `a`, `b`.']);
    expect(constraintsOf({ const: 'after_answer' })).toEqual(['Always `after_answer`.']);
    expect(constraintsOf({ pattern: '^aud_.*' })).toEqual(['Pattern: `^aud_.*`.']);
    expect(constraintsOf({ pattern: `^${'x'.repeat(60)}$` })).toEqual([]);
    expect(constraintsOf('not a schema')).toEqual([]);
  });
});
