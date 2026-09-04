import type { EventType } from '@adgate/sdk';

import { adgateClient } from '@/lib/adgate';
import { EVENT_TYPES } from '@/lib/events';

/**
 * The browser never holds the gateway API key, so impression and dismiss events from
 * <SponsoredSlot> are relayed through this route. It is a two-line proxy on purpose: the SDK
 * client does the work and never throws.
 *
 * Clicks do not come through here. `creative.url` already points at the gateway's /c/:audit_id
 * redirect, which records the click itself (docs/api.md).
 */

export const runtime = 'nodejs';

const isEventType = (value: unknown): value is EventType =>
  typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);

export const POST = async (request: Request): Promise<Response> => {
  const body = (await request.json()) as { audit_id?: unknown; type?: unknown };
  if (typeof body.audit_id !== 'string' || body.audit_id === '' || !isEventType(body.type)) {
    return Response.json(
      { error: 'audit_id and a known event type are required' },
      { status: 400 },
    );
  }
  const result = await adgateClient().track(body.audit_id, body.type);
  return new Response(null, { status: result.ok ? 204 : 502 });
};
