# Architecture

```
  AI app (chat UI, agent, coding tool)
        |
        |  @adgate/sdk (TS) or adgate (Python)
        |  evaluate(turn, user) in parallel with the model call
        v
  +------------------------------------------------------------+
  |  adgate gateway (Hono, self-hostable, single service)       |
  |  1. Classify turn   rules -> LLM (cached) -> intent, cats   |
  |  2. Policy engine   YAML policy as code -> allow/suppress   |
  |  3. Mediation       direct | affiliate | network adapters   |
  |  4. Disclosure      label + placement + separation flag     |
  |  5. Audit           hash chain + Ed25519 signature          |
  +------------------------------------------------------------+
        |                        |
        v                        v
   Postgres (apps, keys,      Demand sources
   creatives, audit, events,  (direct catalog, affiliate link
   caps, classify cache)      builders, Koah/Gravity adapters)
        |
        v
   Dashboard + verification reports (Next.js)
```

## Packages

- `packages/schemas`: Zod schemas for the contract, JSON Schema export, PolicyConfig loader. No logic beyond validation and defaults.
- `packages/core`: pure logic. `classify/`, `policy/`, `demand/`, `audit/`, `canonical/`. No HTTP, no DB, no env, no network in tests.
- `packages/gateway`: Hono app, Drizzle schema and migrations, auth, rate limiting, routes, seed and load scripts.
- `packages/sdk`: `@adgate/sdk` with `react` and `ai` sub-entries.
- `packages/sdk-python`: `adgate` on PyPI.
- `packages/dashboard`: Next.js admin and reports.

## Request lifecycle (evaluate)

1. Auth by API key (argon2 hash compare) and rate limit.
2. Load app policy, merge validated overrides (stricter only).
3. Read cap state for (app, conversation_hash) and optionally (app, user_hash, day).
4. Classify: Postgres cache lookup by hash, then in-memory LRU, then rules, then LLM with 400 ms timeout. Fail to rules only.
5. Policy engine. If suppressed, skip demand.
6. Mediation across enabled adapters, 250 ms each, in parallel. Filter competitor exclusions. Rank by ecpm_estimate * targeting_match.
7. Build audit record, chain to previous record, sign, persist.
8. Update cap state. Respond.

Everything is wrapped so that any failure returns `suppress` with `reason: error` and HTTP 200.

## Non-goals for v0.1

No auctions, no RTB, no Redis, no queues, no multi-region, no user profiles, no billing, no mobile SDKs. See docs/decisions.md.
