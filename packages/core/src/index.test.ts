import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@adgate/core', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@adgate/core');
  });
});
