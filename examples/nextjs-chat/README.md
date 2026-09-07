# adgate example: Next.js chat

A minimal chat app (Next.js 15 App Router, React 19, Vercel AI SDK) wired to a local adgate
gateway. It shows the three things adgate exists to guarantee:

1. The sponsored block is chosen by the gateway, not the model, and in parallel with the answer.
2. It is rendered **after** the answer, in its own labelled container, **outside** the assistant
   message. It is never text the model produced.
3. Every turn — served or suppressed — leaves a signed audit record you can fetch and verify.

It runs offline. With no `OPENAI_API_KEY` set it uses a small canned model
(`lib/mock-model.ts`) that streams one of three answers picked by keyword, so the demo needs no
model provider at all. Set `OPENAI_API_KEY` to swap in a real one; nothing else changes.

## 5 minute setup

From the repo root:

```bash
# 1. Postgres and the schema
docker compose up -d postgres
pnpm install
pnpm db:migrate

# 2. An app and its API key. The key is printed ONCE (only an argon2id hash is stored).
pnpm --filter @adgateio/gateway create-app --name nextjs-demo

# 3. Some creatives in the global catalog (examples/creatives.seed.json)
pnpm --filter @adgateio/gateway seed-creatives
```

Step 2 prints an `app_id` and an `api_key`. Put them in this example's env file:

```bash
cp examples/nextjs-chat/.env.local.example examples/nextjs-chat/.env.local
# then edit ADGATE_APP_ID and ADGATE_API_KEY
```

The repo root also needs a `.env` with an Ed25519 signing key for the gateway
(`cp .env.example .env`, then `pnpm --filter @adgateio/gateway keygen` and paste the three lines
it prints). Then start both processes, in two terminals:

```bash
pnpm --filter @adgateio/gateway dev    # http://localhost:8787
pnpm --filter nextjs-chat dev        # http://localhost:3001
```

Open <http://localhost:3001> and ask:

> which postgres hosting should I use for a side project

The answer streams in, and a labelled **Sponsored** block appears underneath it, as a separate
card. Below the card is a note saying so.

To move the app off port 3001, set `PORT` in the shell, not in `.env.local`: the dev script
reads it before Next loads that file. `PORT=3005 pnpm --filter nextjs-chat dev`.

## Try the policy

The three buttons under an empty chat cover three different outcomes. With the default policy
and the gateway's rules-only classifier:

| Ask this | What happens | Why |
| --- | --- | --- |
| `which postgres hosting should I use for a side project` | Sponsored block appears | intent 0.98, categories `software.devtools.database` + `.hosting` |
| The same question with the toggle on **Paid tier** | No block, the UI prints `paid_user` | policy `serve_to_tiers` does not include `paid` |
| `how do I keep my side project deploys cheap` | No block, reason `low_commercial_intent` | intent 0.38, under the policy threshold |
| `I have had a headache for three days, what should I do` | No block, reason `sensitive_category:health` | health is a blocked sensitive category |
| `should I rewrite this in rust` | No block, reason `low_confidence` | the rules classifier is not sure what this turn is about |

The free/paid switch is in the header. It is sent with every message and becomes `user.tier` on
the evaluate request, so flipping it and re-asking the same question is the fastest way to watch
a policy rule change the outcome.

## Inspect the audit record

Every turn returns an `audit_id`, and the UI prints it whenever a turn is suppressed. Read the
record with the same API key (`app`-role keys may read their own app's records):

```bash
KEY=ak_...                    # the key from create-app
AUD=aud_...                   # the audit id shown in the UI

curl -s -H "Authorization: Bearer $KEY" http://localhost:8787/v1/audit/$AUD | jq
curl -s -H "Authorization: Bearer $KEY" http://localhost:8787/v1/verify/$AUD | jq
```

For a paid-tier turn the record reads:

```json
{
  "decision": "suppress",
  "reason": "paid_user",
  "policy_decisions": [
    { "rule": "serve_to_tiers", "result": "fail", "detail": "tier=paid not in serve_to_tiers" },
    { "rule": "regions", "result": "pass" }
  ],
  "creative": null
}
```

`/v1/verify/:id` re-checks the record hash, the hash chain, the Ed25519 signature, the creative
hash, that a disclosure label was present, and that separation was attested.

## How it is wired

| File | What it does |
| --- | --- |
| `app/api/chat/route.ts` | `wrapLanguageModel({ model, middleware: adgateMiddleware(client, ...) })`, then streams the answer and writes the decision as a separate `data-adgate` part |
| `app/api/events/route.ts` | Relays impression/dismiss events so the API key never reaches the browser |
| `components/assistant-turn.tsx` | `<AdgateMessageBoundary>` around the answer, `<SponsoredSlot>` outside it |
| `components/chat.tsx` | `useChat`, the input, and the free/paid toggle |
| `lib/adgate.ts` | The server-side `createClient` (lazy, so `next build` needs no key) |
| `lib/model.ts` / `lib/mock-model.ts` | Real provider when `OPENAI_API_KEY` is set, offline canned model otherwise |

### The decision never travels inside the model's text

`adgateMiddleware` attaches the decision to the model call's `providerMetadata` and reports it
through `onDecision`. The route forwards it to the browser as its own AI SDK **data part**:

```ts
if (value.type === 'finish') {
  writer.write({ type: 'data-adgate', id: turnId, data: await withDecisionTimeout(decision) });
}
writer.write(value);
```

So the wire looks like `text-delta ... text-delta, text-end, data-adgate, finish`: the ad
decision arrives after the complete answer, in a channel of its own. The UI reads it with
`decisionOf(message)` and hands it to `<SponsoredSlot>`.

### Separation is enforced twice

```tsx
<AdgateMessageBoundary>
  <div data-adgate-message="assistant">{text}</div>
</AdgateMessageBoundary>

<SponsoredSlot decision={decision} client={client} />
```

A `<SponsoredSlot>` rendered inside that boundary — or inside any element carrying
`data-adgate-message="assistant"` — renders nothing at all and warns, on the server as well as
in the browser. `components/assistant-turn.test.tsx` asserts against the real DOM that the slot
is outside the assistant container and follows it.

## Model configuration

| Variable | Effect |
| --- | --- |
| unset | Offline mock model: canned answers, streamed word by word. No network. |
| `OPENAI_API_KEY` | Uses `@ai-sdk/openai` |
| `OPENAI_BASE_URL` | Any OpenAI-compatible endpoint (Ollama, vLLM, OpenRouter, Azure ...) |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini` |

The gateway has its own, separate classifier configuration (`CLASSIFIER_*` in the repo-root
`.env`). Left empty it classifies with rules only, which is what the table above is based on.

## Scripts

```bash
pnpm --filter nextjs-chat dev        # next dev on :3001
pnpm --filter nextjs-chat build      # next build
pnpm --filter nextjs-chat test       # vitest (component + mock model)
pnpm --filter nextjs-chat typecheck  # tsc --noEmit
pnpm --filter nextjs-chat lint       # eslint
```

## License

Part of adgate, and covered by the repository licence:
[FSL-1.1-Apache-2.0](../../LICENSE.md). Copy this example into your own app freely — using adgate
inside your own product is a permitted purpose, and each version becomes Apache 2.0 two years
after its release.
