# @adgate/dashboard

The operator dashboard. A Next.js App Router app that reads the gateway's Postgres directly
with Drizzle and shows what the gateway has been doing. It is private to this repo and is
never published.

## What it does today (S30 - S35)

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
- `/creatives`, `/creatives/new`, `/creatives/[id]` - the catalog the demand path serves from.
- `/audit` - search the signed records by app, date range, decision and reason, with keyset
  pagination; `/audit/[id]` shows one record, its chain neighbours and its other version, and
  runs `verify()` live over it.
- `/reports`, `/reports/new`, `/reports/[id]` - verification reports for an advertiser over a
  date range: impressions and clicks by app, the category distribution of the turns their
  creatives appeared on, sensitive exposures (which must be zero), disclosure compliance and
  separation attestation as percentages, and chain integrity - in a printable view, with a JSON
  bundle that re-verifies offline.

## The audit view

`/audit` is a plain GET form: every filter and the page position are query parameters
(`lib/audit-filters.ts`), so the view is a URL an operator can bookmark or send to an auditor.
The reason select is built from the reasons the records in range actually carry, sensitive
categories included, rather than a hardcoded list.

Paging is **keyset**, not `OFFSET`: a page is "the records strictly older than
`(ts, record_hash)`". `record_hash` is the primary key, so the pair totally orders the log and
each record lands on exactly one page whatever the gateway writes while an operator is reading.
`lib/audit-pagination.integration.test.ts` seeds 1 200 records in groups that SHARE a timestamp
and walks every page forwards and backwards, asserting no row is seen twice, none is missed and
the walk adds up to 1 200. The search query reaches `audit_records` through
`audit_records_app_id_ts_idx` - with no app selected it walks `apps` with a `CROSS JOIN LATERAL`
whose `ORDER BY ... LIMIT` is the optimisation fence - and
`lib/metrics-queries.integration.test.ts` EXPLAINs it alongside the metric queries.

`/audit/[id]` runs core's `verify()` **on this request**, over the record exactly as stored,
using the gateway's own loader and `buildVerifyContext` through the `@adgate/gateway/audit`
subpath rather than a second copy that could drift: the positional predecessor at `seq - 1`,
the content hash recomputed from the creatives row, the superseded version with its own
predecessor, and the superseding attestation of an older version. All eight docs/audit.md
checks are listed with their `ok` state and detail, and a failing one is spelled out - the word
`FAILED`, a warning glyph and a filled band - because red text alone is invisible in a
screenshot, to a colour-blind operator and to anyone scanning quickly.

`?version=<record_hash>` selects one stored version, the same parameter the gateway's
`GET /v1/audit/:id` takes; attestation writes a second record, so an id with two versions gets a
switcher. `lib/audit-verify.integration.test.ts` writes real signed records, tampers them with
SQL and asserts WHICH check fails: a rewritten classification fails `record_hash` alone, an
edited creatives row fails `creative_hash`, a deleted predecessor fails `chain`.

## The verification report

`/reports/new` picks an advertiser and a period; generation runs on the server and stores the
document in the gateway's `reports` table under a `rep_` id, which is what moves the
"advertisers with a generated report" number in the `/apps` header.

`lib/report.ts` is a PURE module (no database, no React, no environment, no clock) and, like
`lib/metrics.ts`, is the only place that defines what a number means. Read its header. Two
rules are worth repeating here:

- **The signed document is the only source.** Decision, classification, disclosure and
  attestation are read from the signed JSON, never from the indexed column copies beside it,
  which `record_hash` does not cover. A record whose document no longer parses is counted, is
  reported as unreadable, and can satisfy no rule. Impressions and clicks are the stated
  exception: events arrive after the turn and are not signed.
- **Chain integrity is the six checks that decide whether a record is AUTHENTIC** - `schema`,
  `record_hash`, `chain`, `signature`, `creative_hash`, `supersedes`. `disclosure_present` and
  `separation_attested` are the report's other two headline percentages; counting them inside
  chain integrity as well would report the same gap twice and would call an untouched chain
  "broken" merely because an integrator never attested. The document names the checks its
  number is over, so nothing is hidden.

`lib/report.test.ts` computes every figure by hand from a six-record fixture holding an
attested record, three unattested ones, a suppression and a record whose document does not
parse. `lib/report-generate.ts` does the reading: the records come from
`audit_records_advertiser_id_ts_idx` (`(advertiser_id, ts)`, `is_latest` only, so an attested
turn counts once) and each one is verified with the GATEWAY's own `createAuditReader` and
`buildVerifyContext` through `@adgate/gateway/audit`, exactly as `/audit/[id]` does - a report
that graded records more leniently than the audit API would be worse than no report.

### The JSON bundle re-verifies offline

`/reports/[id]` offers a JSON bundle carrying the report, the audit records, **the neighbours
those checks read** (each record's positional predecessor, the version an attestation
supersedes and that record's own predecessor), the six content fields of every creative the
records name, and the public keys. That is everything the eight checks need, so:

```sh
pnpm --filter @adgate/dashboard verify:bundle path/to/rep_....json
```

rebuilds each record's `VerifyContext` from the bundle itself, runs `@adgate/core`'s `verify()`
and prints a pass/fail line per record - with no database, no network and no adgate deployment
(`scripts/verify-bundle.ts`, `lib/report-bundle.ts`). Exit code 0 when every record verifies, 1
when one does not, 2 when the file is not a bundle.
`lib/report-generate.integration.test.ts` generates a real bundle, writes it to a temp file and
runs that script in a separate process, then rewrites one record with SQL and asserts the same
script reports `FAIL`.

The bundle carries PUBLIC keys only, and the records are re-read at download time rather than
frozen at generation: if a record was edited after the report was generated, the bundle fails to
verify, which is exactly what an auditor wants to learn.

### Printing

A report is an artifact that gets forwarded and filed, so `Cmd+P` has to produce the document
and nothing else. The nav, the footer and every button carry `no-print`, and one `@media print`
block in `app/globals.css` removes them; `e2e/reports.spec.ts` emulates print media and asserts
the nav and the download button are hidden while the report is still there.

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

The admin actions need to write, so they use a SECOND handle, `lib/db-write.ts`, which only the
server actions under `app/(dashboard)/{apps,creatives,reports}/actions.ts` import -
`lib/db-write-usage.test.ts` holds that list and fails when it grows. The writes themselves are
mostly not hand written: creating an app, issuing a key, revoking one and the whole creative
catalog are the gateway's own functions, imported from the `./admin` subpath export
(`@adgate/gateway/admin`). The only SQL this package owns is one `UPDATE apps` that stores an
edited policy (`lib/admin-store.ts`) and one `INSERT` into `reports` (`lib/report-store.ts`).

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

| Variable                   | Required | Meaning                                                                                                                                                                                                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | yes      | The gateway's Postgres. Read only from here.                                                                                                                                                                                                           |
| `ADMIN_PASSWORD`           | yes      | The dashboard login.                                                                                                                                                                                                                                   |
| `DASHBOARD_SESSION_SECRET` | no       | Session HMAC key; derived from the password if unset.                                                                                                                                                                                                  |
| `DASHBOARD_PORT`           | no       | `pnpm dev` port, default 3000.                                                                                                                                                                                                                         |
| `DASHBOARD_E2E_PORT`       | no       | Playwright port, default 3210.                                                                                                                                                                                                                         |
| `ADGATE_PUBLIC_KEYS_JSON`  | no       | Public keys `/audit` verifies signatures with. Unset or `{}` with `ADGATE_SIGNING_KEY_PEM` present derives the signing key's public half under `ADGATE_SIGNING_KEY_ID`; with neither, `/audit` still renders and says the signature cannot be checked. |
| `ADGATE_SIGNING_KEY_ID`    | no       | The key id the derived public key is filed under.                                                                                                                                                                                                      |
| `DATABASE_URL_TEST`        | tests    | Playwright's database. The metrics integration test creates and uses `<that database>_dashboard`, so `turbo run test` cannot have it and the gateway's suites truncating the same tables at once.                                                      |

## Commands

```sh
pnpm dev                                  # gateway on :8787 and the dashboard on :3000
pnpm --filter @adgate/dashboard dev       # dashboard alone
pnpm --filter @adgate/dashboard build
pnpm --filter @adgate/dashboard test      # vitest (246): the pure unit tests, the chart
                                          # components in jsdom, and the four integration
                                          # tests, which need docker Postgres
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

`e2e/audit.spec.ts` seeds an app whose whole chain is real - built with `buildAuditRecord`,
signed with the gateway's own key, chained `seq` 1..6 - filters `/audit` by decision, opens a
detail page and asserts all eight checks pass, then rewrites one record with SQL and asserts the
page shows `INVALID` with `record_hash` marked `FAILED` and every other check still `OK`.
`playwright.config.ts` hands the server under test the PUBLIC half of `ADGATE_SIGNING_KEY_PEM`,
never the private key.

`e2e/reports.spec.ts` seeds three served turns with impressions, a click and one attestation,
generates a report from the form, asserts the numbers on screen and the `/apps` header moving to
one advertiser with a report, downloads the JSON bundle and checks it carries the records and
the public keys (and no private one), and emulates print media to assert the nav and the buttons
are gone while the report is not.

`e2e/smoke.spec.ts` checks that `/apps` redirects an anonymous visitor to `/login`, that a
forged cookie does not get past the layout, that a wrong password is refused, and that logging
in shows the four nav sections and the seeded app. `e2e/apps.spec.ts` creates an app through
the UI, asserts the API key is shown once and is gone after a reload, then pastes a policy that
drops `self_harm` plus an unknown key (both errors inline, `policy_hash` unchanged, nothing
persisted) and a valid tightening one (`policy_version` 1 -> 2, new hash), and revokes the
app's key.
