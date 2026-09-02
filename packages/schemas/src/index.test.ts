import { describe, expect, it } from 'vitest';

import * as schemas from './index.js';

describe('@adgate/schemas', () => {
  it('exports every contract schema by name', () => {
    for (const [name, schema] of Object.entries(schemas.CONTRACT_SCHEMAS)) {
      expect(schemas[name as keyof typeof schemas]).toBe(schema);
    }
  });

  it('exports the taxonomy arrays and the JSON Schema helpers', () => {
    expect(schemas.SENSITIVE_TAXONOMY).toContain('self_harm');
    expect(schemas.CATEGORIES_TAXONOMY).toContain('general');
    expect(typeof schemas.toJsonSchema).toBe('function');
    expect(typeof schemas.renderJsonSchemas).toBe('function');
  });
});
