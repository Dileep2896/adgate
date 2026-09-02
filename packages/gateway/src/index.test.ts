import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@adgate/gateway', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@adgate/gateway');
  });
});
