'use client';

import { AdgateMessageBoundary, SponsoredSlot, type SponsoredSlotClient } from '@adgate/sdk/react';
import type { ReactElement } from 'react';

import { decisionOf, messageText, type ChatMessage } from '@/lib/chat';

/**
 * One assistant turn: the answer, and then, as a separate sibling block, the sponsored slot.
 *
 * The two separation rules adgate exists to enforce are both visible here:
 *
 * - the answer is wrapped in <AdgateMessageBoundary> and its container carries
 *   data-adgate-message="assistant" (the SDK's ASSISTANT_MESSAGE_ATTRIBUTE). A <SponsoredSlot>
 *   that ends up inside either of those renders nothing at all and warns.
 * - <SponsoredSlot> is therefore rendered OUTSIDE the boundary and outside that container,
 *   after the completed answer, always labelled.
 *
 * assistant-turn.test.tsx asserts exactly that against the rendered DOM.
 */

export type AssistantTurnProps = {
  message: ChatMessage;
  client: SponsoredSlotClient;
  /** True while this message is still being generated: the slot waits for the full answer. */
  streaming: boolean;
};

export const AssistantTurn = ({ message, client, streaming }: AssistantTurnProps): ReactElement => {
  const text = messageText(message);
  const decision = decisionOf(message);
  const served = decision !== null && decision.decision === 'serve' && decision.creative !== null;

  return (
    <li className="flex flex-col gap-2" data-testid="assistant-turn">
      <AdgateMessageBoundary>
        <div
          data-adgate-message="assistant"
          className="max-w-2xl rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-[15px] leading-relaxed shadow-sm ring-1 ring-stone-200"
        >
          {text === '' && streaming ? (
            <span className="text-stone-400">Thinking…</span>
          ) : (
            <p className="whitespace-pre-wrap">{text}</p>
          )}
        </div>
      </AdgateMessageBoundary>

      {decision === null || streaming ? null : (
        <div className="max-w-2xl" data-testid="adgate-block">
          <SponsoredSlot decision={decision} client={client} />
          {served ? (
            <p className="mt-1.5 text-xs text-stone-500">
              Separate block, outside the assistant message. adgate decided this before the model
              finished answering, and the model never saw it.
            </p>
          ) : (
            <p className="text-xs text-stone-500">
              No sponsored block for this turn. adgate reason:{' '}
              <code className="rounded bg-stone-200 px-1 py-0.5 text-stone-700">
                {decision.reason ?? 'none'}
              </code>
              {decision.audit_id === null ? null : (
                <>
                  {' · audit '}
                  <code className="rounded bg-stone-200 px-1 py-0.5 text-stone-700">
                    {decision.audit_id}
                  </code>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
};
