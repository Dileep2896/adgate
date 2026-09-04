import type { EventType, TrackResult } from '@adgate/sdk';
import type { SponsoredSlotClient } from '@adgate/sdk/react';

/** docs/api.md POST /v1/events. Shared by the browser relay client and the /api/events route. */
export const EVENT_TYPES: readonly EventType[] = ['impression', 'click', 'dismiss', 'conversion'];

export const EVENTS_ENDPOINT = '/api/events';

/**
 * What <SponsoredSlot> is given as its `client`. It only ever calls `track`, so the browser gets
 * a relay to this app's own /api/events route instead of a real AdgateClient: the gateway API
 * key stays on the server.
 */
export const browserEventClient: SponsoredSlotClient = {
  track: async (auditId: string, type: EventType): Promise<TrackResult> => {
    try {
      const response = await fetch(EVENTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audit_id: auditId, type }),
      });
      return response.ok
        ? { ok: true, status: response.status }
        : { ok: false, status: response.status, error: 'http' };
    } catch {
      return { ok: false, error: 'network' };
    }
  },
};
