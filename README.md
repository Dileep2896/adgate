# adgate

Neutral policy, verification, and mediation gateway for ads inside AI chat and agents.

adgate sits between an AI app and any ad demand source. For each conversation turn it decides whether a sponsored slot is allowed (policy as code, sensitive category detection, paid user suppression, frequency caps), fetches a candidate from the app's demand sources, renders a clearly labeled slot after the answer, and writes a signed, hash chained audit record that advertisers can verify independently.

## What adgate is not

- Not an ad network. We do not own demand. Apps bring direct sponsors, affiliate accounts, or plug in networks.
- Not a way to put ads inside model output. The SDK refuses to render inline.
- Not a user profiling system. We store hashes and categories, not conversations.

## Status

Pre-alpha, built story by story from `prd.json` using an autonomous Claude Code loop. See `progress.txt` for what exists today.

## Build it

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
scripts/ralph/      the build loop
```

## Quickstart

Filled in by story S39.

## License

Apache 2.0.
