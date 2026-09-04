// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ID } from '../test-support.js';
import { SponsoredSlot, SPONSORED_ARIA_LABEL } from './sponsored-slot.js';
import {
  fakeTrackClient,
  installIntersectionObserver,
  removeIntersectionObserver,
  SECOND_AUDIT_ID,
  serveDecision,
  suppressDecision,
  type IntersectionObserverStub,
} from './test-support.js';

/**
 * One impression per audit id, at first exposure. Over-counting is fraud and under-counting
 * costs the publisher money, so this is the most load-bearing behaviour of the component.
 */
let observers: IntersectionObserverStub;

beforeEach(() => {
  observers = installIntersectionObserver();
});

afterEach(() => {
  cleanup();
  observers.restore();
});

describe('SponsoredSlot impression', () => {
  it('observes the rendered block but records nothing before it is visible', () => {
    const client = fakeTrackClient();
    render(<SponsoredSlot decision={serveDecision()} client={client} />);

    expect(observers.records).toHaveLength(1);
    expect(observers.records[0]?.targets[0]).toBe(
      screen.getByRole('complementary', { name: SPONSORED_ARIA_LABEL }),
    );
    expect(client.calls).toEqual([]);

    observers.leave();
    expect(client.calls).toEqual([]);
  });

  it('records exactly one impression when the block becomes visible', () => {
    const client = fakeTrackClient();
    render(<SponsoredSlot decision={serveDecision()} client={client} />);

    observers.enter();

    expect(client.calls).toEqual([{ auditId: AUDIT_ID, type: 'impression' }]);
    // The observer is disconnected as soon as it has done its job.
    expect(observers.records[0]?.disconnects).toBeGreaterThan(0);
  });

  it('never records a second impression: repeated callbacks and re-renders', () => {
    const client = fakeTrackClient();
    const { rerender } = render(<SponsoredSlot decision={serveDecision()} client={client} />);

    observers.enter();
    observers.enter();
    // A fresh decision object with the same audit id: identity changed, the record did not.
    rerender(<SponsoredSlot decision={serveDecision()} client={client} />);
    rerender(<SponsoredSlot decision={serveDecision()} client={client} />);
    for (let index = 0; index < observers.records.length; index += 1) {
      observers.enter(index);
    }

    expect(client.typesFor('impression')).toEqual([{ auditId: AUDIT_ID, type: 'impression' }]);
  });

  it('never re-observes when only the client object identity changes', () => {
    const client = fakeTrackClient();
    const { rerender } = render(<SponsoredSlot decision={serveDecision()} client={client} />);
    observers.enter();

    // An app that builds its client inline hands a new object on every render; that must not
    // restart the impression logic for a record that already counted.
    rerender(<SponsoredSlot decision={serveDecision()} client={{ track: client.track }} />);
    expect(observers.records).toHaveLength(1);

    observers.enter();
    expect(client.typesFor('impression')).toHaveLength(1);
  });

  it('records one impression under StrictMode, which runs every effect twice', () => {
    const client = fakeTrackClient();
    render(
      <StrictMode>
        <SponsoredSlot decision={serveDecision()} client={client} />
      </StrictMode>,
    );

    for (let index = 0; index < observers.records.length; index += 1) {
      observers.enter(index);
    }

    expect(client.typesFor('impression')).toEqual([{ auditId: AUDIT_ID, type: 'impression' }]);
  });

  it('records a new impression when a new audit id is rendered', () => {
    const client = fakeTrackClient();
    const { rerender } = render(<SponsoredSlot decision={serveDecision()} client={client} />);
    observers.enter();

    rerender(<SponsoredSlot decision={serveDecision(SECOND_AUDIT_ID)} client={client} />);
    observers.enter();

    expect(client.typesFor('impression')).toEqual([
      { auditId: AUDIT_ID, type: 'impression' },
      { auditId: SECOND_AUDIT_ID, type: 'impression' },
    ]);
  });

  it('records nothing for a suppress decision', () => {
    const client = fakeTrackClient();
    render(<SponsoredSlot decision={suppressDecision()} client={client} />);

    expect(observers.records).toHaveLength(0);
    expect(client.calls).toEqual([]);
  });

  it('survives a client whose track rejects', () => {
    const client = fakeTrackClient(() => Promise.reject(new Error('offline')));
    render(<SponsoredSlot decision={serveDecision()} client={client} />);

    expect(() => {
      observers.enter();
    }).not.toThrow();
    expect(client.calls).toHaveLength(1);
  });
});

describe('SponsoredSlot impression without IntersectionObserver', () => {
  it('records one impression on mount and never a second one', () => {
    const restore = removeIntersectionObserver();
    try {
      const client = fakeTrackClient();
      const { rerender } = render(<SponsoredSlot decision={serveDecision()} client={client} />);

      expect(client.calls).toEqual([{ auditId: AUDIT_ID, type: 'impression' }]);

      rerender(<SponsoredSlot decision={serveDecision()} client={client} />);
      expect(client.typesFor('impression')).toHaveLength(1);

      rerender(<SponsoredSlot decision={serveDecision(SECOND_AUDIT_ID)} client={client} />);
      expect(client.typesFor('impression')).toEqual([
        { auditId: AUDIT_ID, type: 'impression' },
        { auditId: SECOND_AUDIT_ID, type: 'impression' },
      ]);
    } finally {
      restore();
    }
  });
});
