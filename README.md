# adgate

Neutral policy, verification, and mediation gateway for ads inside AI chat and agents.
Open source under Apache 2.0.

## What adgate is

adgate sits between an AI app and any ad demand source. For each conversation turn it:

1. Decides whether a sponsored slot is allowed at all: policy as code, sensitive category detection, paid user suppression, region rules, frequency caps.
2. Fetches a candidate from the app's own demand sources (direct sponsors, affiliate accounts, optional networks) and mediates between them.
3. Renders a clearly labeled slot as a separate block after the model's answer, never inside it.
4. Writes a signed, hash chained audit record for every decision, including suppressions, that advertisers and auditors can verify independently.

Every error, timeout, or low confidence result fails closed: the slot is suppressed and the caller never sees an exception. The contract lives in `docs/api.md`, `docs/policy.md`, and `docs/audit.md`.

## What it is not

- Not an ad network. We do not own demand. Apps bring direct sponsors, affiliate accounts, or plug in networks.
- Not a way to put ads inside model output. The SDK refuses to render inline.
- Not a user profiling system. We store hashes and categories, not conversations.
- Not a hosted platform you have to depend on. Self host it next to your app; the only infrastructure is Postgres.

## Status

Pre-alpha, built story by story from `prd.json` using an autonomous Claude Code loop. See `progress.txt` for what exists today.

## Quickstart

Placeholder until story S39 fills in the 10 minute walkthrough (seeded creatives, an example chat app, a verified audit record). What works today:

```bash
pnpm install
cp .env.example .env            # if a local Postgres already owns 5432, set PGPORT_HOST=5433 and use it in both DATABASE_URL values
docker compose up -d postgres   # Postgres 16 with databases adgate and adgate_test
pnpm test && pnpm typecheck && pnpm lint
```

Continuous integration (`.github/workflows/ci.yml`) runs the same install, typecheck, lint, and test steps on every push and pull request against a Postgres 16 service container.

## Repo layout

```
packages/schemas    Zod contract, JSON Schema export
packages/core       classify, policy, demand, audit (pure)
packages/gateway    Hono service, Drizzle, migrations
packages/sdk        @adgate/sdk (+ react, + ai entries)
packages/sdk-python adgate on PyPI
packages/dashboard  Next.js admin and verification reports
examples/           nextjs-chat, fastapi-chat
docs/               api.md, policy.md, audit.md are the contract
fixtures/           classifier golden set
scripts/db/         Postgres init script (creates adgate_test)
scripts/ralph/      the build loop
.github/workflows/  CI
```

## Building adgate with the loop

```bash
# one time
pnpm install
docker compose up -d postgres
cp .env.example .env

# watch one iteration
scripts/ralph/ralph-once.sh

# or run the loop (in a clone you can reset)
scripts/ralph/ralph.sh 40
```

## License

Apache 2.0. See [LICENSE](LICENSE).
