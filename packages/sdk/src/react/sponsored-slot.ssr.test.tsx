// This file deliberately carries no jsdom docblock (the other React test files do), so it runs
// in the default node environment, where there is no window, no document and no
// IntersectionObserver, exactly like a Next.js or Remix server render. If the component touched
// any of them during render, this test would throw.
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVE_BODY } from '../test-support.js';
import { SPONSORED_ARIA_LABEL, SponsoredSlot } from './sponsored-slot.js';
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
});
