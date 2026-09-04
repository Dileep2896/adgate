// @vitest-environment jsdom
import type { EvaluateResult, EventType, TrackResult } from '@adgate/sdk';
import type { SponsoredSlotClient } from '@adgate/sdk/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ADGATE_DATA_PART_TYPE, type ChatMessage } from '@/lib/chat';
import { AssistantTurn } from './assistant-turn';

/**
 * The acceptance criterion "the slot is rendered outside the assistant message container",
 * checked against the DOM the app actually produces rather than by reading the JSX.
 */

const ASSISTANT_SELECTOR = '[data-adgate-message="assistant"]';
const SLOT_SELECTOR = '[data-adgate-slot="sponsored"]';

const ANSWER = 'Start with a managed Postgres on a free tier.';

const CLASSIFICATION: EvaluateResult['classification'] = {
  commercial_intent: 0.84,
  categories: ['software.devtools.database'],
  sensitive: [],
  confidence: 0.91,
  method: 'rules',
  prompt_version: 'sha256:test',
};

const SERVE: EvaluateResult = {
  decision: 'serve',
  reason: null,
  classification: CLASSIFICATION,
  creative: {
    id: 'cr_01J0000000000000000000TEST',
    advertiser: 'Example DB Cloud',
    headline: 'Managed Postgres with a free tier',
    body: 'Spin up a database in 30 seconds. No credit card.',
    cta: 'Try it free',
    url: 'http://localhost:8787/c/aud_01J0000000000000000000TEST',
    source: 'direct',
    disclosure_label: 'Sponsored',
  },
  audit_id: 'aud_01J0000000000000000000TEST',
  latency_ms: 42,
};

const PAID_SUPPRESS: EvaluateResult = {
  decision: 'suppress',
  reason: 'paid_user',
  classification: CLASSIFICATION,
  creative: null,
  audit_id: 'aud_01J0000000000000000000PAID',
  latency_ms: 9,
};

const assistantMessage = (decision: EvaluateResult | null): ChatMessage => ({
  id: 'msg_1',
  role: 'assistant',
  parts:
    decision === null
      ? [{ type: 'text', text: ANSWER }]
      : [
          { type: 'text', text: ANSWER },
          { type: ADGATE_DATA_PART_TYPE, id: 'turn_1', data: decision },
        ],
});

const trackingClient = (): SponsoredSlotClient & { calls: { id: string; type: EventType }[] } => {
  const calls: { id: string; type: EventType }[] = [];
  return {
    calls,
    track: (auditId: string, type: EventType): Promise<TrackResult> => {
      calls.push({ id: auditId, type });
      return Promise.resolve({ ok: true, status: 204 });
    },
  };
};

afterEach(cleanup);

describe('AssistantTurn', () => {
  it('renders the sponsored block outside and after the assistant message container', () => {
    const { container } = render(
      <AssistantTurn message={assistantMessage(SERVE)} client={trackingClient()} streaming={false} />,
    );

    const assistant = container.querySelector(ASSISTANT_SELECTOR);
    const slot = container.querySelector(SLOT_SELECTOR);
    expect(assistant).not.toBeNull();
    expect(slot).not.toBeNull();

    // The whole point of adgate: the ad is not inside model output.
    expect(assistant?.contains(slot ?? null)).toBe(false);
    expect(slot?.closest(ASSISTANT_SELECTOR)).toBeNull();
    const position = assistant?.compareDocumentPosition(slot as Node) ?? 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(assistant?.textContent).toContain(ANSWER);
    expect(assistant?.textContent).not.toContain(SERVE.creative?.headline);
    expect(slot?.textContent).toContain('Sponsored');
    expect(slot?.textContent).toContain('Managed Postgres with a free tier');
  });

  it('records exactly one impression for the audit id', () => {
    const client = trackingClient();
    render(<AssistantTurn message={assistantMessage(SERVE)} client={client} streaming={false} />);
    expect(client.calls).toEqual([{ id: SERVE.audit_id, type: 'impression' }]);
  });

  it('renders no block and shows the suppress reason for a paid user', () => {
    const { container } = render(
      <AssistantTurn
        message={assistantMessage(PAID_SUPPRESS)}
        client={trackingClient()}
        streaming={false}
      />,
    );

    expect(container.querySelector(SLOT_SELECTOR)).toBeNull();
    expect(container.textContent).toContain('paid_user');
    expect(container.querySelector(ASSISTANT_SELECTOR)?.textContent).toContain(ANSWER);
  });

  it('waits for the finished answer before rendering anything sponsored', () => {
    const { container } = render(
      <AssistantTurn message={assistantMessage(SERVE)} client={trackingClient()} streaming />,
    );

    expect(container.querySelector(SLOT_SELECTOR)).toBeNull();
    expect(container.querySelector('[data-testid="adgate-block"]')).toBeNull();
  });

  it('renders the answer alone while no decision has arrived', () => {
    const { container } = render(
      <AssistantTurn message={assistantMessage(null)} client={trackingClient()} streaming={false} />,
    );

    expect(container.querySelector(SLOT_SELECTOR)).toBeNull();
    expect(container.querySelector(ASSISTANT_SELECTOR)?.textContent).toContain(ANSWER);
  });
});
