import { act } from 'react';

import { AUDIT_ID, SERVE_BODY, SUPPRESS_BODY } from '../test-support.js';
import type { EvaluateResult, EventType, TrackResult } from '../types.js';

/**
 * Fakes shared by the React entry tests. Nothing here touches the network or a real
 * IntersectionObserver: the client only records what it was asked to track, and the observer
 * stub lets a test say exactly when the block became visible.
 */
export const SECOND_AUDIT_ID = 'aud_01J0000000000000000000NEXT';

/**
 * The wire fixtures are `as const` (readonly) because they are also used as raw response
 * bodies; the component takes a mutable EvaluateResult, so clone and widen once here.
 */
const decisionOf = (body: unknown): EvaluateResult => structuredClone(body) as EvaluateResult;

export const serveDecision = (auditId: string = AUDIT_ID): EvaluateResult => ({
  ...decisionOf(SERVE_BODY),
  audit_id: auditId,
});

export const suppressDecision = (): EvaluateResult => decisionOf(SUPPRESS_BODY);

/** A serve whose creative is missing: the gateway never sends this, but a caller could. */
export const serveWithoutCreative = (): EvaluateResult => ({
  ...serveDecision(),
  creative: null,
});

export type TrackCall = { auditId: string; type: EventType };

export type FakeTrackClient = {
  calls: TrackCall[];
  typesFor(type: EventType): TrackCall[];
  track(auditId: string, type: EventType): Promise<TrackResult>;
};

export const fakeTrackClient = (
  respond: (call: TrackCall) => Promise<TrackResult> = () =>
    Promise.resolve({ ok: true, status: 204 }),
): FakeTrackClient => {
  const calls: TrackCall[] = [];
  return {
    calls,
    typesFor: (type) => calls.filter((call) => call.type === type),
    track: (auditId, type) => {
      const call = { auditId, type };
      calls.push(call);
      return respond(call);
    },
  };
};

export type ObserverRecord = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  targets: Element[];
  disconnects: number;
};

export type IntersectionObserverStub = {
  records: ObserverRecord[];
  /** Reports the target of one observer (the newest by default) as visible. */
  enter(index?: number): void;
  /** Reports it as not visible, which must never count as an impression. */
  leave(index?: number): void;
  restore(): void;
};

const setIntersectionObserver = (value: typeof IntersectionObserver | undefined): (() => void) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  const undo = () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, 'IntersectionObserver');
      return;
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', previous);
  };
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    return undo;
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value,
    configurable: true,
    writable: true,
  });
  return undo;
};

/** Installs a controllable IntersectionObserver on globalThis; jsdom ships none. */
export const installIntersectionObserver = (): IntersectionObserverStub => {
  const records: ObserverRecord[] = [];
  class Stub {
    private readonly record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = { callback, options, targets: [], disconnects: 0 };
      records.push(this.record);
    }
    observe(target: Element): void {
      this.record.targets.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
      this.record.disconnects += 1;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  const report = (isIntersecting: boolean, index?: number) => {
    const record = records[index ?? records.length - 1];
    if (record === undefined) {
      throw new Error('no IntersectionObserver was created');
    }
    const entries = record.targets.map(
      (target) => ({ isIntersecting, target }) as IntersectionObserverEntry,
    );
    act(() => {
      record.callback(entries, null as unknown as IntersectionObserver);
    });
  };
  return {
    records,
    enter: (index) => {
      report(true, index);
    },
    leave: (index) => {
      report(false, index);
    },
    restore: setIntersectionObserver(Stub as unknown as typeof IntersectionObserver),
  };
};

/** Removes IntersectionObserver entirely, for the degraded path. Returns the undo. */
export const removeIntersectionObserver = (): (() => void) => setIntersectionObserver(undefined);
