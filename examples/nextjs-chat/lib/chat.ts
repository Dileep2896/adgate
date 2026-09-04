import type { EvaluateResult } from '@adgate/sdk';
import type { UIMessage } from 'ai';

/**
 * The contract between app/api/chat/route.ts and the browser.
 *
 * The adgate decision must reach the UI WITHOUT ever being part of the model's text, so it
 * travels as its own AI SDK data part (`data-adgate`) on the same stream. The route writes it
 * once, immediately after the last text chunk of the answer and before the stream's `finish`
 * chunk, so the browser always has the decision by the time the answer is complete.
 *
 * The decision object is exactly what `client.evaluate` resolved to, which is exactly what
 * `<SponsoredSlot decision={...} />` consumes.
 */

/** The AI SDK data-part name. `data-` plus the key of AdgateDataTypes below. */
export const ADGATE_DATA_PART_TYPE = 'data-adgate';

export type AdgateDataTypes = { adgate: EvaluateResult };

/** The message shape used by both the route and useChat, so the data part is typed end to end. */
export type ChatMessage = UIMessage<unknown, AdgateDataTypes>;

/** docs/api.md: `free` or `paid`. The UI toggle switches this to demonstrate suppression. */
export type Tier = 'free' | 'paid';

export const TIERS: readonly Tier[] = ['free', 'paid'];

export const isTier = (value: unknown): value is Tier =>
  value === 'free' || value === 'paid';

/**
 * What the browser POSTs to /api/chat. `id` and `messages` come from useChat's default
 * transport; `tier` is the extra field the free/paid toggle adds.
 */
export type ChatRequestBody = {
  id?: string;
  messages?: ChatMessage[];
  tier?: Tier;
};

/** The plain text of a message, ignoring every non-text part. */
export const messageText = (message: ChatMessage): string =>
  message.parts
    .filter((part): part is Extract<ChatMessage['parts'][number], { type: 'text' }> =>
      part.type === 'text',
    )
    .map((part) => part.text)
    .join('');

/** The decision the route attached to this message, or null while it is still streaming. */
export const decisionOf = (message: ChatMessage): EvaluateResult | null => {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part !== undefined && part.type === ADGATE_DATA_PART_TYPE) {
      return part.data;
    }
  }
  return null;
};
