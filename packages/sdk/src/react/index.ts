/**
 * `@adgateio/sdk/react`: the UI half of the SDK. Kept out of the core entry so a Node service or
 * a non-React app never pays for React (build.test.ts asserts the core bundle has no react
 * import). React itself is a peer dependency: the block renders inside the host app's React.
 */
export { AdgateMessageBoundary, useInAssistantMessage } from './message-boundary.js';
export type { AdgateMessageBoundaryProps } from './message-boundary.js';
export {
  ASSISTANT_MESSAGE_ATTRIBUTE,
  ASSISTANT_MESSAGE_SELECTOR,
  isInsideAssistantMessage,
} from './separation.js';
export {
  BOUNDARY_WARNING,
  DISMISS_ARIA_LABEL,
  FALLBACK_DISCLOSURE_LABEL,
  MISSING_LABEL_WARNING,
  SEPARATION_WARNING,
  SLOT_CLASS_NAME,
  SPONSORED_ARIA_LABEL,
  SponsoredSlot,
} from './sponsored-slot.js';
export type { LabelPosition, SponsoredSlotClient, SponsoredSlotProps } from './sponsored-slot.js';
export { DEFAULT_IMPRESSION_THRESHOLD, useImpression } from './use-impression.js';
export type { UseImpressionOptions } from './use-impression.js';
