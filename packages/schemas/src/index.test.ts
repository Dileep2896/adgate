import { describe, expect, it } from 'vitest';

import * as schemas from './index.js';

describe('@adgateio/schemas', () => {
  it('exports every contract schema by name', () => {
    for (const [name, schema] of Object.entries(schemas.CONTRACT_SCHEMAS)) {
      expect(schemas[name as keyof typeof schemas]).toBe(schema);
    }
  });

  it('exports the taxonomy arrays and the in-memory JSON Schema helpers only', () => {
    expect(schemas.SENSITIVE_TAXONOMY).toContain('self_harm');
    expect(schemas.CATEGORIES_TAXONOMY).toContain('general');
    expect(typeof schemas.renderJsonSchemas).toBe('function');
    expect(typeof schemas.toJsonSchemaObject).toBe('function');
    // The node:fs writer lives in json-schema-files.ts, off the index (index-purity.test.ts).
    expect(schemas).not.toHaveProperty('toJsonSchema');
    expect(schemas).not.toHaveProperty('JSON_SCHEMA_DIR');
  });

  it('exports the classify fixture schema shared with core and the Python SDK', () => {
    expect(typeof schemas.ClassifyFixture.parse).toBe('function');
    expect(typeof schemas.ClassifyFixtureCase.parse).toBe('function');
  });
});
