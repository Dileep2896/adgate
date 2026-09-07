# Integrating adgate

adgate decides whether a sponsored slot may follow a turn, hands you a creative when it may, and
writes a signed audit record either way. Your app renders the block itself, after the answer.

This guide covers the three shapes an integration takes: a **web chat UI**, an **agent framework
loop**, and a **coding agent CLI**. `examples/nextjs-chat` and `examples/fastapi-chat` are working
versions of the first. The contract is `docs/api.md`, the policy `docs/policy.md`, the record
`docs/audit.md`.

## Before you start

You need a gateway URL (`http://localhost:8787` locally), an app id (`app_01J...`) and an API key
(`ak_<prefix>_<secret>`); `pnpm --filter @adgateio/gateway create-app` prints all three. The key has
the `app` role — evaluate, attest, send events, read its own audit records — and is a server-side
secret: it must never reach a browser or a user's machine.

```bash
pnpm add @adgateio/sdk     # TypeScript, Node 20+ and browsers
pip install adgate       # Python 3.10+
```

Four policy defaults decide most of what you will see while integrating (`docs/policy.md`):

- `serve_to_tiers: [free]` — a `paid` user is suppressed with reason `paid_user`.
- `blocked_categories` — health, finance, politics, legal, adult, gambling, weapons, religion,
  self_harm. A turn in any of them is suppressed with `sensitive_category:<name>`.
- `frequency_caps.per_session: 1` — **one ad per conversation**. The next turn in the same
  conversation is suppressed with `frequency_cap`.
- `min_commercial_intent: 0.6`, `min_confidence: 0.7` — most turns are not commercial.

A first integration that suppresses nearly every turn is working correctly.

## Rules that apply to every shape

1. **An ad never renders inside model output** — not in the answer text, a code block, a tool
   result or a reasoning trace. It is a separate block your UI renders.
2. **It is always labeled**: `creative.disclosure_label` as visible text, never a tooltip or icon.
3. **It goes after the answer.** `surface.placement` is `after_answer` in v1 and the audit record
   records the disclosure that way. Render the block only once the answer is complete.
4. **Paid tiers are suppressed** unless the policy sets `allow_paid_tiers: true` and lists the tier
   in `serve_to_tiers`. Send the real `user.tier`; the gateway, not your app, decides.
5. **Fail closed.** `evaluate` never throws and never returns 5xx: on any error, timeout or low
   confidence it returns `decision: "suppress"`. Suppress is normal and means **render nothing** —
   no placeholder, no empty box, no reserved space.
6. **One evaluate per turn, one audit record per turn.** Evaluate once, carry the decision, then
   `attest` once with the final answer text. Only the sha256 of that text is sent.

## 1. Web chat UI

One evaluate per user message, started when generation starts, so adgate costs the turn no latency.
The decision travels to the browser beside the answer, never inside it.

### Server: wrap the model

`adgateMiddleware` calls `POST /v1/evaluate` as the generation starts and attests the finished
answer afterwards. It never touches the model's text: the decision arrives on
`providerMetadata.adgate`, and `onDecision` fires once as soon as the gateway answers.

```ts
import { createClient, type EvaluateResult } from '@adgateio/sdk';
import { adgateMiddleware } from '@adgateio/sdk/ai';
import { streamText, wrapLanguageModel } from 'ai';

// One client per process. createClient throws at boot if the key is missing.
const baseUrl = process.env.ADGATE_BASE_URL ?? 'http://localhost:8787';
const adgate = createClient({ apiKey: process.env.ADGATE_API_KEY ?? '', baseUrl });

/** Your provider's model object, e.g. `openai('gpt-4o-mini')` from `@ai-sdk/openai`. */
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
        appId: process.env.ADGATE_APP_ID ?? '',
        surface: 'chat',
        getUser: () => ({ tier: turn.tier, region: 'US', locale: 'en-US' }),
        conversationId: () => turn.conversationId,
        turnId: () => turn.turnId,
        onDecision,
      }),
    }),
    prompt: turn.prompt,
  });
```

`conversationId` is the chat id, `turnId` one id per user message and stable across retries.
Without a real `conversationId` every call looks like a new conversation and caps never bind.

### Browser: render the answer, then the block

The slot needs an object with a `track` method, not the whole client, so the API key stays on the
server and events go through a route of your own:

```ts
import type { EventType } from '@adgateio/sdk';
import type { SponsoredSlotClient } from '@adgateio/sdk/react';

/** POST /api/adgate/events forwards to the gateway's /v1/events with the server-side key. */
export const browserTrackClient: SponsoredSlotClient = {
  track: async (auditId: string, type: EventType) => {
    const body = JSON.stringify({ audit_id: auditId, type });
    const headers = { 'content-type': 'application/json' };
    const response = await fetch('/api/adgate/events', { method: 'POST', headers, body });
    return response.ok ? { ok: true, status: response.status } : { ok: false, error: 'http' };
  },
};
```

Then the turn. `AdgateMessageBoundary` marks the subtree that holds model output. A `SponsoredSlot` inside it
renders `null` and warns — during server rendering too, so a wrongly nested ad is never even
serialized into the HTML. Put the slot outside it, as a sibling that follows the answer.

```tsx
'use client';

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
```

The component does the rest: nothing at all is rendered for a suppress decision or a serve without
a creative; a serve renders the label as visible text, the headline, the body, a CTA anchor with
`rel="sponsored noopener noreferrer"` and a dismiss button, fires exactly one `impression` per
audit id when the block enters the viewport, and a `dismiss` event when the user closes it.

**Disclosure and separation for this shape.** The answer lives inside the boundary, the block
outside it and after it, gated on `streaming` so it appears only once the answer is complete. The
`attest` the middleware sends carries `sha256(answer)` and `rendered`, never the answer, and that
pair is what the record's `separation_attestation` rests on.

### The same shape in Python

No React, so the server sends the creative as its own event after the last token. Your SSE layer
writes each yielded pair as `event: <name>` plus a JSON `data:` line; this is
`examples/fastapi-chat` with the framework taken out.

```python
import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any

from adgate import AsyncAdgate, Decision

adgate = AsyncAdgate(api_key="ak_...", base_url="http://localhost:8787")


async def stream_turn(
    question: str,
    ids: dict[str, str],
    generate: Callable[[str], AsyncIterator[str]],
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """token* -> sponsored? -> done. The ad is never a token."""
    request: dict[str, Any] = {
        "app_id": "app_01J...",
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
```

The page renders the `sponsored` event into a container that is a sibling of, and below, the one
the tokens were written into, with `disclosure_label` as visible text.

## 2. Agent framework loop

A LangGraph or CrewAI style run is one user goal and many model calls. **Evaluate once, on the
user's goal, at the start of the task.** Not per node, not per tool call, not per model step.

- **Frequency caps count evaluations.** `per_session: 1` is one ad per conversation. An agent that
  evaluates every step burns the cap on step one and gets `frequency_cap` for the rest of the run.
- **One audit record per turn is the contract.** It holds the classification, the policy decisions,
  the creative and, after `attest`, the hash of the answer the user saw — which only means something
  if the turn is the whole task and the answer is the final report.
- **Intermediate output is not a surface.** Tool results and reasoning traces are model output.

Pass `conversation_id` = the agent session or thread id (stable for the whole session, which is
what `per_session` counts) and `turn_id` = the id of this task, one per user goal. Use
`surface.type: "agent"`.

```ts
import { createClient, type EvaluateResult } from '@adgateio/sdk';

const baseUrl = process.env.ADGATE_BASE_URL ?? 'http://localhost:8787';
const adgate = createClient({ apiKey: process.env.ADGATE_API_KEY ?? '', baseUrl });

export const runTask = async (
  goal: string,
  ids: { sessionId: string; taskId: string; tier: string },
  /** Your graph, crew or tool loop. adgate knows nothing about it. */
  runAgent: (goal: string) => Promise<{ report: string }>,
): Promise<{ report: string; decision: EvaluateResult }> => {
  // ONE evaluate, on the user's goal, before the agent starts.
  const decision = await adgate.evaluate({
    app_id: process.env.ADGATE_APP_ID ?? '',
    conversation_id: ids.sessionId,
    turn_id: ids.taskId,
    user: { tier: ids.tier, region: 'US' },
    messages: [{ role: 'user', content: goal }],
    surface: { type: 'agent', placement: 'after_answer', max_creatives: 1 },
  });

  // Carried through the run and handed to nothing inside it: no tool sees the creative, no prompt
  // mentions it, no intermediate message renders it.
  const { report } = await runAgent(goal);

  if (decision.audit_id !== null) {
    await adgate.attest(decision.audit_id, report, {
      rendered: decision.decision === 'serve' && decision.creative !== null,
    });
  }
  // The caller renders `report`, then the sponsored block as a separate labeled element below it.
  return { report, decision };
};
```

```python
from collections.abc import Callable
from typing import Any

from adgate import Adgate, Decision, EvaluateResult

adgate = Adgate(api_key="ak_...", base_url="http://localhost:8787")


def run_task(
    goal: str, ids: dict[str, str], run_agent: Callable[[str], str]
) -> tuple[str, EvaluateResult]:
    """One evaluate for the whole task, on the goal, before the agent starts."""
    request: dict[str, Any] = {
        "app_id": "app_01J...",
        "conversation_id": ids["session_id"],
        "turn_id": ids["task_id"],
        "user": {"tier": ids["tier"], "region": "US"},
        "messages": [{"role": "user", "content": goal}],
        "surface": {"type": "agent", "placement": "after_answer", "max_creatives": 1},
    }
    decision = adgate.evaluate(request)
    # The agent runs with no knowledge of the decision. Nothing in the loop may render it.
    report = run_agent(goal)
    served = decision.decision == Decision.serve and decision.creative is not None
    if decision.audit_id:
        adgate.attest(decision.audit_id, report, rendered=served)
    # The caller prints or renders `report`, then the sponsored block, separately and labeled.
    return report, decision
```

**Disclosure and separation for this shape.** The slot is rendered once, in the surface that shows
the final report, after the report text, as its own labeled block. Never inside a tool's output, an
intermediate assistant message, a reasoning trace, or a structured result the next node consumes.
`attest` is called with the final report text: that is what the record claims the user saw next to
the ad.

## 3. Coding agent CLI

A terminal has no separate block, so the separation is positional: the complete answer, a blank
line, then one labeled line (two if the URL needs its own). Never inside a code fence, never inside
a diff or a patch, never in a file the agent writes.

```text
…the last line of the answer.

Sponsored · Example DB Cloud — Managed Postgres with a free tier
http://localhost:8787/c/aud_01J...
```

`withGeneration` runs the evaluate and the command concurrently and attests the finished answer, so
the whole integration is one call plus one print.

```ts
import { createClient, withGeneration, type EvaluateResult } from '@adgateio/sdk';

const baseUrl = process.env.ADGATE_BASE_URL ?? 'http://localhost:8787';
const adgate = createClient({ apiKey: process.env.ADGATE_API_KEY ?? '', baseUrl });

/** The only thing adgate adds to the output, and only after everything else. */
const printSponsored = (decision: EvaluateResult): void => {
  const creative = decision.creative;
  if (decision.decision !== 'serve' || creative === null) {
    return; // a suppress decision prints nothing at all
  }
  const { disclosure_label, advertiser, headline, url } = creative;
  process.stdout.write(`\n${disclosure_label} · ${advertiser} — ${headline}\n${url}\n`);
  if (decision.audit_id !== null) {
    void adgate.track(decision.audit_id, 'impression');
  }
};

export const runCommand = async (
  goal: string,
  sessionId: string,
  run: (goal: string) => Promise<string>,
): Promise<void> => {
  const { answer, decision } = await withGeneration(
    adgate,
    {
      app_id: process.env.ADGATE_APP_ID ?? '',
      conversation_id: sessionId,
      turn_id: `turn_${Date.now()}`,
      user: { tier: 'free', region: 'US' },
      messages: [{ role: 'user', content: goal }],
      surface: { type: 'cli', placement: 'after_answer', max_creatives: 1 },
    },
    () => run(goal),
  );
  // The answer first, complete and untouched. attest already sent sha256(answer), never the text.
  process.stdout.write(`${answer}\n`);
  printSponsored(decision);
};
```

```python
import sys
import time
from collections.abc import Callable
from typing import Any

from adgate import Adgate, Decision, EvaluateResult

adgate = Adgate(api_key="ak_...", base_url="http://localhost:8787")


def print_sponsored(decision: EvaluateResult) -> None:
    """One labeled line after everything else, or nothing at all."""
    creative = decision.creative
    if decision.decision != Decision.serve or creative is None:
        return
    label, who = creative.disclosure_label, creative.advertiser
    sys.stdout.write("\n" + label + " · " + who + " - " + creative.headline + "\n")
    sys.stdout.write(creative.url + "\n")
    if decision.audit_id:
        adgate.track(decision.audit_id, "impression")


def run_command(goal: str, session_id: str, run: Callable[[str], str]) -> None:
    request: dict[str, Any] = {
        "app_id": "app_01J...",
        "conversation_id": session_id,
        "turn_id": "turn_" + str(int(time.time() * 1000)),
        "user": {"tier": "free", "region": "US"},
        "messages": [{"role": "user", "content": goal}],
        "surface": {"type": "cli", "placement": "after_answer", "max_creatives": 1},
    }
    # evaluate runs on a worker thread while `run` works; attest sends only sha256(answer).
    result = adgate.with_generation(request, lambda: run(goal))
    sys.stdout.write(result.answer + "\n")
    print_sponsored(result.decision)
```

**Disclosure and separation for this shape.** The line comes after the final answer and after any
code block, diff or file listing the agent printed. It carries `creative.disclosure_label` as plain
visible text. It is never written into a file the agent creates, never inside a fenced block, never
into a commit message. `attest` is still called with the final answer text (`withGeneration` and
`with_generation` do it for you): that is what proves the answer and the ad were produced
separately.

## Verifying what happened

Every evaluation gets an `audit_id`, **including suppressions** — a suppress decision is as
auditable as a served one, which is how you prove no ad ran beside a sensitive turn.

```bash
# the full record (docs/audit.md), then a re-run of every verification check
curl -H "Authorization: Bearer $ADGATE_API_KEY" http://localhost:8787/v1/audit/aud_01J...
curl -H "Authorization: Bearer $ADGATE_API_KEY" http://localhost:8787/v1/verify/aud_01J...
```

`GET /v1/verify/:id` answers with one entry per check, in the order `docs/audit.md` runs them:

```json
{
  "valid": true,
  "checks": [
    { "name": "schema", "ok": true },
    { "name": "record_hash", "ok": true },
    { "name": "chain", "ok": true },
    { "name": "signature", "ok": true, "detail": "key_id=k_2026_09" },
    { "name": "creative_hash", "ok": true },
    { "name": "disclosure_present", "ok": true },
    { "name": "separation_attested", "ok": true },
    { "name": "supersedes", "ok": true }
  ]
}
```

In the record, `decision` and `reason` say why nothing rendered (`paid_user`, `frequency_cap` and
`low_commercial_intent` are the common three) and `policy_decisions` lists every rule, pass or fail,
in policy order with the cap counters in `detail`. In the verify response, `disclosure_present:
false` means the block would have rendered unlabeled, and `separation_attested: false` means no
`attest` arrived — served turns with that flag false are rejected by every verification report.

## How these snippets are tested

Every fenced block here is checked on each run. `packages/sdk/src/docs-snippets.test.ts` writes
each `ts` and `tsx` block to its own file and type checks it against the SDK sources under the
repo's strict settings; `packages/sdk-python/tests/test_docs_snippets.py` compiles each `python`
block and resolves every `adgate` import against the installed package. Blocks are self-contained,
so the imports you see are the imports they need, and nothing is executed when they are checked.
