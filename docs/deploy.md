# Deploying adgate

A walkthrough for putting the gateway and the dashboard on the internet, written against the
free tiers of managed hosts because that is where a first deployment usually goes. Nothing here
is specific to a vendor: the gateway is one container with a Postgres URL, and the dashboard is
an ordinary Next.js app.

This is not a contract document. `docs/api.md`, `docs/policy.md` and `docs/audit.md` are, and
nothing below changes them.

**Before you start, read the last two sections.** [What degrades on a free
tier](#what-degrades-on-a-free-tier) explains what your users see when a suspended database wakes
up mid-request, and the [go-live checklist](#go-live-checklist) is the short version of this
whole page.

## The shape of a deployment

```
your app  ──►  gateway (container, :8787)  ──►  Postgres
                     ▲                              ▲
                     │                              │
              public click URLs              dashboard (Next.js, read-only
              GET /c/:audit_id               plus admin writes)
```

Three moving parts, one database:

| Part | What it is | Where it can live |
| --- | --- | --- |
| Postgres 16 | every table; the only state adgate has | Neon, Supabase, Render Postgres, Fly Postgres, your own |
| gateway | `packages/gateway/Dockerfile`, a Hono service | Render, Fly.io, Railway, Cloud Run, any container host |
| dashboard | `packages/dashboard`, Next.js App Router | Vercel, or the same container host |

The dashboard is optional: the gateway serves the whole API without it. The gateway is not
optional, and it **cannot run on an edge runtime** — `argon2`, which hashes API keys, is a native
Node addon. Anything that says "Edge Functions only" is out.

## 1. Postgres

Any Postgres 16 with a normal connection string. On a free tier:

- **Neon** — create a project, take the **pooled** connection string (the host contains
  `-pooler`), which is what a service with more than one instance wants.
- **Supabase** — Project settings → Database → **Connection pooling**, "Transaction" mode. Use
  that URI, not the direct one.

Both require TLS. Their strings already end in `?sslmode=require`; keep it.

```
DATABASE_URL=postgres://user:password@ep-xxx-pooler.eu-central-1.aws.neon.tech/adgate?sslmode=require
```

**Use the pooled string for the gateway.** The gateway opens a pool of its own (10 connections by
default) and a free-tier database usually allows far fewer direct ones.

One caveat about transaction-mode poolers: they do not keep a session between statements. adgate
needs a session for exactly two things — the per-app chain advisory lock inside a transaction
(which is transaction-scoped, and fine) and the retention scheduler's session-level advisory lock
on a reserved connection. If you enable `RETENTION_INTERVAL_HOURS` behind a transaction pooler
and see the run skipped every time, point the gateway at the **direct** (session-mode) string
instead, or run retention from cron against the direct string.

### Apply the migrations, once

Migrations are not applied at boot — a container that migrates on start races itself when the
host runs two of them. Run them from a checkout, against the hosted database:

```bash
git clone <this repo> && cd adgate
pnpm install
DATABASE_URL='postgres://…hosted…' pnpm db:migrate
```

Migrations are tracked, so re-running is a no-op, and they run with no statement timeout. Repeat
this after any deploy whose release notes mention a migration. (If you would rather not clone
anything, the image can do it: `docker run --rm -e DATABASE_URL=… adgate-gateway node
dist/db/migrate.js`.)

## 2. The signing key

Every audit record is signed with an Ed25519 key that only the gateway holds. Generate it once:

```bash
pnpm --filter @adgateio/gateway keygen --key-id k_2026_09
```

It prints exactly three lines, ready to paste:

```
ADGATE_SIGNING_KEY_ID=k_2026_09
ADGATE_SIGNING_KEY_PEM="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
ADGATE_PUBLIC_KEYS_JSON={"k_2026_09":"-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n"}
```

- The **private** line goes to the gateway only. Put it in your host's secret store, never in an
  image layer, a repository, or a build log.
- The **public** map goes to the gateway *and* to the dashboard, which verifies records with it.
  It is not a secret; publish it if you want third parties to check your records.
- Keep the line breaks as `\n` escapes and keep the double quotes. Most hosts' secret editors
  also accept a real multi-line value; either works.

The gateway logs `key_id` **and** `key_fingerprint` (the first 16 hex characters of the SHA-256
of the public key's SPKI DER) on the "configuration loaded" line at boot. Write the fingerprint
down after the first deploy. A `key_id` is a label you typed; the fingerprint is the key, and if
it ever changes while the id does not — a restored backup, a deploy script that re-ran `keygen` —
that line is where you find out, instead of discovering months of unverifiable records later. You
can reproduce it from any copy of the public PEM:

```bash
openssl pkey -pubin -in key.pem -outform DER | shasum -a 256 | cut -c1-16
```

Rotating means generating a new pair, changing `ADGATE_SIGNING_KEY_ID` and
`ADGATE_SIGNING_KEY_PEM`, and **keeping the old entry** in `ADGATE_PUBLIC_KEYS_JSON` next to the
new one. Old public keys stay in the ring forever; that is how records signed last year still
verify.

## 3. The gateway container

Build from the repo root — the build context is the whole workspace, because the gateway imports
`@adgateio/core` and `@adgateio/schemas`:

```bash
docker build -f packages/gateway/Dockerfile -t adgate-gateway .
```

On **Render**: New → Web Service → point at the repository, Runtime "Docker", Dockerfile path
`packages/gateway/Dockerfile`, Docker build context directory `.` (the root). On **Fly.io**:
`fly launch --dockerfile packages/gateway/Dockerfile` from the root, then `fly secrets set …`
for each variable. Railway and Cloud Run are the same two settings under different names.

Three things to get right:

1. **The host injects `PORT`.** Render, Fly and Cloud Run all set it and expect the process to
   listen there. The gateway reads `PORT` and does exactly that; the image's `ENV PORT=8787` is
   only the fallback for a host that injects nothing. Do not hard-code a port in a start command.
2. **`NODE_ENV=production` is already set in the image**, and it turns on the production
   configuration checks. The gateway will refuse to start — listing every problem at once,
   before it opens a port — if `PUBLIC_BASE_URL` is missing, not https, or points at
   `localhost`/`127.0.0.1`/`0.0.0.0`/`::1`; if `ADGATE_SIGNING_KEY_PEM` is the `.env.example`
   value; or if `ADMIN_PASSWORD` or `METRICS_TOKEN` is still `change-me`. It also *warns* (and
   starts) when `CORS_ALLOWED_ORIGINS` is empty or no classifier is configured.
3. **`PUBLIC_BASE_URL` is the origin your users' click links point at.** Set it to the gateway's
   own public URL (`https://adgate-gateway.onrender.com`, your custom domain, whatever it is)
   after the first deploy tells you what that is. Getting it wrong is silent in every way except
   that nobody ever arrives — which is exactly why the boot check exists.

Health check: `GET /healthz`. The image already declares a `HEALTHCHECK` for Docker; a
platform-level check should use the same path.

### Gateway environment

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres connection string. Use the pooled one. |
| `ADGATE_SIGNING_KEY_ID` | **yes** | The `key_id` written into every audit record, e.g. `k_2026_09`. |
| `ADGATE_SIGNING_KEY_PEM` | **yes** | PKCS#8 PEM of the Ed25519 private key. Secret. |
| `PUBLIC_BASE_URL` | **yes in production** | Externally reachable origin; every `/c/:audit_id` click URL is built from it. Must be https and not localhost. |
| `ADGATE_PUBLIC_KEYS_JSON` | recommended | `key_id` → public PEM map, retired keys included. Defaults to `{}`, in which case the signing key's own public half is derived at boot. |
| `NODE_ENV` | recommended | `production` on a deployment. Set by the image. |
| `PORT` | host-injected | Listen port. Let the platform set it. |
| `LOG_LEVEL` | recommended | `info`. JSON lines on stdout; never message content. |
| `CORS_ALLOWED_ORIGINS` | if a browser calls you | Exact browser origins, comma separated. Empty means no browser origin at all, which is right for a server-to-server integration and warned about at boot. |
| `METRICS_TOKEN` | recommended | Bearer token for `GET /metrics`. **Unset, the endpoint is not mounted at all**, so a forgotten deployment exposes nothing. Never `change-me`. |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | optional | Per-API-key token bucket. Defaults 20 / 40. |
| `DB_STATEMENT_TIMEOUT_MS` | optional | Postgres `statement_timeout` per connection, default 2000. A slower query is cancelled and the request fails closed. |
| `DB_LOCK_TIMEOUT_MS` | optional | `lock_timeout` per connection, default 1000: how long a turn waits for its app's chain lock. |
| `RETENTION_INTERVAL_HOURS` | see below | In-process retention job interval. `0` (default) registers no timer. |
| `CLASSIFIER_BASE_URL` / `CLASSIFIER_MODEL` / `CLASSIFIER_API_KEY` | optional | Any OpenAI-compatible chat completions endpoint, plus a small fast model. Leave the model empty to run the rules classifier only. |
| `CLASSIFIER_TIMEOUT_MS` | optional | Hard timeout for one classification, default 400. Exceeding it fails closed. |
| `KOAH_*` / `GRAVITY_*` | optional | Partner network adapters, disabled by default. |
| `DATABASE_URL_TEST` | never in production | Integration tests only. It gets truncated. |

`.env.example` is the canonical list, with a comment on every line.

## 4. Retention on a host with no cron

Each app's policy promises `privacy.retain_days` (`docs/policy.md`, `docs/privacy.md`). Something
has to keep it. The best answer is still cron:

```
17 4 * * *  cd /srv/adgate && pnpm --filter @adgateio/gateway retention
```

A free tier usually has nowhere to put that line, so the gateway can run the job itself:

```
RETENTION_INTERVAL_HOURS=24
```

What that gets you:

- A run about a minute after boot, then one every `RETENTION_INTERVAL_HOURS`.
- **One runner at a time, across processes.** Every run first takes a session-level Postgres
  advisory lock on a reserved connection. Two instances behind a load balancer, or the old and
  new container overlapping during a rolling deploy, cannot both prune: the loser logs
  `retention scheduled run skipped` with `reason: "lock_held"` and does nothing.
- One structured line per run — apps processed, pruned, skipped, failed, and rows deleted. Counts
  and positions only; no ids of deleted rows and no message content, ever.
- A failed run is an error log and nothing more. It never takes the process down, and the next
  tick tries again.
- The timer is cleared on `SIGTERM`, so a shutdown does not leave a run holding a lock.

**`DB_STATEMENT_TIMEOUT_MS` (default 2000 ms) applies to these scheduled runs**, exactly as it
does to a request — they use the gateway's own connection pool. A first run over a long backlog
can exceed it; that app comes back as `failed` in the summary and nothing is deleted for it,
because each app's deletion and its watermark commit together. The next run picks up where it
stopped, since deletion is always a prefix of the chain. If a backlog never drains, run the CLI
once from a checkout with a larger timeout (`DB_STATEMENT_TIMEOUT_MS=60000 pnpm --filter
@adgateio/gateway retention`) and let the timer keep up from there. Try `--dry-run` first: it does
the same work and rolls it back.

## 5. The dashboard on Vercel

`packages/dashboard` is a normal Next.js App Router app in a pnpm workspace. On Vercel: import
the repository, set **Root Directory** to `packages/dashboard`, and leave the build command
alone — Vercel detects Next and pnpm workspaces on its own.

It talks to the same Postgres **directly**, not through the gateway, so it needs `DATABASE_URL`
too. It reads for every page and writes for the admin actions (creating apps, issuing API keys,
editing creatives), for signup (one `users` row) and for a sign-in (`users.last_login_at`). Give
it the pooled connection string.

### Two surfaces, two postures

The dashboard is a **developer console** with an **operator surface** inside it, and they are
deployed differently:

- **Members** — `/signup`, `/login` and everything under them. A third-party developer signs up
  with an email and a password, owns the apps they create, and sees nothing else. **This is meant
  to be internet-facing.** Serve it over TLS and put platform rate limiting or a WAF in front of
  it if you expect abuse; adgate's own limiter is one in-memory fixed window per instance.
  Addresses are **not verified** — this build sends no email — so if you need verified identities,
  put an SSO proxy in front of the whole console.
- **The operator** — `/admin` and `/admin/login`. `ADMIN_PASSWORD` still works and is the
  break-glass path: it needs no account row, so an empty or broken `users` table cannot lock you
  out. This is the surface `DASHBOARD_ALLOWED_IPS` guards.

Three variables are not optional on a public host:

```
ADMIN_PASSWORD=<openssl rand -base64 24>
DASHBOARD_SESSION_SECRET=<openssl rand -base64 32>
TRUST_PROXY=true
DASHBOARD_ALLOWED_IPS=203.0.113.7, 198.51.100.0/24
```

**The password.** It is the operator's whole authentication model (see SECURITY.md). With
`NODE_ENV=production` the dashboard **refuses to start** on `change-me` or on anything shorter
than 16 characters, and says so on stderr before serving anything. Rotating it signs every
outstanding operator session out on its next request, because the cookie carries a digest of the
password it was minted against.

**`TRUST_PROXY=true` is required for the allowlist to work at all on Vercel.** The allowlist
needs to know who the client is, and the only evidence is `x-forwarded-for` — a request header,
which a client talking to the process directly can write itself. With no trusted hop the
dashboard refuses to believe it and reports the client as `unknown`, which is on no allowlist, so
**every request to `/admin/**` gets 403**. That looks exactly like an outage. Vercel always sits
in front of the app and rewrites the header, so one hop is correct there; use
`TRUSTED_PROXY_HOPS=2` if you have put your own CDN in front of Vercel.

**`DASHBOARD_ALLOWED_IPS`** is a comma-separated list of IPs and CIDR ranges, v4 or v6
(`203.0.113.7, 198.51.100.0/24, 2001:db8::/32`). Set it and the Edge middleware answers 403 to
anything from outside the list *before* `/admin/login` is reachable. **It no longer covers the
member surface**: signup, the member login and a developer's own pages are reachable from
anywhere, which is the point of self-serve. Leave it empty and nothing is restricted. Two
properties worth knowing:

- It is read **once, when the middleware instance starts**, not per request. Changing it is a
  restart on a self-hosted deployment and a **redeploy** on Vercel.
- If the variable is set but every entry is unparseable, the list matches nothing and every admin
  request is refused. That is deliberate: a typo should lock you out of your own operator page
  rather than quietly let the internet in. The member surface stays up either way, so a bad
  allowlist cannot take the console down for your users.

It is a second lock, never a replacement for the password. A source address is only as honest as
the proxy that wrote it, and an allowlist does nothing about a stolen session cookie.

### Accounts

`users` (added by migration `0006_self_serve_accounts`) holds one row per console account: a
lowercased unique email, an argon2id password hash, and a role of `member` or `admin`. `apps` and
`reports` gained a nullable `owner_user_id`; **null means "operator-created"**, which is what
`pnpm --filter @adgateio/gateway create-app` writes and what only an admin can see. Existing apps
therefore become operator-only when you apply this migration — expected, and the fix is either to
keep using the operator login or to hand an app to an account with one `UPDATE`:

```sql
update apps set owner_user_id = (select id from users where email = 'dev@example.com')
where id = 'app_...';
```

Promoting an account to `admin` is the same shape (`update users set role = 'admin' where email =
...`). There is no UI for either: both are decisions about other people's data, and neither is
needed to run the console.

### Dashboard environment

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | The same Postgres the gateway uses. |
| `ADMIN_PASSWORD` | **yes** | The operator's break-glass login at `/admin/login`. ≥ 16 characters in production, never `change-me`. |
| `DASHBOARD_SESSION_SECRET` | recommended | HMAC key for the session cookie (`openssl rand -base64 32`). Unset, it is derived from `ADMIN_PASSWORD`, so changing the password signs everyone out. |
| `NODE_ENV` | set by the host | `production` on Vercel. Turns on secure cookies and the password rule. |
| `TRUST_PROXY` | **yes behind a proxy** | `true` when a proxy you control (Vercel included) rewrites `x-forwarded-for`. Default is to trust nothing. |
| `TRUSTED_PROXY_HOPS` | optional | Integer; wins over `TRUST_PROXY`. `2` for a CDN in front of your load balancer. |
| `DASHBOARD_ALLOWED_IPS` | recommended | IP/CIDR allowlist over `/admin/**` ONLY. Empty means no allowlist. Needs `TRUST_PROXY`. Read at middleware start. |
| `ADGATE_PUBLIC_KEYS_JSON` | recommended | So `/audit` can verify signatures. Public keys only — never give the dashboard the private one. |
| `ADGATE_SIGNING_KEY_ID` | with the above | Names the current key in that map. |
| `DASHBOARD_PORT` | self-hosting only | Port for `pnpm --filter @adgateio/dashboard start`. Vercel ignores it. |

The dashboard never needs `ADGATE_SIGNING_KEY_PEM`. If you set it anyway (a shared `.env` on one
machine), it derives the public half and uses only that — but on a hosted deployment, don't.

## What degrades on a free tier

Free tiers sleep. Knowing exactly what your users see when they do is the difference between a
deployment you can leave running and one you cannot.

**A cold start.** A scaled-to-zero container takes seconds to answer the first request. A
suspended Neon or Supabase database takes a few hundred milliseconds to several seconds to wake.
Either one blows through the SDK's default 800 ms `timeoutMs` and the gateway's own 2000 ms
`DB_STATEMENT_TIMEOUT_MS`.

**What happens then is the whole point of the design.** `POST /v1/evaluate` fails **closed**: any
error, timeout or low-confidence answer is `decision: "suppress"`, and the SDK's `evaluate()`
resolves — it never rejects — to a suppress result with `reason: "error"`. Your chat app renders
the model's answer with **no ad block under it**. The user sees a normal answer. Nobody sees an
error, a spinner that never ends, or an ad that should not have been there. That is true for a
suspended database, an unreachable classifier, a demand source that times out, and a gateway that
is not running at all.

The cost is fill, not correctness: while the gateway is cold, no ads are served. On a free tier
expect that for the first request after an idle period, and expect it more often than you would
like. If that matters, the fix is a paid instance that does not sleep, not a longer timeout —
a longer timeout makes the user wait for the ad instead of hiding it.

Some other free-tier realities:

- **Connection limits.** Free Postgres tiers allow few connections. Use the pooled string, and
  drop `DB_STATEMENT_TIMEOUT_MS` and the pool size expectations accordingly if you run several
  instances.
- **Ephemeral disks.** adgate writes nothing to disk. There is no state to lose.
- **In-memory state is per instance.** The dashboard's login rate limiter is one `Map` per
  process (SECURITY.md), so it limits per instance. The gateway's rate limiter is in Postgres and
  is not affected.
- **The classifier costs money per turn.** Leaving `CLASSIFIER_MODEL` empty runs the rules
  classifier only: no LLM call, no bill, narrower intent recognition. The boot warning says so.
- **Scheduled retention needs the process to be awake.** A container that scales to zero may
  never reach its own timer. Check for the `retention scheduled run finished` line in your logs
  after the first day, and fall back to cron from a machine you control if it is not there.

## Go-live checklist

- [ ] Postgres reachable, **pooled** connection string, `sslmode=require`.
- [ ] `pnpm db:migrate` run once against the hosted database.
- [ ] Signing key generated; private PEM in the gateway's secret store only; public map on both
      services; **fingerprint from the boot log written down**.
- [ ] `PUBLIC_BASE_URL` set to the gateway's real https origin, and a click URL followed by hand
      once to prove it lands.
- [ ] `NODE_ENV=production` on both services; both start without a configuration error, and the
      gateway's boot warnings (CORS, classifier) are ones you meant.
- [ ] `CORS_ALLOWED_ORIGINS` set to the exact browser origins, or deliberately empty.
- [ ] `METRICS_TOKEN` set to a random value, or deliberately unset (then `/metrics` is a 404).
- [ ] `ADMIN_PASSWORD` ≥ 16 random characters, `DASHBOARD_SESSION_SECRET` independent of it.
- [ ] `TRUST_PROXY=true` on the dashboard, and `DASHBOARD_ALLOWED_IPS` set — then load
      `/admin/login` from an address that is *not* on the list and confirm the 403, and `/login`
      from the same address and confirm it still loads (the allowlist covers `/admin/**` only).
- [ ] `/signup` reached from a browser you have never signed in from: an account is created, the
      first app is registered, the key is shown once and the snippet carries the app id. Then a
      SECOND account, and confirm it cannot open the first one's app id.
- [ ] Retention scheduled: a crontab line, or `RETENTION_INTERVAL_HOURS`, and the first
      `retention scheduled run finished` line seen in the logs.
- [ ] An app registered and an API key issued (`pnpm --filter @adgateio/gateway create-app`), with
      the key stored somewhere it can be rotated.
- [ ] One end-to-end turn through your own app: an ad renders in its own labeled block after the
      answer, `GET /v1/audit/:id` returns the record and `GET /v1/verify/:id` says valid.
- [ ] Logs shipped somewhere searchable by `req_id`.
- [ ] `pnpm audit:prod` clean.
