/**
 * The copy-paste snippets that wire an app to this gateway, with its real app id already in
 * them. Shown twice: on the screen that mints an app's first key, and permanently on the
 * app's own page.
 *
 * THEY ARE LIFTED FROM docs/integration.md, NOT WRITTEN FROM MEMORY. Every `ts`, `tsx` and
 * `python` block in that guide is compile checked on each run - packages/sdk's
 * docs-snippets.test.ts type checks the TypeScript against the SDK sources, and
 * packages/sdk-python's test_docs_snippets.py compiles the Python and resolves its imports -
 * so the guide is the one place in the repo where an SDK snippet is known to be true. The
 * two edits made here are the ones the dashboard can make and the guide cannot: the app id
 * placeholder becomes this operator's real id, and the api_key literal becomes the name of
 * an environment variable. lib/integration-snippets.test.ts holds those lines against the
 * guide so the pair cannot drift apart silently.
 *
 * A KEY IS NEVER IN HERE. The snippets name `ADGATE_API_KEY`; the secret itself is readable
 * exactly once, on the screen that issues it, and is never re-rendered afterwards.
 *
 * Pure and import free, so the client panel that renders it carries nothing else into the
 * browser bundle.
 */

/** The environment variables the snippets name. The key is never inlined. */
export const API_KEY_ENV = 'ADGATE_API_KEY';
export const BASE_URL_ENV = 'ADGATE_BASE_URL';

/** The placeholder docs/integration.md uses wherever a real app id belongs. */
export const APP_ID_PLACEHOLDER = 'app_01J...';

export type IntegrationSnippetId = 'server' | 'react' | 'python';

export interface IntegrationSnippet {
  id: IntegrationSnippetId;
  /** Tab label. Short: it sits in a segmented control. */
  label: string;
  /** A plausible file name for the code, shown on the well's bar. */
  filename: string;
  /**
   * The copy button's label, written out rather than assembled from the tab label at render
   * time. A one-line reason: the gateway's SQL parameterization audit reads every .ts and
   * .tsx file in the repo and flags an untagged template literal that starts with a SQL verb
   * and interpolates - and `Copy ${...} snippet` starts with COPY. Keeping the label as data
   * is clearer here anyway, and it means a UI string never has to be argued about in a
   * security allow list.
   */
  copyLabel: string;
  /** What this piece does, in one line, above the code. */
  summary: string;
  code: string;
}

const serverCode = (
  appId: string,
): string => `import { createClient, type EvaluateResult } from '@adgateio/sdk';
import { adgateMiddleware } from '@adgateio/sdk/ai';
import { streamText, wrapLanguageModel } from 'ai';

// One client per process. createClient throws at boot if the key is missing.
const baseUrl = process.env.${BASE_URL_ENV} ?? 'http://localhost:8787';
const adgate = createClient({ apiKey: process.env.${API_KEY_ENV} ?? '', baseUrl });

/** Your provider's model object, e.g. \`openai('gpt-4o-mini')\` from \`@ai-sdk/openai\`. */
type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model'];

export const chatTurn = (
  model: ProviderModel,
  turn: { prompt: string; conversationId: string; turnId: string; tier: string },
  /** Fires once. Send the decision to the browser as its own message part. */
  onDecision: (decision: EvaluateResult) => void,
) =>
  streamText({
    model: wrapLanguageModel({
      model,
      middleware: adgateMiddleware(adgate, {
        appId: '${appId}',
        surface: 'chat',
        getUser: () => ({ tier: turn.tier, region: 'US', locale: 'en-US' }),
        conversationId: () => turn.conversationId,
        turnId: () => turn.turnId,
        onDecision,
      }),
    }),
    prompt: turn.prompt,
  });
`;

const REACT_CODE = `'use client';

import type { EvaluateResult } from '@adgateio/sdk';
import { AdgateMessageBoundary, SponsoredSlot, type SponsoredSlotClient } from '@adgateio/sdk/react';
import type { ReactElement } from 'react';

export type AssistantTurnProps = {
  answer: string;
  /** null until the gateway has answered for this turn. */
  decision: EvaluateResult | null;
  /** true while the answer is still streaming. */
  streaming: boolean;
  client: SponsoredSlotClient;
};

export const AssistantTurn = (props: AssistantTurnProps): ReactElement => (
  <li>
    <AdgateMessageBoundary>
      <div data-adgate-message="assistant">
        <p>{props.answer}</p>
      </div>
    </AdgateMessageBoundary>

    {props.decision === null || props.streaming ? null : (
      <SponsoredSlot decision={props.decision} client={props.client} />
    )}
  </li>
);
`;

const pythonCode = (appId: string): string => `import asyncio
import os
from collections.abc import AsyncIterator, Callable
from typing import Any

from adgate import AsyncAdgate, Decision

adgate = AsyncAdgate(
    api_key=os.environ["${API_KEY_ENV}"],
    base_url=os.environ.get("${BASE_URL_ENV}", "http://localhost:8787"),
)


async def stream_turn(
    question: str,
    ids: dict[str, str],
    generate: Callable[[str], AsyncIterator[str]],
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """token* -> sponsored? -> done. The ad is never a token."""
    request: dict[str, Any] = {
        "app_id": "${appId}",
        "conversation_id": ids["conversation_id"],
        "turn_id": ids["turn_id"],
        "user": {"tier": ids["tier"], "region": "US"},
        "messages": [{"role": "user", "content": question}],
        "surface": {"type": "chat", "placement": "after_answer", "max_creatives": 1},
    }
    # Starts before the first token: the user waits only for the model.
    evaluation = asyncio.ensure_future(adgate.evaluate(request))

    parts: list[str] = []
    async for token in generate(question):
        parts.append(token)
        yield "token", {"text": token}
    answer = "".join(parts)

    decision = await evaluation  # never raises; any failure is a suppress decision
    creative = decision.creative
    served = decision.decision == Decision.serve and creative is not None
    if served and creative is not None:
        yield "sponsored", {"audit_id": decision.audit_id, **creative.model_dump(mode="json")}
    if decision.audit_id:
        await adgate.attest(decision.audit_id, answer, rendered=served)  # only the sha256
    yield "done", {"audit_id": decision.audit_id, "reason": decision.reason}
`;

/**
 * The three snippets for one app, in the order a web chat integration is written: wrap the
 * model on the server, render the block in the browser, or do both from Python.
 */
export const integrationSnippets = (appId: string): IntegrationSnippet[] => [
  {
    id: 'server',
    label: 'Server',
    filename: 'lib/chat.ts',
    copyLabel: 'Copy server snippet',
    summary:
      'Wrap your model once. The middleware evaluates as generation starts, so adgate costs the turn no latency, and attests the finished answer afterwards.',
    code: serverCode(appId),
  },
  {
    id: 'react',
    label: 'React',
    filename: 'components/assistant-turn.tsx',
    copyLabel: 'Copy React snippet',
    summary:
      'Render the answer inside the boundary and the slot outside it, after the answer. A SponsoredSlot nested inside model output renders nothing and warns.',
    code: REACT_CODE,
  },
  {
    id: 'python',
    label: 'Python',
    filename: 'app/chat.py',
    copyLabel: 'Copy Python snippet',
    summary:
      'No React, so the server sends the creative as its own event after the last token. The ad is never a token.',
    code: pythonCode(appId),
  },
];
