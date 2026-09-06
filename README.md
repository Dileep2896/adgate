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

Pre-alpha, built story by story from `prd.json` using an autonomous Claude Code loop. See
`progress.txt` for what exists today.

## Quickstart

Ten minutes from a fresh clone to a served, labeled, verifiable sponsored slot in a real chat
app. Every command below is run from the repo root unless it says otherwise.

**No LLM API key is needed.** The example ships an offline mock model (`lib/mock-model.ts`) that
streams one of three canned answers picked by keyword, and the gateway classifies with its rules
engine when no classifier is configured. Nothing in this walkthrough talks to a model provider.

### What you need

| | |
| --- | --- |
| Node | 20 or newer (`node -v`) |
| pnpm | 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`) |
| Docker | running, for Postgres 16 |

### 1. Install, build, and start Postgres

```bash
git clone <this repo> adgate && cd adgate
pnpm install
pnpm build                               # ~30s; the packages import each other's dist/
docker compose up -d postgres
```

`pnpm build` is not optional on a fresh clone: the gateway, the SDK and the example resolve
`@adgate/core` and friends through their `dist/` directories, so the scripts below fail with
`ERR_MODULE_NOT_FOUND` until they exist. `docker compose` starts Postgres 16 with the databases
`adgate` and `adgate_test` (created by `scripts/db/init.sql`) and publishes it on host port 5432.

<details>
<summary><strong>If port 5432 is already taken</strong> (a native Postgres, or another adgate stack)</summary>

The compose file publishes `${PGPORT_HOST:-5432}`, so pick another port and use it everywhere.
After step 2 has created `.env`, append:

```
PGPORT_HOST=5433
DATABASE_URL=postgres://adgate:adgate@localhost:5433/adgate
DATABASE_URL_TEST=postgres://adgate:adgate@localhost:5433/adgate_test
```

(The last assignment of a name in `.env` wins, so appending overrides the defaults above.) Then
`docker compose up -d postgres` again, and it comes up on 5433.

If an adgate Postgres from another checkout is _already_ running on that port, you can point at
it instead of starting a second one — give yourself a database of your own so the two never
share data:

```bash
docker exec <postgres container> psql -U adgate -d postgres -c 'CREATE DATABASE adgate_demo'
# then in .env: DATABASE_URL=postgres://adgate:adgate@localhost:5433/adgate_demo
```

`docker ps` names the container. (`psql` on your own machine works too, if you have it:
`psql postgres://adgate:adgate@localhost:5433/postgres -c 'CREATE DATABASE adgate_demo'`.)

</details>

### 2. Configure, and generate a signing key

```bash
cp .env.example .env
pnpm --silent --filter @adgate/gateway keygen >> .env
```

`.env.example` is the annotated list of every variable; the defaults are all local dev values.
`keygen` prints three lines — `ADGATE_SIGNING_KEY_ID`, `ADGATE_SIGNING_KEY_PEM` and
`ADGATE_PUBLIC_KEYS_JSON` — and writes nothing itself. Appending them to `.env` is enough: the
last assignment of a name in the file wins, so they replace the empty placeholders above them.
**Keep `--silent`**, or pnpm's own `> @adgate/gateway keygen` banner lands in `.env` too. (Prefer
to paste the three lines over the placeholders by hand? Run it without the redirect.) The private
key never leaves your machine and `.env` is git ignored; the gateway refuses to start without it.

### 3. Create the schema, an app, and a catalog

```bash
pnpm db:migrate
pnpm --filter @adgate/gateway create-app --name my-app
pnpm --filter @adgate/gateway seed-creatives
```

`create-app` prints an `app_id` and an `api_key`. **The key is shown once** — only an argon2id
hash of it is stored — so copy both now. `seed-creatives` loads
`examples/creatives.seed.json` (three example advertisers) into the shared catalog; re-running
any of these three commands is a no-op.

### 4. Start the gateway

```bash
pnpm --filter @adgate/gateway dev        # http://localhost:8787
```

Leave it running and check it in another terminal:

```bash
curl -s localhost:8787/healthz           # {"ok":true}
```

### 5. Run the Next.js example

In a second terminal:

```bash
cp examples/nextjs-chat/.env.local.example examples/nextjs-chat/.env.local
# edit that file: ADGATE_APP_ID and ADGATE_API_KEY from step 3
pnpm --filter nextjs-chat dev            # http://localhost:3001
```

The example needs exactly three variables: `ADGATE_APP_ID`, `ADGATE_API_KEY` and
`ADGATE_BASE_URL` (already `http://localhost:8787`). The API key stays on the server; the
browser never sees it. It serves on 3001 because the dashboard owns 3000; to move it, set `PORT`
in the shell (`PORT=3005 pnpm --filter nextjs-chat dev`), not in `.env.local`.

Open <http://localhost:3001> and ask:

> which postgres hosting should I use for a side project

The answer streams in, and **underneath it, outside the assistant message, a separate card
labeled `Sponsored`** appears with one of the seeded creatives. That is the whole point: the
gateway chose it in parallel with the answer, and the model never saw it.

Try the other buttons under an empty chat to watch the policy work — flipping the header toggle
to **Paid tier** and asking the same question suppresses the slot with `paid_user`, a health
question with `sensitive_category:health`, a vague question with `low_commercial_intent`.
`examples/nextjs-chat/README.md` has the full table.

### 6. Read the audit record and verify it

Every turn — served or suppressed — leaves one signed record. The UI prints the `audit_id` on a
suppressed turn; on a served one it is the last path segment of the sponsored link
(`http://localhost:8787/c/aud_…`). The gateway's `evaluate` log line carries it either way.

```bash
KEY=ak_...                               # the key from step 3
AUD=aud_...                              # the audit id of the turn

curl -s -H "Authorization: Bearer $KEY" localhost:8787/v1/audit/$AUD | jq
curl -s -H "Authorization: Bearer $KEY" localhost:8787/v1/verify/$AUD | jq '.valid, .checks'
```

`/v1/verify/:id` answers `{ "valid": true, "checks": [...] }` with eight named checks: it
re-computes the record hash, walks the hash chain to the app's previous record, checks the
Ed25519 signature, re-hashes the creative as stored, and confirms a disclosure label was present
and that separation was attested. The SDK sends the attestation as soon as the answer is
complete, so a record verified a moment too early can report `separation_attested` as
`not attested`; verify it again and it passes. Nothing here trusts the gateway: given the public
key, anyone can run the same checks on the record.

### 7. Open the dashboard

```bash
pnpm --filter @adgate/dashboard dev      # http://localhost:3000
```

Log in with `ADMIN_PASSWORD` from `.env` (`change-me` by default). It reads the same Postgres
read-only: headline metrics, the app list, the policy editor, the creative catalog, the audit
search with live verification, and advertiser verification reports. If something else owns 3000,
set `DASHBOARD_PORT` (`DASHBOARD_PORT=3020 pnpm --filter @adgate/dashboard dev`).

### Where to go next

| | |
| --- | --- |
| Wiring your own app | [docs/integration.md](docs/integration.md) — web chat, agent loops, CLI, TypeScript and Python |
| Writing a policy | [docs/policy.md](docs/policy.md), and `examples/policy.example.yaml` |
| The audit record and how to verify it yourself | [docs/audit.md](docs/audit.md) |
| The HTTP contract | [docs/api.md](docs/api.md), with a generated reference in [docs/api-reference.md](docs/api-reference.md) |
| What is stored, and for how long | [docs/privacy.md](docs/privacy.md) |
| Putting it on the internet, free tier included | [docs/deploy.md](docs/deploy.md) |
| Hardening a deployment | [SECURITY.md](SECURITY.md) |
| Latency, load testing, `/metrics` | [docs/performance.md](docs/performance.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

Continuous integration (`.github/workflows/ci.yml`) runs install, typecheck, lint and test on
every push and pull request against a Postgres 16 service container, plus a separate job for the
Python SDK.

## Published artifacts

**Not yet published.** The release pipeline exists — changesets for versioning and
`.github/workflows/release.yml` for a `v*` tag — and its dry runs pass locally, but nothing below
has been pushed to a registry yet. Until a human cuts the first release (the procedure and the
secrets they need are in [CONTRIBUTING.md](CONTRIBUTING.md#releasing)), use the packages from a
checkout, as the Quickstart does.

| Artifact | Where it will live | Once released |
| --- | --- | --- |
| `@adgate/schemas` | npm | `npm i @adgate/schemas` |
| `@adgate/sdk`, `@adgate/sdk/react`, `@adgate/sdk/ai` | npm | `npm i @adgate/sdk` |
| `adgate` (Python SDK) | PyPI | `pip install adgate` |
| the gateway service | GHCR | `docker pull ghcr.io/<owner>/<repo>/gateway:0.1.0` |

The image you can build today, from the repo root (the whole workspace is the build context):

```bash
docker build -f packages/gateway/Dockerfile -t adgate-gateway .
docker run --rm -p 8787:8787 \
  -e DATABASE_URL='postgres://adgate:adgate@host.docker.internal:5432/adgate' \
  -e PUBLIC_BASE_URL='https://ads.example.com' \
  -e ADGATE_SIGNING_KEY_ID=... -e ADGATE_SIGNING_KEY_PEM='-----BEGIN PRIVATE KEY-----\n...' \
  adgate-gateway
```

The image sets `NODE_ENV=production`, which turns on the production configuration checks, so
`PUBLIC_BASE_URL` is **required** there and must be an https URL that is not localhost — the
default (`http://localhost:8787`) would hand every user a click link back into the container.
Add `-e NODE_ENV=development` to poke at the image locally without them.
[docs/deploy.md](docs/deploy.md) has the complete environment table and a hosted walkthrough.

`@adgate/core`, `@adgate/gateway`, `@adgate/dashboard` and the examples are private and are never
published; the SDK's only runtime dependency is `@adgate/schemas`.

## Repo layout

```
packages/schemas    Zod contract, JSON Schema export
packages/core       classify, policy, demand, audit (pure)
packages/gateway    Hono service, Drizzle, migrations
packages/sdk        @adgate/sdk (+ react, + ai entries)
packages/sdk-python adgate on PyPI
packages/dashboard  Next.js admin and verification reports
examples/           nextjs-chat, fastapi-chat
docs/               api.md, policy.md, audit.md are the contract; privacy.md is the data inventory
fixtures/           classifier golden set
scripts/db/         Postgres init script (creates adgate_test)
scripts/ralph/      the build loop
.changeset/         changesets config and pending release notes
.github/workflows/  CI and release
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

## Security

The trust boundaries, the hardening checklist for a deployment and how to report a vulnerability
privately are in [SECURITY.md](SECURITY.md). Run `pnpm audit:prod` before a release.

## License

Apache 2.0. See [LICENSE](LICENSE).
