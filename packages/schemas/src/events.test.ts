import { describe, expect, it } from 'vitest';

import { AttestRequest, EventRequest, EventType } from './events.js';

describe('AttestRequest', () => {
  it('requires a sha256 model_output_hash and a boolean rendered', () => {
    const valid = { audit_id: 'aud_01J', model_output_hash: 'sha256:abc', rendered: false };
    expect(AttestRequest.parse(valid)).toEqual(valid);
    expect(AttestRequest.safeParse({ ...valid, model_output_hash: 'abc' }).success).toBe(false);
    expect(AttestRequest.safeParse({ ...valid, rendered: 'yes' }).success).toBe(false);
    expect(AttestRequest.safeParse({ ...valid, audit_id: 'cr_01J' }).success).toBe(false);
  });
});

describe('EventRequest', () => {
  const valid = { audit_id: 'aud_01J', type: 'click', ts: '2026-09-02T18:04:11Z' };

  it('accepts every event type and makes meta optional', () => {
    expect(EventType.options).toEqual(['impression', 'click', 'dismiss', 'conversion']);
    for (const type of EventType.options) {
      expect(EventRequest.safeParse({ ...valid, type }).success).toBe(true);
    }
    expect(EventRequest.parse(valid)).toEqual(valid);
    expect(EventRequest.parse({ ...valid, meta: { source: 'sdk' } }).meta).toEqual({
      source: 'sdk',
    });
  });

  it('rejects unknown types and non-UTC timestamps', () => {
    expect(EventRequest.safeParse({ ...valid, type: 'view' }).success).toBe(false);
    expect(EventRequest.safeParse({ ...valid, ts: '2026-09-02T18:04:11+01:00' }).success).toBe(
      false,
    );
    expect(EventRequest.safeParse({ ...valid, ts: 1756836251 }).success).toBe(false);
  });
});
