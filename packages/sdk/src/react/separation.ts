/**
 * Where the sponsored block must never be: inside the assistant's own message.
 *
 * This is the DOM half of the separation guard (the React half is message-boundary.tsx). It is
 * a backstop, not the primary mechanism: it can only answer once the block is in a document, so
 * it never runs during server rendering. Apps mark assistant output with
 * `data-adgate-message="assistant"` on the container that holds the answer.
 */
export const ASSISTANT_MESSAGE_ATTRIBUTE = 'data-adgate-message';
export const ASSISTANT_MESSAGE_SELECTOR = `[${ASSISTANT_MESSAGE_ATTRIBUTE}="assistant"]`;

/** Deep enough for any real chat DOM; a bound in case a broken tree hosts itself. */
const MAX_ROOT_HOPS = 32;

/** Duck-typed: `instanceof Element` needs a DOM global this file must run without. */
const isElementLike = (value: unknown): value is Element =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { closest?: unknown }).closest === 'function';

/**
 * The element hosting `node`'s tree, or null when that tree is the document. `closest` stops at
 * a shadow root, so a slot rendered into a web component would otherwise look unnested however
 * deep inside an assistant message the host element sits.
 */
const hostOf = (node: Element): Element | null => {
  if (typeof node.getRootNode !== 'function') {
    return null;
  }
  const root = node.getRootNode() as { host?: unknown } | null;
  const host = root?.host;
  return isElementLike(host) ? host : null;
};

/**
 * True when any ancestor of `element` is marked as assistant output, crossing every shadow
 * boundary between the element and the document.
 */
export const isInsideAssistantMessage = (element: Element | null): boolean => {
  let node: Element | null = element;
  for (let hop = 0; node !== null && hop < MAX_ROOT_HOPS; hop += 1) {
    if (typeof node.closest !== 'function') {
      return false;
    }
    if (node.closest(ASSISTANT_MESSAGE_SELECTOR) !== null) {
      return true;
    }
    node = hostOf(node);
  }
  return false;
};
