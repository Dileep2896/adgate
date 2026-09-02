# Building the AdGate SDK with Claude Code

A complete build guide for the neutral policy, verification, and mediation gateway for ads in AI apps. Working name is **adgate** (rename freely; search and replace `adgate` and `@adgate` later).

This document has three parts:

1. Setup and architecture decisions (read once, do not skip)
2. The CLAUDE.md file to drop in the repo
3. Ten copy-paste phase prompts for Claude Code, each with acceptance criteria

Budget: roughly 8 weeks part time, or 3 to 4 weeks full time. Each phase is designed to fit in one or two Claude Code sessions.

---

## Part 1: Setup and decisions

### 1.1 Install and start Claude Code

```bash
# Native install (recommended)
curl -fsSL https://claude.ai/install.sh | bash
# macOS alternative
brew install --cask claude-code

claude auth login
mkdir adgate && cd adgate && git init
claude
```

If anything here differs from what you see, the docs are the source of truth: https://docs.claude.com/en/docs/claude-code/overview

### 1.2 How to work through this guide with Claude Code

Follow this loop for every phase. It matters more than any individual prompt.

1. Start a fresh session per phase (`claude` in the repo root). CLAUDE.md is loaded automatically at session start and re-read after `/compact`.
2. Switch to plan mode before pasting a phase prompt (`/plan`, or Shift+Tab). Read the plan. Push back if it invents scope. Approve.
3. Insist on tests first. Every phase prompt already says so; if Claude Code skips tests, say "write the failing tests before the implementation".
4. When the phase is done: run `pnpm test` and `pnpm typecheck` yourself, read the diff, then commit. Do not let phases pile up uncommitted.
5. Before the next phase, run `/context` to see how full the window is and `/compact` if it is over roughly 60 percent.
6. Use `/btw` for side questions so they do not pollute the working context.
7. For review, ask for a subagent: "Spawn a reviewer subagent that reads packages/core/src/policy and lists edge cases the tests miss." Subagents get their own context window.

Two rules that will save you days: never let Claude Code add infrastructure that is not in the decisions list below, and never let it "improve" the API contract in section 1.5 without you changing this document first.

### 1.3 Stack decisions (fixed for the MVP)

| Concern | Decision | Why |
|---|---|---|
| Language | TypeScript everywhere, Node 20+ | One language for gateway, SDK, dashboard; Python SDK is a thin client |
| Monorepo | pnpm workspaces + Turborepo | Cheap, standard, Claude Code handles it well |
| HTTP framework | Hono | Tiny, fast, runs on Node and edge, easy to test |
| Database | Postgres via Drizzle ORM | One database. No Redis, no queues in the MVP |
| Validation | Zod, schemas shared across packages | Single source of truth for the API contract |
| Testing | Vitest, supertest for HTTP | Fast, TS native |
| Signing | Ed25519 via Node `crypto` | Built in, no native deps |
| Classifier | Rules first, then a small fast LLM with JSON output, cached by hash | Cheap and fast; rules catch the obvious, LLM handles the rest |
| Dashboard | Next.js (App Router) + Tailwind | Later phase, do not start early |
| Python SDK | httpx + pydantic, published to PyPI | Thin client over the HTTP API |
| License | Apache 2.0 | Open source distribution is the go to market |

Explicit non-goals for the MVP: no multi-region, no real-time bidding protocol, no auctions across more than three demand sources, no user-level profiles, no mobile SDKs, no billing system. Write these into CLAUDE.md so Claude Code does not drift.

### 1.4 Architecture

```
  AI app (chat UI, agent, coding tool)
        |
        |  @adgate/sdk (TS) or adgate (Python)
        |  evaluate(turn, user, policy) -> decision
        v
  +------------------------------------------------------------+
  |  adgate gateway (Hono service, self-hostable)               |
  |                                                            |
  |  1. Classify turn   rules -> LLM (cached) -> intent, cats   |
  |  2. Policy engine   YAML policy as code -> allow/suppress   |
  |  3. Mediation       direct | affiliate | network adapters   |
  |  4. Disclosure      label + placement + separation flag     |
  |  5. Audit           hash chain + Ed25519 signature          |
  +------------------------------------------------------------+
        |                        |
        v                        v
   Postgres (apps, policies,  Demand sources
   creatives, audit, events)  (direct catalog, affiliate
                              link builders, Koah/Gravity
                              adapters behind an interface)
        |
        v
   Dashboard + verification reports (Next.js)
```

Request flow inside the app: the SDK calls `evaluate` with the user message **in parallel** with the model call, so classification and demand happen while the answer streams. The sponsored slot renders only after the answer completes, in a separate block, never inside the model output. If anything fails or times out, the decision is `suppress`. Fail closed, always.

### 1.5 The API contract (Claude Code must not change this without you)

**POST /v1/evaluate**

```json
{
  "app_id": "app_01J...",
  "conversation_id": "conv_abc",
  "turn_id": "turn_7",
  "user": { "tier": "free", "region": "US", "locale": "en-US" },
  "messages": [
    { "role": "user", "content": "which postgres hosting should I use for a side project" }
  ],
  "surface": { "type": "chat", "placement": "after_answer", "max_creatives": 1 },
  "policy_overrides": {}
}
```

`messages` holds the last few turns. Apps may send `context_summary` instead of raw text if they do not want to send content off box.

Response:

```json
{
  "decision": "serve",
  "reason": null,
  "classification": {
    "commercial_intent": 0.84,
    "categories": ["software.devtools.database"],
    "sensitive": [],
    "confidence": 0.91,
    "method": "llm"
  },
  "creative": {
    "id": "cr_01J...",
    "advertiser": "Example DB Cloud",
    "headline": "Managed Postgres with a free tier",
    "body": "Spin up a database in 30 seconds.",
    "cta": "Try it free",
    "url": "https://track.adgate.dev/c/aud_01J...",
    "source": "direct",
    "disclosure_label": "Sponsored"
  },
  "audit_id": "aud_01J...",
  "latency_ms": 142
}
```

When suppressed, `decision` is `"suppress"`, `creative` is null, and `reason` is one of: `paid_user`, `sensitive_category:<name>`, `low_commercial_intent`, `low_confidence`, `frequency_cap`, `region_blocked`, `no_fill`, `error`.

**POST /v1/events**

```json
{ "audit_id": "aud_01J...", "type": "impression", "ts": "2026-09-02T18:04:11Z" }
```

`type` is one of `impression`, `click`, `dismiss`, `conversion`. Clicks also flow through the tracking redirect at `/c/:audit_id`.

**GET /v1/audit/:id** returns the full audit record. **GET /v1/verify/:id** re-verifies the hash chain and signature and returns `{ valid: true|false, checks: [...] }`. Both require the app's API key or an advertiser read token.

### 1.6 Policy as code (YAML)

```yaml
version: 1
app_id: my-chat-app
serve_to_tiers: [free]                 # never anything else by default
blocked_categories:
  - health
  - finance
  - politics
  - legal
  - adult
  - gambling
  - weapons
  - religion
sensitive_detection: strict            # strict | balanced
min_commercial_intent: 0.6
min_confidence: 0.7
competitor_exclusions:
  - competitor.com
frequency_caps:
  per_session: 1
  per_user_per_day: 3
  min_turns_between: 4
disclosure:
  label: "Sponsored"
  position: after_answer
  style: separate_block
demand:
  - source: direct
  - source: affiliate
    network: partnerstack
  - source: koah
    enabled: false
privacy:
  store_raw_text: false
  retain_days: 90
regions:
  allow: [US, CA, GB, EU]
```

Rules are evaluated in this order and the first failure wins: tier, region, sensitive categories, confidence, commercial intent, frequency caps, competitor exclusions. Every rule evaluation is recorded in the audit record whether it passed or failed.

### 1.7 Audit record schema

```json
{
  "id": "aud_01J...",
  "app_id": "app_01J...",
  "conversation_id_hash": "sha256:...",
  "turn_id": "turn_7",
  "ts": "2026-09-02T18:04:11Z",
  "classification": { "commercial_intent": 0.84, "categories": ["software.devtools.database"], "sensitive": [], "confidence": 0.91, "method": "llm" },
  "policy_version": 1,
  "policy_hash": "sha256:...",
  "policy_decisions": [
    { "rule": "serve_to_tiers", "result": "pass" },
    { "rule": "blocked_categories", "result": "pass" },
    { "rule": "frequency_caps", "result": "pass", "detail": "session=0/1" }
  ],
  "demand": {
    "requested": ["direct", "affiliate"],
    "responses": [{ "source": "direct", "candidates": 2, "latency_ms": 38 }, { "source": "affiliate", "candidates": 0, "latency_ms": 61 }],
    "selected": "direct"
  },
  "creative": { "id": "cr_01J...", "advertiser": "Example DB Cloud", "content_hash": "sha256:..." },
  "disclosure": { "label": "Sponsored", "position": "after_answer", "style": "separate_block" },
  "model_output_hash": "sha256:...",
  "separation_attestation": true,
  "prev_hash": "sha256:...",
  "record_hash": "sha256:...",
  "signature": "ed25519:...",
  "key_id": "k_2026_09"
}
```

`model_output_hash` is reported by the SDK after the answer streams (a second call, `attest`), so the record proves the ad was decided independently of, and shown separately from, the model output. This is the artifact advertisers pay for.

### 1.8 Disclosure rules baked into the SDK

- Label text defaults to "Sponsored" and is always rendered, never hidden behind hover or a tooltip.
- The slot is a visually separate block after the answer. The SDK refuses to render inline inside the assistant message.
- The label appears at first exposure (this is what the EU AI Act Article 50 guidance and FTC clear-and-conspicuous standard both expect; do your own legal review before launch).
- The React component ships with an accessible `aria-label="Sponsored content"` and a dismiss button that fires a `dismiss` event.
- Paid tiers never see ads by default and the policy cannot enable it without an explicit `allow_paid_tiers: true` flag plus a warning in logs.

### 1.9 Latency and safety budget

- `evaluate` p95 under 300 ms with a warm classifier cache; under 700 ms cold.
- Classifier LLM call timeout 400 ms, then fall back to rules only; if rules cannot reach `min_confidence`, suppress.
- Demand adapters run in parallel with a 250 ms timeout each.
- Any exception anywhere returns `suppress` with `reason: "error"` and logs. The app must never break because of adgate.

### 1.10 Repo layout

```
adgate/
  CLAUDE.md
  package.json            # pnpm workspaces, turbo
  turbo.json
  packages/
    schemas/              # Zod schemas + generated JSON schema + TS types (shared)
    core/                 # classifier, policy engine, mediation, audit (pure logic, no HTTP)
    gateway/              # Hono service, Drizzle, migrations, API keys, tracking redirect
    sdk/                  # @adgate/sdk (TS client) + React components
    sdk-python/           # adgate (Python client)
    dashboard/            # Next.js app (Phase 8)
  examples/
    nextjs-chat/          # Vercel AI SDK app with adgate wired in
    fastapi-chat/         # Python example
  docs/
    api.md  policy.md  audit.md  integration.md
```

---

## Part 2: CLAUDE.md (paste into the repo root)

Keep it under 200 lines. Everything below is deliberately terse; Claude Code follows short, specific instructions better than long ones.

```markdown
# adgate

Neutral policy, verification, and mediation gateway for ads inside AI chat and agents.
Open source (Apache 2.0). We are NOT an ad network. We decide whether an ad is allowed
in a conversation turn, fetch a candidate from demand sources, render a separate labeled
slot, and write a signed audit record proving what happened.

## Non-negotiables
- Fail closed: any error, timeout, or low confidence returns decision=suppress. Never throw to the caller.
- Ads never render inside model output. Separate block, after the answer, always labeled.
- Paid tiers never get ads unless policy sets allow_paid_tiers: true.
- The API contract in docs/api.md and schemas in packages/schemas are the source of truth. Do not change them without asking.
- No new infrastructure. Postgres only. No Redis, queues, or microservices.
- Do not store raw conversation text unless policy.privacy.store_raw_text is true. Store hashes and categories.

## Stack
pnpm workspaces + Turborepo, TypeScript strict, Node 20, Hono, Drizzle + Postgres, Zod, Vitest,
Ed25519 via node:crypto. Python SDK: httpx + pydantic. Dashboard: Next.js App Router + Tailwind.

## Commands
- pnpm install
- pnpm dev          (gateway on :8787, dashboard on :3000)
- pnpm test         (vitest, all packages)
- pnpm typecheck
- pnpm lint
- pnpm db:migrate   (drizzle-kit)
- docker compose up -d postgres

## Conventions
- Tests first. Write failing tests in packages/*/src/**/*.test.ts, then implement.
- Pure logic lives in packages/core. packages/gateway only wires HTTP, DB, and config.
- Every module exports one clear interface. Demand sources implement DemandAdapter.
- Zod schema first, derive TS types with z.infer. Never hand-write duplicate types.
- IDs are ULIDs with prefixes: app_, cr_, aud_, ev_, key_.
- Timestamps are ISO 8601 UTC strings in JSON, timestamptz in Postgres.
- Log with pino, structured, never log message content.
- No default exports. Named exports only.
- Keep files under 300 lines. Split by responsibility, not by layer.

## Reading order for a new session
1. docs/api.md  2. docs/policy.md  3. docs/audit.md  4. packages/schemas/src/index.ts

## When unsure
Ask before adding a dependency, changing a schema, or adding a table.
```

Optional enforcement with a hook (put in `.claude/settings.json`, check the hooks docs at https://docs.claude.com/en/docs/claude-code/hooks for the exact current format):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "pnpm -s typecheck 2>&1 | tail -20" }]
      }
    ]
  }
}
```

Hooks are enforced; CLAUDE.md is context. If a rule must never be broken (for example, no edits to `packages/schemas` without approval), put it in a PreToolUse hook rather than relying on the markdown.

---

## Part 3: Phase prompts

Each phase: paste the prompt in plan mode, approve the plan, let it run, verify against the acceptance criteria, commit. The prompts reference this document as `docs/BUILD_GUIDE.md`, so copy this file into `docs/` in Phase 0.

### Phase 0: Scaffold

Prompt:

```
Read docs/BUILD_GUIDE.md sections 1.3 through 1.10 and CLAUDE.md. Scaffold the monorepo exactly as laid out in 1.10.

Requirements:
- pnpm workspaces with Turborepo. Root scripts: dev, test, typecheck, lint, db:migrate.
- TypeScript strict mode, shared tsconfig.base.json, ESM everywhere.
- Vitest configured at root with per-package projects.
- ESLint + Prettier with a minimal config.
- docker-compose.yml with Postgres 16 and a .env.example.
- packages/schemas, packages/core, packages/gateway, packages/sdk with placeholder index.ts files and one passing smoke test each.
- Copy the API contract (1.5), policy YAML (1.6), and audit schema (1.7) from the build guide into docs/api.md, docs/policy.md, docs/audit.md verbatim.
- GitHub Actions workflow that runs install, typecheck, lint, test on push.
- Apache 2.0 LICENSE and a short README describing what adgate is and is not.

Do not implement any business logic yet. When done, run pnpm install, pnpm typecheck, pnpm test and show me the output.
```

Acceptance: `pnpm test` green, `pnpm typecheck` green, CI file exists, docs copied. Commit as `chore: scaffold monorepo`.

### Phase 1: Schemas and the policy engine

Prompt:

```
Read docs/api.md, docs/policy.md, docs/audit.md. Implement packages/schemas and the policy engine in packages/core.

packages/schemas:
- Zod schemas for EvaluateRequest, EvaluateResponse, Classification, Creative, PolicyConfig, AuditRecord, Event. Derive all TS types with z.infer. Export a function that emits JSON Schema for each (for the Python SDK later).
- PolicyConfig must apply the defaults from docs/policy.md when fields are omitted, and must reject allow_paid_tiers without an explicit boolean.
- A loadPolicyFromYaml(string) function that parses, validates, and returns a PolicyConfig plus its sha256 policy_hash over the canonical JSON.

packages/core/src/policy:
- evaluatePolicy(input: { classification, user, policy, capState, surface }) returns { allowed: boolean, reason: SuppressReason | null, decisions: PolicyDecision[] }.
- Rules run in this exact order, first failure wins, but every rule still records a decision entry: serve_to_tiers, regions, blocked_categories (against classification.sensitive AND classification.categories), min_confidence, min_commercial_intent, frequency_caps, competitor_exclusions (applied later at creative selection, but record here that it is pending).
- capState is a plain object { session_count, day_count, turns_since_last } supplied by the caller; the engine is pure and has no DB access.

Tests first. Cover: paid user suppressed; health query suppressed even with high intent; low confidence suppressed; caps at boundary values; YAML with unknown keys rejected; defaults applied; policy_hash stable across key ordering.
```

Acceptance: 100 percent of listed cases tested, policy engine has zero imports from gateway or any I/O library. Commit as `feat: schemas and policy engine`.

### Phase 2: The classifier

Prompt:

```
Implement packages/core/src/classify. Goal: given the last few messages, return a Classification (commercial_intent 0..1, categories[], sensitive[], confidence 0..1, method: "rules" | "llm" | "cached").

Design:
1. Rules stage: keyword and regex lists per sensitive category (health, finance, politics, legal, adult, gambling, weapons, religion, self_harm) and per commercial category family (software.devtools.*, shopping.*, travel.*, education.*, productivity.*). Rules produce a preliminary classification with confidence. If any sensitive category matches with high confidence, return immediately with commercial_intent 0 and method "rules". Self_harm is always sensitive and always suppresses.
2. LLM stage: an interface LlmClassifier with one implementation that calls a configurable OpenAI-compatible chat completions endpoint with a strict JSON schema response and a 400 ms timeout. Prompt lives in a single file, versioned with a hash that is included in the classification for auditability. The model name and endpoint come from env. Provide a fake implementation for tests.
3. Cache: in-memory LRU keyed by sha256 of normalized message text + prompt version, 10 minute TTL, max 50k entries. Gateway will add a Postgres-backed cache later; keep the interface swappable.
4. Merge: LLM result wins on categories and intent; sensitive flags are the union of rules and LLM; confidence is the LLM confidence unless rules fired, then min of both.
5. Timeouts or errors fall back to rules only. If the resulting confidence is below the policy min_confidence the engine will suppress; the classifier itself never throws.

Tests first, with a fake LLM. Include a fixture file of at least 60 example messages across categories with expected outputs, and a test that asserts precision on sensitive detection is 100 percent on the fixture set (false negatives on sensitive categories are the failure we care about most).
```

Acceptance: fixture test passes, timeout path tested, no network in tests. Commit as `feat: two stage classifier`.

### Phase 3: Demand adapters and mediation

Prompt:

```
Implement packages/core/src/demand.

Interface:
  interface DemandAdapter {
    source: "direct" | "affiliate" | "koah" | "gravity";
    fetch(req: DemandRequest, opts: { timeoutMs: number }): Promise<DemandResponse>;
  }
  DemandRequest = { classification, surface, user: { region, locale }, exclusions: string[] , app_id }
  DemandResponse = { candidates: Candidate[], latency_ms: number, error?: string }
  Candidate = Creative + { ecpm_estimate: number, targeting_match: number }

Adapters for the MVP:
1. DirectAdapter: reads a catalog of creatives (supplied by the caller as an in-memory array in core; the gateway will load them from Postgres). Each creative has target categories, target regions, optional keyword list, advertiser domain, ecpm. Match by category overlap and keyword overlap; return top 3 with scores.
2. AffiliateAdapter: template based link builder for PartnerStack and Impact style deep links plus Amazon Associates tag links. Catalog entries carry a url_template and a program id. No network calls; it just builds tracked URLs. Document clearly in code that the app owner brings their own affiliate accounts.
3. KoahAdapter and GravityAdapter: stubs that implement the interface, read config from env, and throw NotConfigured unless enabled. Leave a TODO with the expected request shape. We will fill these in once we have partner API access.

Mediation:
- mediate(adapters, req, policy) runs enabled adapters in parallel with Promise.allSettled and per-adapter timeout, drops candidates whose advertiser domain matches competitor_exclusions, ranks by ecpm_estimate * targeting_match, returns { selected: Candidate | null, trace: per-adapter { requested, candidates, latency_ms, error } }.
- If no candidates, selected is null and the reason will be no_fill.

Tests first: parallel timing (a slow adapter must not delay the fast one beyond the timeout), exclusion filtering, ranking ties, all adapters failing returns no_fill without throwing.
```

Acceptance: mediation never throws, timing test uses fake timers, trace object matches the `demand` block of the audit schema. Commit as `feat: demand adapters and mediation`.

### Phase 4: Audit log and signing

Prompt:

```
Implement packages/core/src/audit.

- buildAuditRecord(input) assembles an AuditRecord from the classification, policy result, mediation trace, chosen creative, disclosure config, and app metadata. conversation_id is stored only as sha256 with a per-app salt.
- Hash chain: record_hash = sha256(canonical JSON of the record without record_hash and signature, plus prev_hash). prev_hash is the previous record_hash for the same app (the caller supplies it; core stays pure).
- Signing: Ed25519 with node:crypto. Keys are loaded from env as PEM. key_id is included in the record. Provide generateKeypair() for local dev and document rotation: new key_id, old public keys stay available for verification.
- attest(record, model_output_hash) returns a new version of the record with model_output_hash and separation_attestation set, re-hashed and re-signed, and keeps a link to the prior record_hash so the pre-attestation record remains verifiable.
- verify(record, publicKeys, prevRecord?) returns { valid, checks: [{ name, ok, detail }] } covering: schema valid, hash matches, chain matches prev, signature valid for key_id, creative content_hash matches, disclosure present, separation attested.
- Canonical JSON must be deterministic: sorted keys, no whitespace, UTF-8, numbers as shortest round-trip strings.

Tests first: tamper with any field and verify() must fail with the right check name; chain break detected; rotation scenario with two keys; canonicalization stable across key insertion order.
```

Acceptance: every tamper case caught, canonical JSON test passes, no I/O in core. Commit as `feat: signed audit records`.

### Phase 5: The gateway service

Prompt:

```
Implement packages/gateway as a Hono service wiring packages/core to Postgres and HTTP. Follow docs/api.md exactly.

Database (Drizzle, migrations in packages/gateway/drizzle):
- apps (id, name, created_at, salt, default_policy_yaml, policy_hash, policy_version)
- api_keys (id, app_id, hashed_key, role: "app" | "advertiser_read", created_at, revoked_at)
- advertisers (id, name, domain)
- creatives (id, advertiser_id, headline, body, cta, url_template, target_categories text[], target_regions text[], keywords text[], ecpm numeric, source, active)
- audit_records (id, app_id, record jsonb, record_hash, prev_hash, ts) with an index on (app_id, ts)
- events (id, audit_id, type, ts, meta jsonb)
- cap_state (app_id, conversation_hash, user_hash nullable, session_count, day_count, last_turn_index, day) with a primary key on (app_id, conversation_hash)
- classify_cache (hash primary key, classification jsonb, expires_at)

Endpoints:
- POST /v1/evaluate: auth by API key -> load policy (with policy_overrides validated and merged) -> read cap_state -> classify (Postgres cache in front of the in-memory LRU) -> evaluatePolicy -> if allowed, mediate with DirectAdapter (creatives from DB) and AffiliateAdapter -> build and sign audit record -> persist -> update cap_state -> respond. Wrap the whole thing so any error returns { decision: "suppress", reason: "error", audit_id } with a 200 status and a logged error. Never 500 on evaluate.
- POST /v1/attest: { audit_id, model_output_hash } -> attest and persist new version.
- POST /v1/events: validate, persist, 204.
- GET /c/:audit_id: log a click event and 302 to the creative url. Reject if audit record missing.
- GET /v1/audit/:id and GET /v1/verify/:id.
- GET /healthz.
- Rate limit evaluate per API key (token bucket in Postgres is fine for the MVP; keep it behind an interface).

Config via env with a Zod-validated config module. pino logging with request ids. OpenAPI JSON generated from the Zod schemas and served at /openapi.json.

Tests: supertest integration tests against a real Postgres from docker compose (use a test database, truncate between tests). Cover: happy path serve; suppress paths; attest round trip; verify endpoint catches a tampered record inserted directly via SQL; click redirect logs an event; rate limit trips; evaluate returns suppress on a simulated DB outage.
```

Acceptance: integration tests green against Postgres, `pnpm dev` starts on :8787, `/openapi.json` validates. Commit as `feat: gateway service`.

Then run a latency check yourself:

```bash
# after seeding a few creatives via a small script Claude Code writes in packages/gateway/scripts/seed.ts
npx autocannon -c 20 -d 15 -m POST -H "authorization: Bearer $KEY" -H "content-type: application/json" -b @examples/evaluate.json http://localhost:8787/v1/evaluate
```

If p95 is above 300 ms with a warm cache, ask Claude Code to profile before optimizing: "Add timing spans around classify, policy, mediate, audit, and DB writes; print them in debug logs; then tell me where the time goes." Do not accept guesses.

### Phase 6: TypeScript SDK and React components

Prompt:

```
Implement packages/sdk as @adgate/sdk. Two entry points: "@adgate/sdk" (framework agnostic, works in Node and browsers) and "@adgate/sdk/react".

Core client:
  const adgate = createClient({ apiKey, baseUrl, timeoutMs: 800 })
  adgate.evaluate(req): Promise<EvaluateResponse>   // never rejects; on error resolves to a suppress decision with reason "error"
  adgate.attest(auditId, modelOutputText): Promise<void>   // hashes locally, sends only the hash
  adgate.track(auditId, type): Promise<void>
  adgate.withGeneration(req, generate: () => Promise<string>): runs evaluate in parallel with the caller's model call, awaits both, attests, and returns { answer, decision }.

Streaming helper: adgate.forStream(req) returns { decisionPromise, onChunk(chunk), finish() } so apps that stream can accumulate the answer hash and call attest at the end.

React:
  <SponsoredSlot decision={decision} onDismiss={...} /> renders nothing when decision is suppress. When serving, renders a separate block with the label from decision.creative.disclosure_label, the headline, body, CTA link to creative.url with rel="sponsored noopener", an aria-label "Sponsored content", and a dismiss button that calls track(auditId, "dismiss"). Fires track(auditId, "impression") once when it enters the viewport (IntersectionObserver, guarded for SSR).
  The component must refuse to be rendered inside an element with data-adgate-message="assistant" and log a console warning if attempted. This enforces separation from model output at the UI layer.

Vercel AI SDK helper in "@adgate/sdk/ai": wrapLanguageModel middleware that runs evaluate on the latest user message in parallel with generation, attaches the decision to the response metadata, and attests with the final text.

Build with tsup to ESM and CJS with types. Tests with vitest and @testing-library/react. Tests must cover the never-rejects guarantee, the streaming attest flow, and the separation guard.
```

Acceptance: `pnpm --filter @adgate/sdk build` produces both formats, React tests pass, bundle under 15 kB gzipped for the core entry. Commit as `feat: typescript sdk`.

### Phase 7: Python SDK and example apps

Prompt:

```
1. Implement packages/sdk-python as the "adgate" package (pyproject with hatchling, Python 3.10+). Use httpx (sync and async clients) and pydantic v2 models generated from the JSON Schemas exported by packages/schemas (write a small script that regenerates them; check the generated models into the repo). Mirror the TS API: evaluate, attest, track, and an async with_generation helper. Never raise from evaluate; return a suppress decision on error. Tests with pytest and respx.

2. examples/nextjs-chat: a minimal Next.js chat app using the Vercel AI SDK and an OpenAI-compatible endpoint, wired with @adgate/sdk/ai and <SponsoredSlot/>. Free/paid toggle in the UI to demonstrate paid suppression. A README with a 5 minute setup.

3. examples/fastapi-chat: the same in Python with FastAPI, server-sent events, and the Python SDK; the sponsored slot is returned as a separate SSE event type "sponsored" so the frontend renders it after the answer.

4. docs/integration.md: a guide for three integration shapes: (a) web chat UI, (b) agent framework (LangGraph or CrewAI style tool loop: call evaluate on the user goal at task start, render the slot in the final report only), (c) coding agent CLI (print a single labeled line after the final answer, never inside code blocks). Include copy-paste snippets for each.
```

Acceptance: both examples run locally against the gateway, Python tests pass, integration guide reviewed by you for tone (no marketing language, just instructions). Commit as `feat: python sdk and examples`.

### Phase 8: Dashboard and verification report

Prompt:

```
Implement packages/dashboard as a Next.js App Router app with Tailwind, reading from the same Postgres via Drizzle (read only queries in a separate module). No auth beyond a single admin password in env for the MVP.

Pages:
- /apps: list apps, create app (generates API key shown once), edit policy YAML with validation errors shown inline.
- /apps/[id]: last 30 days of: turns evaluated, ad-eligible rate, fill rate, impressions, clicks, CTR, estimated revenue, RPM per 1000 eligible turns, suppress reasons breakdown. Simple charts with recharts.
- /creatives: CRUD for direct creatives and affiliate entries.
- /audit: search audit records by app, date, decision, reason; detail view runs verify() live and shows each check.
- /reports/new: pick an advertiser and date range, generate a Verification Report: impressions and clicks by app, category distribution of the turns their creative appeared on, sensitive category exposures (should be zero), disclosure compliance (label present, position after_answer, separation attested) as percentages, hash chain integrity result, and a downloadable JSON bundle of the underlying audit records plus a printable HTML view.

Instrument the YC metrics explicitly on the /apps overview: apps integrated, total turns processed, ad-eligible rate, RPM, number of advertisers with at least one generated report.

Tests: component tests for the report calculations with fixture data; a Playwright smoke test that creates an app, pastes a policy, and views the overview.
```

Acceptance: report numbers match a hand calculated fixture, verification detail page shows a tampered record as invalid. Commit as `feat: dashboard and verification report`.

### Phase 9: Hardening, docs, release

Prompt:

```
1. Security pass: API keys hashed with argon2, constant time compare, CORS restricted, request body size limits, input length caps on messages (truncate to the last 4 messages and 4k chars before classification), SQL parameterization audit, dependency audit. Add a SECURITY.md.
2. Privacy pass: confirm no raw message text is persisted unless store_raw_text is true; add a retention job (a simple script run by cron) that deletes audit records older than policy.privacy.retain_days; document what is stored in docs/privacy.md.
3. Observability: /metrics endpoint in Prometheus format with counters for decisions by reason, histograms for evaluate latency and per-adapter latency.
4. Load test script in packages/gateway/scripts/load.ts and record p50/p95 in docs/performance.md.
5. Docs: README with a 10 minute quickstart (docker compose up, seed, run example), docs/api.md regenerated from OpenAPI, CONTRIBUTING.md.
6. Release: changesets for versioning, publish @adgate/sdk and @adgate/schemas to npm and adgate to PyPI from CI on tag. Docker image for the gateway published to GHCR.
```

Acceptance: `npm view @adgate/sdk` and `pip install adgate` work from a clean machine, quickstart takes under 10 minutes on a fresh clone. Tag `v0.1.0`.

---

## Part 4: What to build after v0.1 (only once you have design partners)

- Koah and Gravity adapters, once you have partner API access. The interface is ready; do not build against guessed request shapes.
- Postgres-backed frequency caps per user across devices (needs a hashed user id from the app).
- Advertiser self-serve portal for uploading creatives and viewing reports without your involvement.
- A hosted classifier endpoint so small apps do not need their own LLM key.
- Agent-framework offer units (structured offers an agent evaluates during a task) for the backup thesis.

Everything in this list is a distraction until at least three apps are sending real traffic.

---

## Part 5: Working notes for Claude Code sessions on this project

Things that go wrong on projects shaped like this, and what to say when they do:

- Claude Code wants to add Redis for caps or caching. Say: "Postgres only, per CLAUDE.md. Use an upsert on cap_state."
- It builds an auction with bid floors and second price logic. Say: "Rank by ecpm_estimate times targeting_match. No auction in the MVP."
- It puts classification logic in the gateway package. Say: "Pure logic lives in core. Gateway wires only."
- It hand-writes TS types next to Zod schemas. Say: "Derive with z.infer. Delete the duplicates."
- It makes evaluate throw on bad input. Say: "Fail closed. Return suppress with reason error and log."
- It adds a 'sponsored' string inside the assistant message text. Say: "Ads never render inside model output. Separate block."
- Tests hit the network. Say: "Fake the LLM. No network in unit tests."
- The window is full and it starts forgetting conventions. Run /compact, then "Re-read CLAUDE.md and docs/api.md before continuing."

When you finish a phase and want a second opinion, this prompt works well:

```
Spawn a reviewer subagent. It should read the diff since the last commit, check it against CLAUDE.md non-negotiables and docs/api.md, and produce a list of concrete problems with file and line references. No praise, no summaries, only problems and suggested fixes.
```

For the YC application, the instrumentation in Phase 8 is the point. Track from day one: apps integrated, turns processed, ad-eligible rate, fill rate, RPM on eligible turns, and advertisers who paid for a verification report. Those six numbers are the story.
