// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVE_BODY } from '../test-support.js';
import { AdgateMessageBoundary } from './message-boundary.js';
import { ASSISTANT_MESSAGE_ATTRIBUTE, isInsideAssistantMessage } from './separation.js';
import { BOUNDARY_WARNING, SEPARATION_WARNING, SponsoredSlot } from './sponsored-slot.js';
import {
  fakeTrackClient,
  installIntersectionObserver,
  serveDecision,
  type IntersectionObserverStub,
} from './test-support.js';

/**
 * Separation: an ad may never render inside model output. The React boundary is the mechanism
 * (it works during render, so it also covers server rendering); the DOM ancestor check is the
 * backstop for an app that has not adopted it yet.
 */
const CREATIVE = SERVE_BODY.creative;

const silenceWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

let observers: IntersectionObserverStub;
let warn: ReturnType<typeof silenceWarn>;
const mounted: HTMLElement[] = [];

beforeEach(() => {
  observers = installIntersectionObserver();
  warn = silenceWarn();
});

afterEach(() => {
  cleanup();
  for (const node of mounted.splice(0)) {
    node.remove();
  }
  observers.restore();
  warn.mockRestore();
});

describe('SponsoredSlot inside an AdgateMessageBoundary', () => {
  it('renders nothing, records nothing and warns once', () => {
    const client = fakeTrackClient();
    const { container } = render(
      <AdgateMessageBoundary>
        <SponsoredSlot decision={serveDecision()} client={client} />
      </AdgateMessageBoundary>,
    );

    expect(container.querySelector('[data-adgate-slot="sponsored"]')).toBeNull();
    expect(screen.queryByText(CREATIVE.headline)).toBeNull();
    expect(observers.records).toHaveLength(0);
    expect(client.calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(BOUNDARY_WARNING);
  });

  it('warns once under StrictMode, which runs every effect twice', () => {
    render(
      <StrictMode>
        <AdgateMessageBoundary>
          <SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />
        </AdgateMessageBoundary>
      </StrictMode>,
    );

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('renders normally after the boundary, which is where the block belongs', () => {
    render(
      <div>
        <AdgateMessageBoundary>
          <p>the answer</p>
        </AdgateMessageBoundary>
        <SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />
      </div>,
    );

    expect(screen.getByText(CREATIVE.headline)).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });

  it('honours the inAssistantMessage escape hatch without any boundary', () => {
    const client = fakeTrackClient();
    const { container } = render(
      <SponsoredSlot decision={serveDecision()} client={client} inAssistantMessage />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(client.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(BOUNDARY_WARNING);
  });
});

describe('the DOM backstop', () => {
  it('sees through a shadow root: closest alone would miss the host tree', () => {
    const assistant = document.createElement('div');
    assistant.setAttribute(ASSISTANT_MESSAGE_ATTRIBUTE, 'assistant');
    const host = document.createElement('div');
    assistant.appendChild(host);
    document.body.appendChild(assistant);
    mounted.push(assistant);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);

    const client = fakeTrackClient();
    render(<SponsoredSlot decision={serveDecision()} client={client} />, { container: mount });

    expect(shadow.querySelector('[data-adgate-slot="sponsored"]')).toBeNull();
    expect(client.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(SEPARATION_WARNING);
  });

  it('still renders in a shadow root that no assistant message hosts', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mounted.push(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);

    render(<SponsoredSlot decision={serveDecision()} client={fakeTrackClient()} />, {
      container: mount,
    });

    expect(shadow.querySelector('[data-adgate-slot="sponsored"]')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('re-checks the ancestors just before the impression fires', () => {
    const client = fakeTrackClient();
    render(
      <div data-testid="turn">
        <SponsoredSlot decision={serveDecision()} client={client} />
      </div>,
    );
    expect(screen.getByRole('complementary')).toBeVisible();

    // The app turns the surrounding node into assistant output after mount: the mount-time
    // guard has already run and passed, so only the impression-time check can catch this.
    screen.getByTestId('turn').setAttribute(ASSISTANT_MESSAGE_ATTRIBUTE, 'assistant');
    observers.enter();

    expect(client.calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(SEPARATION_WARNING);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('isInsideAssistantMessage', () => {
  it('answers false for a null element and for a detached one', () => {
    expect(isInsideAssistantMessage(null)).toBe(false);
    expect(isInsideAssistantMessage(document.createElement('div'))).toBe(false);
  });
});
