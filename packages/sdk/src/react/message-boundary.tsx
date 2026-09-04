import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

/**
 * The React half of the separation guard, and the only half that works during server rendering.
 *
 * Wrap whatever renders the assistant's answer:
 *
 *   <AdgateMessageBoundary>
 *     <Markdown>{message.content}</Markdown>
 *   </AdgateMessageBoundary>
 *   <SponsoredSlot decision={decision} client={client} />
 *
 * A SponsoredSlot inside that subtree renders null, on the server as well as in the browser, so
 * a wrongly nested ad is never serialised into the HTML. The DOM check in separation.ts stays as
 * the client-side backstop for apps that have not instrumented their message component yet.
 *
 * The boundary renders no element of its own (no wrapper div, no layout change): it is only a
 * context provider. Marking the same container with `data-adgate-message="assistant"` in the DOM
 * is still worth doing, because that is what the backstop reads.
 */
const AssistantMessageContext = createContext(false);

export type AdgateMessageBoundaryProps = {
  /** The assistant message content. An ad may never render in here. */
  children?: ReactNode;
};

export const AdgateMessageBoundary = ({ children }: AdgateMessageBoundaryProps): ReactElement => (
  <AssistantMessageContext.Provider value={true}>{children}</AssistantMessageContext.Provider>
);

/** True when the calling component renders inside an AdgateMessageBoundary. */
export const useInAssistantMessage = (): boolean => useContext(AssistantMessageContext);
