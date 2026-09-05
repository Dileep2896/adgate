# @adgate/dashboard

The operator dashboard. A Next.js App Router app that reads the gateway's Postgres directly
with Drizzle and shows what the gateway has been doing. It is private to this repo and is
never published.

## What it does today (S30, S31, S32)

- `/login` - one admin password, a signed cookie session.
- `/apps` - the five gateway-wide numbers (apps integrated, turns in the last 30 days, ad
  eligible rate, RPM, advertisers with a generated report) over every app registered against
  this gateway: name, app id, policy version and hash (truncated, with a copy button), when it
  was created, the size of its private creative catalog and how many turns it evaluated in the
  last 30 days.
- `/apps/new` - register an app and read its first API key, once.
- `/apps/[id]` - the app's last 30 days (turns evaluated, ad eligible rate, fill rate,
  impressions, clicks, CTR, estimated revenue, RPM) with a decisions-per-day chart and a
  suppress-reason breakdown, then the policy YAML in an editor with inline schema errors, and
  the API keys with a Revoke button.
- `/creatives`, `/audit`, `/reports` - placeholders filled in by S33, S34 and S35.

## The metrics

`lib/metrics.ts` is a PURE module - no database, no React, no environment, no clock - and it is
the only place that defines what a number means. It is worth reading its header before touching
anything on the overview; in particular:

- **turns evaluated** counts the `is_latest` audit record of each turn, so an attested turn is
  counted once, not twice.
- **ad eligible** means the turn got past every policy rule up to and including
  `frequency_caps` and the gateway went on to ask demand: `decision = serve`, or `suppress` with
  reason `no_fill`. Everything else (`paid_user`, `region_blocked`, `sensitive_category:<name>`,
  `low_confidence`, `low_commercial_intent`, `frequency_cap`) is a rejection before demand, and
  `error` is not counted as eligible either - adgate fails closed and does not claim
  eligibility it cannot prove.
- **RPM** is per 1000 ELIGIBLE turns, not per 1000 impressions.
- Every rate is `null`, rendered `-`, when its denominator is 0. "No eligible turns" and
  "nothing filled" are different facts.

`lib/metrics.test.ts` computes all of it by hand from a fixture with round numbers.

`lib/metrics-queries.ts` holds the SQL. audit_records is the table that grows and the one that
holds the signed chain, so no query here may read it whole: the per-app queries filter by
`(app_id, ts)` and the global ones walk `apps` with a `CROSS JOIN LATERAL` that AGGREGATES (a
plain lateral gets pulled up into the outer join and goes straight back to a full scan), so
every access lands on `audit_records_app_id_ts_idx`. `lib/metrics-queries.integration.test.ts`
seeds 10 000 records and runs `EXPLAIN` on each query, failing on a `Seq Scan on audit_records`.

The charts are `recharts`, in two CLIENT components under `components/charts/` that receive
already computed plain arrays. Nothing server side reaches the browser through them: after S32
the shared First Load JS is unchanged at 102 kB and only `/apps/[id]`, the one route with
charts, grew (107 kB -> 220 kB).

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
| `DATABASE_URL_TEST`        | tests    | Playwright's database. The metrics integration test creates and uses `<that database>_dashboard`, so `turbo run test` cannot have it and the gateway's suites truncating the same tables at once. |

## Commands

```sh
pnpm dev                                  # gateway on :8787 and the dashboard on :3000
pnpm --filter @adgate/dashboard dev       # dashboard alone
pnpm --filter @adgate/dashboard build
pnpm --filter @adgate/dashboard test      # vitest (128): the pure unit tests, the chart
                                          # components in jsdom, and the metrics integration
                                          # test, which needs docker Postgres
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

`e2e/metrics.spec.ts` seeds a second app with ten known turns and asserts the rendered overview
matches the numbers computed by hand in `e2e/seed.ts`, that the app with no traffic renders
zeros, dashes and two EMPTY charts with nothing thrown, and that the `/apps` header agrees.

`e2e/smoke.spec.ts` checks that `/apps` redirects an anonymous visitor to `/login`, that a
forged cookie does not get past the layout, that a wrong password is refused, and that logging
in shows the four nav sections and the seeded app. `e2e/apps.spec.ts` creates an app through
the UI, asserts the API key is shown once and is gone after a reload, then pastes a policy that
drops `self_harm` plus an unknown key (both errors inline, `policy_hash` unchanged, nothing
persisted) and a valid tightening one (`policy_version` 1 -> 2, new hash), and revokes the
app's key.
