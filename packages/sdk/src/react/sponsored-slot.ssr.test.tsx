// This file deliberately carries no jsdom docblock (the other React test files do), so it runs
// in the default node environment, where there is no window, no document and no
// IntersectionObserver, exactly like a Next.js or Remix server render. If the component touched
// any of them during render, this test would throw.
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVE_BODY } from '../test-support.js';
import { AdgateMessageBoundary } from './message-boundary.js';
import {
  FALLBACK_DISCLOSURE_LABEL,
  SPONSORED_ARIA_LABEL,
  SponsoredSlot,
} from './sponsored-slot.js';
import { fakeTrackClient, serveDecision, suppressDecision } from './test-support.js';

const CREATIVE = SERVE_BODY.creative;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SponsoredSlot server rendering', () => {
  it('has no browser globals to touch', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect('IntersectionObserver' in globalThis).toBe(false);
  });

  it('renders the labelled block to a string and records nothing', () => {
    const client = fakeTrackClient();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const html = renderToString(<SponsoredSlot decision={serveDecision()} client={client} />);

    expect(html).toContain(`aria-label="${SPONSORED_ARIA_LABEL}"`);
    expect(html).toContain('rel="sponsored noopener noreferrer"');
    expect(html).toContain(`href="${CREATIVE.url}"`);
    expect(html).toContain(CREATIVE.disclosure_label);
    expect(html).toContain(CREATIVE.headline);
    expect(html).toContain(CREATIVE.body);
    // No effect runs on the server: no impression, and no useLayoutEffect warning either.
    expect(client.calls).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('renders an empty string for a suppress decision', () => {
    const client = fakeTrackClient();

    expect(renderToString(<SponsoredSlot decision={suppressDecision()} client={client} />)).toBe(
      '',
    );
    expect(client.calls).toEqual([]);
  });

  it('serialises no ad markup inside an AdgateMessageBoundary', () => {
    const client = fakeTrackClient();

    const html = renderToString(
      <div>
        <AdgateMessageBoundary>
          <p>the answer</p>
          <SponsoredSlot decision={serveDecision()} client={client} />
        </AdgateMessageBoundary>
      </div>,
    );

    // The DOM guard cannot run here at all, so the boundary is the only thing standing between
    // the ad and the HTML the browser receives.
    expect(html).toContain('the answer');
    expect(html).not.toContain('data-adgate-slot');
    expect(html).not.toContain(CREATIVE.headline);
    expect(html).not.toContain(CREATIVE.url);
    expect(client.calls).toEqual([]);
  });

  it('serialises no ad markup when inAssistantMessage is set', () => {
    const html = renderToString(
      <SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} inAssistantMessage />,
    );

    expect(html).toBe('');
  });

  it('falls back to a constant label when the creative carries a blank one', () => {
    const decision = serveDecision();
    if (decision.creative !== null) {
      decision.creative.disclosure_label = '   ';
    }

    const html = renderToString(<SponsoredSlot decision={decision} client={fakeTrackClient()} />);

    // Never an unlabelled block, not even in the first server-rendered paint.
    expect(html).toContain(FALLBACK_DISCLOSURE_LABEL);
    expect(html).toContain(CREATIVE.headline);
  });
});
