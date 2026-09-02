import { describe, expect, it } from 'vitest';

import { packageName } from './index.js';

describe('@adgate/sdk', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@adgate/sdk');
  });
});
