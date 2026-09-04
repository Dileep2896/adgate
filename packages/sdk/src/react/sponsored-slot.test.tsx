// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_ID, SERVE_BODY } from '../test-support.js';
import {
  DISMISS_ARIA_LABEL,
  FALLBACK_DISCLOSURE_LABEL,
  MISSING_LABEL_WARNING,
  SEPARATION_WARNING,
  SLOT_CLASS_NAME,
  SPONSORED_ARIA_LABEL,
  SponsoredSlot,
} from './sponsored-slot.js';
import {
  fakeTrackClient,
  installIntersectionObserver,
  serveDecision,
  serveWithoutCreative,
  suppressDecision,
  type IntersectionObserverStub,
} from './test-support.js';

/**
 * What the block must look like and what it must refuse to do. Impression timing lives in
 * impression.test.tsx; server rendering in sponsored-slot.ssr.test.tsx.
 */
const CREATIVE = SERVE_BODY.creative;

const silenceWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

let observers: IntersectionObserverStub;
let warn: ReturnType<typeof silenceWarn>;

beforeEach(() => {
  observers = installIntersectionObserver();
  warn = silenceWarn();
});

afterEach(() => {
  cleanup();
  observers.restore();
  warn.mockRestore();
});

describe('SponsoredSlot rendering', () => {
  it('renders nothing at all for a suppress decision', () => {
    const client = fakeTrackClient();
    const { container } = render(<SponsoredSlot decision={suppressDecision()} client={client} />);

    expect(container).toBeEmptyDOMElement();
    expect(client.calls).toEqual([]);
    expect(observers.records).toHaveLength(0);
  });

  it('renders nothing for a serve decision that carries no creative', () => {
    const client = fakeTrackClient();
    const { container } = render(
      <SponsoredSlot decision={serveWithoutCreative()} client={client} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(client.calls).toEqual([]);
  });

  it('renders one labelled block with the headline, the body and the CTA', () => {
    render(<SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />);

    const block = screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL });
    expect(block).toHaveAttribute('aria-label', SPONSORED_ARIA_LABEL);
    // The disclosure label is visible text, never a tooltip or a title attribute.
    const label = screen.getByText(CREATIVE.disclosure_label);
    expect(label).toBeVisible();
    expect(block).not.toHaveAttribute('title');
    expect(label).not.toHaveAttribute('title');
    expect(block).toContainElement(label);
    expect(screen.getByText(CREATIVE.headline)).toBeVisible();
    expect(screen.getByText(CREATIVE.body)).toBeVisible();
    expect(screen.getByText(CREATIVE.advertiser)).toBeVisible();
  });

  it('renders the fallback label and warns once when the creative label is blank', () => {
    const decision = serveDecision();
    if (decision.creative !== null) {
      decision.creative.disclosure_label = ' \t ';
    }
    const { rerender } = render(<SponsoredSlot decision={decision} client={fakeTrackClient()} />);

    const block = screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL });
    expect(block).toContainElement(screen.getByText(FALLBACK_DISCLOSURE_LABEL));
    expect(screen.getByText(CREATIVE.headline)).toBeVisible();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(MISSING_LABEL_WARNING);

    rerender(<SponsoredSlot decision={decision} client={fakeTrackClient()} />);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('links the CTA out with rel="sponsored noopener noreferrer" in a new tab', () => {
    render(<SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />);

    const cta = screen.getByRole('link', { name: CREATIVE.cta });
    expect(cta).toHaveAttribute('href', CREATIVE.url);
    expect(cta).toHaveAttribute('rel', 'sponsored noopener noreferrer');
    expect(cta).toHaveAttribute('target', '_blank');
  });

  it('merges className with its own class and keeps the default styles minimal', () => {
    render(
      <SponsoredSlot
        decision={serveDecision()}
        client={fakeTrackClient()}
        className="my-slot other"
      />,
    );

    const block = screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL });
    expect(block.className).toBe(`${SLOT_CLASS_NAME} my-slot other`);
    // A border and some padding, nothing else, and no injected stylesheet: no CSS-in-JS here.
    expect(block.style.padding).toBe('0.75rem');
    expect(block.style.borderRadius).toBe('8px');
    expect(block.style.position).toBe('');
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('puts the label after the ad content when labelPosition is bottom, and renders children', () => {
    render(
      <SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} labelPosition="bottom">
        <span>extra</span>
      </SponsoredSlot>,
    );

    const block = screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL });
    const text = block.textContent ?? '';
    expect(text.indexOf(CREATIVE.disclosure_label)).toBeGreaterThan(
      text.indexOf(CREATIVE.headline),
    );
    expect(screen.getByText('extra')).toBeVisible();
  });
});

describe('SponsoredSlot dismiss', () => {
  it('tracks a dismiss event for the audit id and then calls onDismiss', () => {
    const order: string[] = [];
    const onDismiss = vi.fn(() => {
      order.push('onDismiss');
    });
    const tracking = fakeTrackClient((call) => {
      order.push(`track:${call.type}`);
      return Promise.resolve({ ok: true as const, status: 204 });
    });
    render(<SponsoredSlot decision={serveDecision()} client={tracking} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: DISMISS_ARIA_LABEL }));

    expect(tracking.calls).toEqual([{ auditId: AUDIT_ID, type: 'dismiss' }]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['track:dismiss', 'onDismiss']);
  });

  it('hides the block after a dismiss, without an onDismiss handler', () => {
    const client = fakeTrackClient();
    render(<SponsoredSlot decision={serveDecision()} client={client} />);

    fireEvent.click(screen.getByRole('button', { name: DISMISS_ARIA_LABEL }));

    expect(screen.queryByRole('complementary')).toBeNull();
    expect(client.typesFor('dismiss')).toHaveLength(1);
  });

  it('never lets a failing client reach the app', () => {
    const throwing = {
      track: () => {
        throw new Error('client is broken');
      },
    };
    const onDismiss = vi.fn();
    render(<SponsoredSlot decision={serveDecision()} client={throwing} onDismiss={onDismiss} />);

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: DISMISS_ARIA_LABEL })),
    ).not.toThrow();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('SponsoredSlot separation guard', () => {
  it('renders nothing and warns once inside an assistant message', () => {
    const client = fakeTrackClient();
    const { container } = render(
      <div data-adgate-message="assistant">
        <SponsoredSlot decision={serveDecision()} client={client} />
      </div>,
    );

    expect(container.querySelector('[data-adgate-slot="sponsored"]')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText(CREATIVE.headline)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(SEPARATION_WARNING);
    expect(SEPARATION_WARNING).toMatch(/must not render inside model output/);
  });

  it('records no impression when the guard trips, even once visible', () => {
    const client = fakeTrackClient();
    render(
      <div data-adgate-message="assistant">
        <SponsoredSlot decision={serveDecision()} client={client} />
      </div>,
    );

    expect(client.calls).toEqual([]);
    for (let index = 0; index < observers.records.length; index += 1) {
      observers.enter(index);
    }
    expect(client.calls).toEqual([]);
  });

  it('warns only once under StrictMode, which runs every effect twice', () => {
    const client = fakeTrackClient();
    render(
      <StrictMode>
        <div data-adgate-message="assistant">
          <SponsoredSlot decision={serveDecision()} client={client} />
        </div>
      </StrictMode>,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it('warns once for a nested slot and once more for a second, separate one', () => {
    const client = fakeTrackClient();
    render(
      <div data-adgate-message="assistant">
        <SponsoredSlot decision={serveDecision()} client={client} />
        <SponsoredSlot decision={serveDecision()} client={client} />
      </div>,
    );

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('renders normally when the assistant message is a sibling, not an ancestor', () => {
    render(
      <div>
        <div data-adgate-message="assistant">the answer</div>
        <SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />
      </div>,
    );

    expect(screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL })).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });
});
