# @adgate/dashboard

The operator dashboard. A Next.js App Router app that reads the gateway's Postgres directly
with Drizzle and shows what the gateway has been doing. It is private to this repo and is
never published.

## What it does today (S30, S31)

- `/login` - one admin password, a signed cookie session.
- `/apps` - every app registered against this gateway: name, app id, policy version and hash
  (truncated, with a copy button), when it was created, the size of its private creative
  catalog and how many turns it evaluated in the last 30 days.
- `/apps/new` - register an app and read its first API key, once.
- `/apps/[id]` - the app's policy YAML in an editor with inline schema errors, and its API
  keys with a Revoke button.
- `/creatives`, `/audit`, `/reports` - placeholders filled in by S33, S34 and S35.

## Read only by default, one handle that writes

`lib/db.ts` opens the connection with `default_transaction_read_only`, so no page can write to
the gateway's database. Every query lives in `lib/queries.ts` and is a `SELECT`. The gateway
owns the audit chain; a dashboard that could edit it would defeat the point of signing it.

The admin actions need to write, so they use a SECOND handle, `lib/db-write.ts`, which only
`app/(dashboard)/apps/actions.ts` imports - `lib/db-write-usage.test.ts` fails if a second
module ever imports it. The writes themselves are not hand written: creating an app, issuing a
key and revoking one are the gateway's own functions, imported from the `./admin` subpath
export (`@adgate/gateway/admin`). The only SQL this package owns is one `UPDATE apps` that
stores an edited policy (`lib/admin-store.ts`).

The Drizzle table definitions are not duplicated here either: they come from the gateway's
`./schema` subpath export (`@adgate/gateway/schema`), built from
`packages/gateway/src/db/schema.ts`.

## The API key is shown exactly once

`registerApp` returns the new key; adgate stores only an argon2id hash of the secret, so it
can never be read again. The server action RETURNS it and `useActionState` puts it in the
browser's React state (`components/new-app-form.tsx`). It is therefore only ever in the
action's response body and in that tab's memory - never in a redirect, a query string, the
session cookie, `localStorage` or a log line. Reloading the page loses it for good, and a
Playwright spec asserts exactly that.

## Policy editing

Saving runs `loadPolicyFromYaml` (`@adgate/core`) - the same function the gateway parses with,
so the editor accepts exactly what the gateway will. An invalid document re-renders the page
with the schema's own messages next to the editor and writes **nothing**; a valid one bumps
`policy_version` by one (computed by Postgres, not read-then-written) and stores the document
with its new `policy_hash`. A document whose `app_id` names a different app is rejected too.

`lib/policy-issue.ts` exists so the client components can print an issue without pulling
`@adgate/core` (zod, the YAML parser, the whole policy schema) into the browser bundle.

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
pnpm --filter @adgate/dashboard test      # vitest unit tests (85: session, rate limit, env,
                                          # redirect, form parsing, policy validate-then-save)
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
table and inserts one app row.

`e2e/smoke.spec.ts` checks that `/apps` redirects an anonymous visitor to `/login`, that a
forged cookie does not get past the layout, that a wrong password is refused, and that logging
in shows the four nav sections and the seeded app. `e2e/apps.spec.ts` creates an app through
the UI, asserts the API key is shown once and is gone after a reload, then pastes a policy that
drops `self_harm` plus an unknown key (both errors inline, `policy_hash` unchanged, nothing
persisted) and a valid tightening one (`policy_version` 1 -> 2, new hash), and revokes the
app's key.
