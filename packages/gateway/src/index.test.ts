import { describe, expect, it } from 'vitest';

import * as gateway from './index.js';

describe('@adgateio/gateway', () => {
  it('exposes the building blocks by name', () => {
    expect(typeof gateway.createApp).toBe('function');
    expect(typeof gateway.loadConfig).toBe('function');
    expect(typeof gateway.createLogger).toBe('function');
    expect(typeof gateway.createDb).toBe('function');
    expect(typeof gateway.loadSigningKeys).toBe('function');
    expect(gateway.TABLE_NAMES).toContain('audit_records');
    expect(typeof gateway.createEvaluateDeps).toBe('function');
    expect(typeof gateway.evaluateRoute).toBe('function');
    expect(typeof gateway.createMetricsRegistry).toBe('function');
    expect(typeof gateway.metricsRoute).toBe('function');
  });

  it('names every table exactly once', () => {
    expect(new Set(gateway.TABLE_NAMES).size).toBe(gateway.TABLE_NAMES.length);
    expect(gateway.TABLE_NAMES).toHaveLength(14);
  });
});
