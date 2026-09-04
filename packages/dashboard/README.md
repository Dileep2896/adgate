# @adgate/dashboard

The operator dashboard. A Next.js App Router app that reads the gateway's Postgres directly
with Drizzle and shows what the gateway has been doing. It is private to this repo and is
never published.

## What it does today (S30)

- `/login` - one admin password, a signed cookie session.
- `/apps` - every app registered against this gateway, with its policy hash, the size of its
  private creative catalog, how many turns it has evaluated and when the last one was.
- `/creatives`, `/audit`, `/reports` - placeholders filled in by S33, S34 and S35.

## Read only

`lib/db.ts` opens the connection with `default_transaction_read_only`, so the dashboard
physically cannot write to the gateway's database. Every query lives in `lib/queries.ts` and
is a `SELECT`. The gateway owns the audit chain; a dashboard that could edit it would defeat
the point of signing it. A later story that needs to write (create an app, save a policy) must
add its own read-write handle rather than loosening this one.

The Drizzle table definitions are not duplicated here: they come from the gateway's `./schema`
subpath export (`@adgate/gateway/schema`), which is built from `packages/gateway/src/db/schema.ts`.

## Auth

`ADMIN_PASSWORD` is the whole authentication model for the MVP. The password is compared in
constant time and never logged. On success `/api/login` sets `adgate_dashboard_session`:
`httpOnly`, `sameSite=lax`, `secure` in production, holding `v1.<expiry>.<HMAC-SHA256>` signed
with `DASHBOARD_SESSION_SECRET` (or, unset, a key derived from `ADMIN_PASSWORD`). Sessions
last 12 hours. Login attempts are rate limited in memory to 10 per minute per client address.

`middleware.ts` runs in the Edge runtime, where the signing secret is not available, so it
only checks that a session cookie is _present_ and redirects to `/login?from=...` when it is
not. The signature and expiry are verified in the Node runtime by `requireSession()` in
`app/(dashboard)/layout.tsx`, which every protected page renders under.

## Environment

Read from the repo-root `.env` (see `.env.example`) or from the real environment, which wins:

| Variable                   | Required | Meaning                                             |
| -------------------------- | -------- | --------------------------------------------------- |
| `DATABASE_URL`             | yes      | The gateway's Postgres. Read only from here.         |
| `ADMIN_PASSWORD`           | yes      | The dashboard login.                                 |
| `DASHBOARD_SESSION_SECRET` | no       | Session HMAC key; derived from the password if unset. |
| `DASHBOARD_PORT`           | no       | `pnpm dev` port, default 3000.                       |
| `DASHBOARD_E2E_PORT`       | no       | Playwright port, default 3210.                       |

## Commands

```sh
pnpm dev                                  # gateway on :8787 and the dashboard on :3000
pnpm --filter @adgate/dashboard dev       # dashboard alone
pnpm --filter @adgate/dashboard build
pnpm --filter @adgate/dashboard test      # vitest unit tests (session, rate limit, env, redirect)
pnpm --filter @adgate/dashboard typecheck
pnpm --filter @adgate/dashboard lint
```

## End to end smoke test

Playwright is **not** part of `pnpm test`: it needs a browser binary and a database. Run it
deliberately:

```sh
docker compose up -d postgres
pnpm exec playwright install chromium          # once per machine
pnpm --filter @adgate/dashboard test:e2e
```

`playwright.config.ts` builds the app and starts it with `next start` on `DASHBOARD_E2E_PORT`,
pointed at `DATABASE_URL_TEST`. `e2e/seed.ts` applies the gateway's migrations, truncates every
table and inserts one app row - it is the only code in this package that writes to Postgres.
The spec checks that `/apps` redirects an anonymous visitor to `/login`, that a forged cookie
does not get past the layout, that a wrong password is refused, and that logging in shows the
four nav sections and the seeded app.
