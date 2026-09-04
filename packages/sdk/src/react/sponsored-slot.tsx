import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { AdgateClient, EvaluateResult, EventType } from '../types.js';
import { useInAssistantMessage } from './message-boundary.js';
import {
  ASSISTANT_MESSAGE_ATTRIBUTE,
  ASSISTANT_MESSAGE_SELECTOR,
  isInsideAssistantMessage,
} from './separation.js';
import { useImpression } from './use-impression.js';

/**
 * The sponsored block: a separate, always labelled region rendered AFTER the assistant's
 * answer, never inside it (docs/policy.md disclosure rules, BUILD_GUIDE 1.8).
 *
 * - suppress, or a serve without a creative: renders null.
 * - serve: the disclosure label as visible text (never a tooltip), the headline, the body, a
 *   CTA anchor with rel="sponsored noopener noreferrer", and a dismiss button.
 * - one impression per audit id, fired when the block enters the viewport.
 *
 * Separation is enforced twice, because the two halves catch different mistakes:
 *
 * 1. React context (message-boundary.tsx). Wrap assistant output in <AdgateMessageBoundary>, or
 *    pass `inAssistantMessage` explicitly. A slot inside it renders null during RENDER, so a
 *    server-rendered page never even serialises the ad. This is the mechanism apps should use.
 * 2. The DOM backstop: after mount, an ancestor carrying data-adgate-message="assistant"
 *    (across shadow boundaries too) blocks the block and warns. It cannot run on the server, so
 *    it only helps an app that has not adopted the boundary. It is re-checked immediately before
 *    the impression fires, in case the block was moved after mount.
 *
 * Either way nothing is rendered and no impression is recorded: an ad inside model output is
 * exactly what adgate exists to prevent.
 *
 * No Next.js, no CSS-in-JS, no router: it is a plain React component that works in any React
 * 18+ app, and it never throws, because the host app must not break because of adgate.
 */
export { ASSISTANT_MESSAGE_ATTRIBUTE, ASSISTANT_MESSAGE_SELECTOR };
export const SPONSORED_ARIA_LABEL = 'Sponsored content';
export const DISMISS_ARIA_LABEL = 'Dismiss sponsored content';
export const SLOT_CLASS_NAME = 'adgate-sponsored-slot';
/** Used when the creative arrives with a blank label: a block is never rendered unlabelled. */
export const FALLBACK_DISCLOSURE_LABEL = 'Sponsored';
export const SEPARATION_WARNING =
  'adgate: SponsoredSlot must not render inside model output. An ancestor has ' +
  `${ASSISTANT_MESSAGE_ATTRIBUTE}="assistant"; render the sponsored block after the assistant ` +
  'message, as a sibling. Nothing was rendered and no impression was recorded.';
export const BOUNDARY_WARNING =
  'adgate: SponsoredSlot must not render inside model output. It is inside an ' +
  'AdgateMessageBoundary (or was given inAssistantMessage); render the sponsored block after ' +
  'the assistant message, as a sibling. Nothing was rendered and no impression was recorded.';
export const MISSING_LABEL_WARNING =
  `adgate: the creative carried a blank disclosure_label; rendered "${FALLBACK_DISCLOSURE_LABEL}" ` +
  'instead. A sponsored block is never shown without a visible label.';

/** Only `track` is used, so any object with that method works (including a full AdgateClient). */
export type SponsoredSlotClient = Pick<AdgateClient, 'track'>;

export type LabelPosition = 'top' | 'bottom';

export type SponsoredSlotProps = {
  /** The gateway's answer for this turn, exactly as `evaluate` resolved it. */
  decision: EvaluateResult;
  client: SponsoredSlotClient;
  /** Called after the dismiss event is sent. The block also hides itself. */
  onDismiss?: () => void;
  /** Merged with the component's own class, so app CSS can style the block. */
  className?: string;
  /** Where the disclosure label sits inside the block. Default 'top' (first exposure). */
  labelPosition?: LabelPosition;
  /**
   * Escape hatch for apps that know they are inside assistant output but cannot wrap it in an
   * AdgateMessageBoundary. True renders nothing, on the server as well as in the browser.
   */
  inAssistantMessage?: boolean;
  /** Extra content rendered inside the block, after the CTA. */
  children?: ReactNode;
};

/** Minimal defaults only: enough to read as a separate block without any stylesheet. */
const styles = {
  container: { border: '1px solid rgba(0, 0, 0, 0.15)', borderRadius: '8px', padding: '0.75rem' },
  label: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' },
  advertiser: { fontSize: '0.75rem', opacity: 0.7, marginLeft: '0.5rem' },
  headline: { fontWeight: 600, margin: '0.25rem 0' },
  body: { margin: '0.25rem 0' },
} satisfies Record<string, CSSProperties>;

/** useLayoutEffect warns during server rendering, where no effect runs at all. */
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

const joinClassNames = (...names: (string | undefined)[]): string =>
  names.filter((name): name is string => name !== undefined && name !== '').join(' ');

/** Tracking is fire and forget: a failed event must never reach the host app. */
const trackSafely = (client: SponsoredSlotClient, auditId: string, type: EventType): void => {
  try {
    void Promise.resolve(client.track(auditId, type)).catch(() => {});
  } catch {
    // Deliberately swallowed: a broken client is not a reason to break the page.
  }
};

export const SponsoredSlot = ({
  decision,
  client,
  onDismiss,
  className,
  labelPosition = 'top',
  inAssistantMessage,
  children,
}: SponsoredSlotProps): ReactElement | null => {
  const containerRef = useRef<HTMLElement | null>(null);
  // A ref as well as state: the guard runs in a layout effect, which React flushes before the
  // passive impression effect of the same commit, so this is already true when the impression
  // callback asks. State alone would only stop the NEXT render.
  const blockedRef = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [dismissedSlot, setDismissedSlot] = useState<string | null>(null);
  // One warning per component per message, including under StrictMode, which deliberately runs
  // every render and every effect twice in development.
  const warnedRef = useRef<Set<string>>(new Set());
  const warnOnce = useCallback((message: string) => {
    if (warnedRef.current.has(message)) {
      return;
    }
    warnedRef.current.add(message);
    console.warn(message);
  }, []);

  const nested = useInAssistantMessage() || inAssistantMessage === true;
  const creative = decision.decision === 'serve' ? decision.creative : null;
  const auditId = decision.audit_id === '' ? null : decision.audit_id;
  const slotId = auditId ?? creative?.id ?? null;
  const dismissed = slotId !== null && dismissedSlot === slotId;
  const hasCreative = creative !== null;
  const canRender = hasCreative && !nested && !blocked && !dismissed;
  // The gateway's schema says min length 1, so this is a broken demand source or a proxy; the
  // block still has to carry a visible label, so fall back to the constant rather than hide it.
  const labelIsBlank = hasCreative && creative.disclosure_label.trim() === '';
  const label =
    labelIsBlank || creative === null ? FALLBACK_DISCLOSURE_LABEL : creative.disclosure_label;

  useEffect(() => {
    if (nested && hasCreative) {
      warnOnce(BOUNDARY_WARNING);
    }
  }, [hasCreative, nested, warnOnce]);

  useEffect(() => {
    if (canRender && labelIsBlank) {
      warnOnce(MISSING_LABEL_WARNING);
    }
  }, [canRender, labelIsBlank, warnOnce]);

  const block = useCallback(() => {
    blockedRef.current = true;
    setBlocked(true);
    warnOnce(SEPARATION_WARNING);
  }, [warnOnce]);

  // DOM backstop. Runs before paint, so a wrongly nested ad is never shown to anyone.
  useIsomorphicLayoutEffect(() => {
    if (blockedRef.current || !canRender) {
      return;
    }
    if (isInsideAssistantMessage(containerRef.current)) {
      block();
    }
  }, [block, canRender]);

  const handleImpression = useCallback(
    (id: string) => {
      if (blockedRef.current) {
        return;
      }
      // Re-checked here and not only at mount: a chat UI may move the node afterwards, and an
      // impression is the moment the ad was actually seen.
      if (isInsideAssistantMessage(containerRef.current)) {
        block();
        return;
      }
      trackSafely(client, id, 'impression');
    },
    [block, client],
  );

  useImpression({
    targetRef: containerRef,
    auditId,
    enabled: canRender,
    onImpression: handleImpression,
  });

  const handleDismiss = useCallback(() => {
    if (auditId !== null) {
      trackSafely(client, auditId, 'dismiss');
    }
    setDismissedSlot(slotId);
    onDismiss?.();
  }, [auditId, client, onDismiss, slotId]);

  if (!canRender || creative === null) {
    return null;
  }

  const labelRow = (
    <div data-adgate-part="label-row">
      <span data-adgate-part="label" style={styles.label}>
        {label}
      </span>
      <span data-adgate-part="advertiser" style={styles.advertiser}>
        {creative.advertiser}
      </span>
    </div>
  );

  return (
    <aside
      ref={containerRef}
      aria-label={SPONSORED_ARIA_LABEL}
      data-adgate-slot="sponsored"
      className={joinClassNames(SLOT_CLASS_NAME, className)}
      style={styles.container}
    >
      {labelPosition === 'top' ? labelRow : null}
      <p data-adgate-part="headline" style={styles.headline}>
        {creative.headline}
      </p>
      <p data-adgate-part="body" style={styles.body}>
        {creative.body}
      </p>
      <a
        data-adgate-part="cta"
        href={creative.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
      >
        {creative.cta}
      </a>
      <button
        data-adgate-part="dismiss"
        type="button"
        aria-label={DISMISS_ARIA_LABEL}
        onClick={handleDismiss}
      >
        &times;
      </button>
      {children}
      {labelPosition === 'bottom' ? labelRow : null}
    </aside>
  );
};
