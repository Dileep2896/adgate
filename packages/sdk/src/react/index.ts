/**
 * `@adgate/sdk/react`: the UI half of the SDK. Kept out of the core entry so a Node service or
 * a non-React app never pays for React (build.test.ts asserts the core bundle has no react
 * import). React itself is a peer dependency: the block renders inside the host app's React.
 */
export {
  ASSISTANT_MESSAGE_ATTRIBUTE,
  ASSISTANT_MESSAGE_SELECTOR,
  DISMISS_ARIA_LABEL,
  SEPARATION_WARNING,
  SLOT_CLASS_NAME,
  SPONSORED_ARIA_LABEL,
  SponsoredSlot,
} from './sponsored-slot.js';
export type { LabelPosition, SponsoredSlotClient, SponsoredSlotProps } from './sponsored-slot.js';
export { DEFAULT_IMPRESSION_THRESHOLD, useImpression } from './use-impression.js';
export type { UseImpressionOptions } from './use-impression.js';
