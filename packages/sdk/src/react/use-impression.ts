import { useEffect, useRef, type RefObject } from 'react';

/**
 * Fires one impression per audit id, the first time the element is actually visible.
 *
 * Everything happens inside an effect, so nothing here runs during render or on the server:
 * `renderToString` never reaches this code. When IntersectionObserver is missing (older
 * browsers, a test environment, jsdom) the impression fires once on mount instead of never,
 * because an unreported impression is worse for the advertiser than a slightly optimistic one.
 */
export type UseImpressionOptions = {
  /** The rendered block. A null ref (nothing rendered yet) means nothing to observe. */
  targetRef: RefObject<HTMLElement | null>;
  /** The record the impression belongs to. A new id fires a new impression; null fires none. */
  auditId: string | null;
  /** False while the slot is suppressed, dismissed or blocked by the separation guard. */
  enabled: boolean;
  /** Called at most once per audit id, from the effect. */
  onImpression: (auditId: string) => void;
  /** Fraction of the block that must be visible to count. Default 0.5. */
  threshold?: number;
};

export const DEFAULT_IMPRESSION_THRESHOLD = 0.5;

export const useImpression = ({
  targetRef,
  auditId,
  enabled,
  onImpression,
  threshold = DEFAULT_IMPRESSION_THRESHOLD,
}: UseImpressionOptions): void => {
  // Survives re-renders and a changing decision object identity: only a different audit id
  // can produce a second impression.
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || auditId === null || auditId === '' || firedForRef.current === auditId) {
      return;
    }
    const element = targetRef.current;
    if (element === null) {
      return;
    }

    let fired = false;
    const fire = () => {
      if (fired || firedForRef.current === auditId) {
        return;
      }
      fired = true;
      firedForRef.current = auditId;
      onImpression(auditId);
    };

    // Read off globalThis inside the effect: on the server this line is never reached.
    const Observer: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver;
    if (typeof Observer !== 'function') {
      fire();
      return;
    }

    // Declared first so a stub that calls back synchronously from observe() cannot hit a TDZ.
    let observer: IntersectionObserver | null = null;
    observer = new Observer(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          fire();
          observer?.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(element);
    return () => {
      observer?.disconnect();
    };
  }, [auditId, enabled, onImpression, targetRef, threshold]);
};
