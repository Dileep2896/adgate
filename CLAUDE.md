# adgate

Neutral policy, verification, and mediation gateway for ads inside AI chat and agents.
Open source (Apache 2.0). We are NOT an ad network. We decide whether an ad is allowed
in a conversation turn, fetch a candidate from demand sources, render a separate labeled
slot, and write a signed audit record proving what happened.

## How this repo is built (Ralph loop)
This project is built autonomously, one story per iteration. Each iteration is a fresh
Claude Code session. Memory between iterations lives ONLY in git history, prd.json,
and progress.txt. On every session start:
1. Read prd.json, progress.txt, docs/api.md, docs/policy.md, docs/audit.md.
2. Pick exactly ONE story: lowest priority number with passes=false whose dependsOn are all passes=true.
3. Implement it fully. No stubs, no TODOs left for "later" unless the story says so.
4. Run pnpm test, pnpm typecheck, pnpm lint. All green or the story is not done.
5. Set passes=true in prd.json, append a dated entry to progress.txt, commit.
6. Stop. Do not start a second story.
If a story cannot be completed, do NOT mark it passed. Write NEEDS HUMAN plus the reason
in progress.txt, commit nothing broken, and stop.

## Non-negotiables
- Fail closed: any error, timeout, or low confidence returns decision=suppress. Never throw to the caller.
- Ads never render inside model output. Separate block, after the answer, always labeled.
- Paid tiers never get ads unless policy sets allow_paid_tiers: true.
- docs/api.md, docs/policy.md, docs/audit.md are the contract. Do not change their meaning. Schemas in packages/schemas implement them exactly.
- No new infrastructure. Postgres only. No Redis, queues, or microservices.
- Do not store raw conversation text unless policy.privacy.store_raw_text is true. Store hashes and categories.
- Do not add dependencies beyond the stack list without writing why in progress.txt.

## Stack
pnpm workspaces + Turborepo, TypeScript strict, Node 20, ESM, Hono, Drizzle + Postgres 16,
Zod, Vitest, supertest, pino, tsup, Ed25519 via node:crypto, argon2 for API keys.
Python SDK: httpx + pydantic v2 + pytest + respx. Dashboard: Next.js App Router + Tailwind + recharts.

## Commands
- pnpm install
- pnpm dev          (gateway on :8787, dashboard on :3000)
- pnpm test         (vitest, all packages; integration tests need docker compose up -d postgres)
- pnpm typecheck
- pnpm lint
- pnpm db:migrate
- docker compose up -d postgres

## Conventions
- Tests first. Failing test, then implementation.
- Pure logic lives in packages/core (no HTTP, no DB, no env access). packages/gateway wires only.
- Zod schema first, derive TS types with z.infer. Never hand-write duplicate types.
- Every demand source implements DemandAdapter. Every classifier stage implements a small interface.
- IDs are ULIDs with prefixes: app_, cr_, aud_, ev_, key_, adv_.
- Timestamps: ISO 8601 UTC strings in JSON, timestamptz in Postgres.
- Structured logs with pino. Never log message content.
- Named exports only. Files under 300 lines. Split by responsibility.
- Unit tests never touch the network. Fake the LLM. Integration tests use the docker Postgres with a test database.

## Layout
packages/schemas  packages/core  packages/gateway  packages/sdk  packages/sdk-python  packages/dashboard
examples/nextjs-chat  examples/fastapi-chat  docs/  fixtures/  scripts/

## When unsure
Prefer the simplest thing that satisfies the story's acceptance criteria. If a story
seems to require changing the contract docs, stop and write NEEDS HUMAN in progress.txt.
