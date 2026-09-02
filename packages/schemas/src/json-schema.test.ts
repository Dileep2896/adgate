import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_SCHEMAS,
  type ContractSchemaName,
  JSON_SCHEMA_DIR,
  jsonSchemaFileName,
  renderJsonSchemas,
  toJsonSchema,
  toJsonSchemaObject,
} from './json-schema.js';

const names = Object.keys(CONTRACT_SCHEMAS) as ContractSchemaName[];

describe('json/*.schema.json', () => {
  it('contains exactly one up-to-date file per contract schema (run pnpm gen:json if this fails)', () => {
    const rendered = renderJsonSchemas();
    const onDisk = readdirSync(JSON_SCHEMA_DIR).sort();
    expect(onDisk).toEqual(names.map((name) => jsonSchemaFileName(name)).sort());
    for (const name of names) {
      const file = readFileSync(join(JSON_SCHEMA_DIR, jsonSchemaFileName(name)), 'utf8');
      expect(file, `${jsonSchemaFileName(name)} is stale`).toBe(rendered[name]);
    }
  });

  it('renders draft 2020-12 documents titled after the schema, with a trailing newline', () => {
    for (const [name, content] of Object.entries(renderJsonSchemas())) {
      expect(content.endsWith('}\n')).toBe(true);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(parsed['title']).toBe(name);
      expect(parsed).not.toHaveProperty('additionalProperties');
    }
  });

  it('sorts keys everywhere except inside properties, which keep contract order', () => {
    const request = toJsonSchemaObject('EvaluateRequest');
    expect(Object.keys(request)).toEqual([...Object.keys(request)].sort());
    expect(Object.keys(request['properties'] as object)).toEqual([
      'app_id',
      'conversation_id',
      'turn_id',
      'user',
      'messages',
      'context_summary',
      'surface',
      'policy_overrides',
    ]);
  });

  it('carries the refinements JSON Schema cannot infer from zod', () => {
    expect(toJsonSchemaObject('EvaluateRequest')['anyOf']).toEqual([
      { required: ['messages'] },
      { required: ['context_summary'] },
    ]);
    expect(toJsonSchemaObject('EvaluateResponse')['allOf']).toHaveLength(2);
    expect(toJsonSchemaObject('SuppressReason')['enum']).toContain('sensitive_category:self_harm');
  });

  it('toJsonSchema writes every file into the given directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adgate-schemas-'));
    try {
      const written = toJsonSchema(dir);
      expect(written.map((path) => path.slice(dir.length + 1)).sort()).toEqual(
        names.map((name) => jsonSchemaFileName(name)).sort(),
      );
      expect(readFileSync(join(dir, 'Creative.schema.json'), 'utf8')).toBe(
        renderJsonSchemas().Creative,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
