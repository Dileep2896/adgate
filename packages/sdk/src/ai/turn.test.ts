import { describe, expect, it } from 'vitest';

import type { EvaluateResult } from '../types.js';
import {
  createTurnStore,
  finishReasonOf,
  isTurnFinal,
  MAX_TRACKED_TURNS,
  newConversationId,
  turnKey,
} from './turn.js';

/** The store only ever holds promises; their contents do not matter here. */
const evaluation = (id: string): Promise<EvaluateResult> =>
  Promise.resolve({ audit_id: id } as EvaluateResult);

describe('createTurnStore', () => {
  it('returns the running evaluation for a turn it already knows', () => {
    const store = createTurnStore();
    const first = evaluation('a');
    store.set('k', first);

    expect(store.get('k')).toBe(first);
    expect(store.get('other')).toBeUndefined();
  });

  it('forgets a turn that ended', () => {
    const store = createTurnStore();
    store.set('k', evaluation('a'));
    store.end('k');

    expect(store.get('k')).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('is bounded: an abandoned turn is evicted by age, not leaked', () => {
    const store = createTurnStore(3);
    for (const key of ['a', 'b', 'c', 'd']) {
      store.set(key, evaluation(key));
    }

    expect(store.size()).toBe(3);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('d')).toBeDefined();
  });

  it('defaults to a small bound', () => {
    const store = createTurnStore();
    for (let index = 0; index < MAX_TRACKED_TURNS + 5; index += 1) {
      store.set(`k${index}`, evaluation('x'));
    }

    expect(store.size()).toBe(MAX_TRACKED_TURNS);
  });
});

describe('turnKey', () => {
  it('cannot confuse two different id pairs', () => {
    expect(turnKey('a', 'b')).toBe(turnKey('a', 'b'));
    expect(turnKey('a_b', 'c')).not.toBe(turnKey('a', 'b_c'));
  });
});

describe('newConversationId', () => {
  it('is prefixed and different every time', () => {
    const ids = new Set(Array.from({ length: 50 }, newConversationId));

    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^adgate_[a-z0-9]+$/);
    }
  });
});

describe('finishReasonOf', () => {
  it.each([
    ['the v5 object', { unified: 'tool-calls', raw: 'tool_calls' }, 'tool-calls'],
    ['a bare string', 'stop', 'stop'],
    ['nothing', undefined, null],
    ['null', null, null],
    ['an object without a unified reason', { raw: 'stop' }, null],
  ])('reads %s', (_name, value, expected) => {
    expect(finishReasonOf(value)).toBe(expected);
  });
});

describe('isTurnFinal', () => {
  it('is false only for a tool-call step', () => {
    expect(isTurnFinal('tool-calls')).toBe(false);
    expect(isTurnFinal('stop')).toBe(true);
    expect(isTurnFinal('length')).toBe(true);
    // Unknown beats never attesting at all: an intermediate hash is better than no record.
    expect(isTurnFinal(null)).toBe(true);
  });
});
