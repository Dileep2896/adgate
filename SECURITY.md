# Security policy

adgate decides whether an ad may appear in a conversation turn and writes a signed record
proving what happened. Two things make security reports valuable to us above all others: a way
to make the gateway serve an ad it should have suppressed, and a way to make an audit record
say something that did not happen.

## Supported versions

| Version                   | Supported                                       |
| ------------------------- | ----------------------------------------------- |
| `main` (pre-1.0, `0.0.x`) | Yes. Fixes land on `main` and ship in the next tag. |
| Anything older than the newest tag | No. Upgrade first, then report if it still reproduces. |

Everything in this repository is pre-1.0. There are no long-term support branches: the fix for a
report is a commit on `main`.

## Reporting a vulnerability

**TODO-for-human: fill in the private contact before the first public release.** Until then the
lines below name placeholders, not working addresses.

- Email: `TODO-for-human: security@<your-domain>` (PGP key: `TODO-for-human` or "none, ask for a
  Signal number").
- Or open a GitHub private vulnerability report (Security → Report a vulnerability) once the
  repository is public: `TODO-for-human: confirm private reporting is enabled`.

Please do **not** open a public issue, pull request, or discussion for a vulnerability, and do not
post a proof of concept anywhere public until the fix ships.

A useful report has: the version or commit, the endpoint or package, what an attacker gains, and
the smallest reproduction you can manage (a `curl` command or a failing test is ideal). Tell us if
you want credit and under what name.

### What to expect

| When                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| Within 3 working days | We acknowledge the report and say whether we can reproduce it.          |
| Within 10 working days | We send an assessment: severity, affected versions, and a fix plan.    |
| Within 90 days      | The fix is released, or we explain why it takes longer and agree a new date. |
| On release          | We publish an advisory crediting you, unless you asked us not to.        |

We will not take legal action over research done in good faith against your own deployment: no
testing against someone else's gateway, no data taken beyond what proves the finding, no denial of
service against a running service.

## Security model

What adgate trusts, and what it does not.

### Trusted

- **The app's API key is the tenant boundary.** `Authorization: Bearer ak_<prefix>_<secret>` names
  one app row; every request is answered with that app's policy, salt, catalog and audit records.
  Keys are stored as argon2id hashes (`packages/gateway/src/auth/keys.ts`); the secret exists only
  in the caller's hands. Anyone holding an app key can do everything that app can do, so treat it
  as the app's password: server side only, never in a browser or a mobile binary, rotate it by
  issuing a new key and revoking the old one. A `advertiser_read` key is narrower: it reads and
  verifies records that reference its own advertiser, nothing else.
- **`policy_overrides` may only make policy stricter.** An app cannot widen its own policy over
  the wire — no removing blocked categories, raising caps or enabling paid tiers.
- **The signing key** (`ADGATE_SIGNING_KEY_PEM`) is what makes audit records worth anything.
  Ed25519, held by the gateway process. Whoever holds it can forge a record; keep it out of the
  repository, out of logs and out of images, and rotate by adding a new `key_id` to the public
  key ring so old records still verify.
- **The database** is trusted with what it stores. Row-level tenancy is enforced in the gateway,
  not in Postgres, so anyone with a Postgres connection is inside the boundary.

### Not trusted

- **Every request body.** Bodies are validated against the Zod contract schemas before anything
  reads them; a body over 256 KiB is refused with 413 before a route runs, and a single message
  over 32,768 characters is refused with 400. Only the last 4 messages and 4,000 characters ever
  reach the classifier.
- **Demand-source responses.** A candidate that does not parse, arrives late or fails policy is
  dropped; the turn suppresses rather than serving something unchecked.
- **Creative destinations.** `/c/:audit_id` redirects only to an absolute `http(s)` URL rebuilt
  from the stored creative and the app owner's own affiliate configuration — never to a
  `javascript:` or `data:` URL, and never to a destination taken from a request.
- **Audit ids are capabilities, not secrets to guess.** `/c/:audit_id` is public by design (a
  browser follows it with no API key), so knowing an id is enough to log a click on it. Ids are
  ULIDs handed to the app that owns the record; the redirect exposes the destination and writes a
  click event and nothing else. Reading the record itself (`/v1/audit/:id`, `/v1/verify/:id`) does
  need a key with a role that may see it.
- **The browser.** CORS is an allowlist from `CORS_ALLOWED_ORIGINS`; an origin that is not on it
  gets no CORS headers and its preflight is refused with 403. Credentials are never enabled — the
  API is authenticated with a bearer header, never with cookies — so a wildcard entry can never be
  combined with `Access-Control-Allow-Credentials`. Every response carries `nosniff`,
  `no-referrer`, `X-Frame-Options: DENY`, a `frame-ancestors 'none'` CSP and
  `Cross-Origin-Resource-Policy: same-origin`; HSTS is added only when the request arrived over
  TLS.
- **Conversation text.** Raw text is not stored unless the app's policy sets
  `privacy.store_raw_text: true`; hashes and categories are stored instead, and message content is
  never written to a log line. `docs/privacy.md` inventories every stored field, says which ones
  can hold user-derived data, and documents the retention job that enforces `retain_days`.

### The dashboard is an admin surface, not a public site

`packages/dashboard` authenticates with **one shared password** (`ADMIN_PASSWORD`) and a signed
session cookie. There are no user accounts, no roles and no audit of who did what. It reads and
writes the same database as the gateway, so it can create apps, issue API keys and edit creatives.

Run it on a private network, behind a VPN, an SSO proxy or an IP allowlist. Putting it on the
public internet with only its password in front is outside the model this repository defends. Use
a long random `ADMIN_PASSWORD` and a `DASHBOARD_SESSION_SECRET` that is not derived from it, and
serve it over TLS: the session cookie is a bearer token for the whole admin surface.

### Known limits (by design, for now)

- Rate limiting is a per-API-key token bucket in Postgres. It protects capacity per tenant; it is
  not a defence against a distributed flood, which belongs in front of the gateway.
- If the rate limiter's own store is unavailable the request is allowed through, deliberately: a
  degraded database must not become a full outage. The routes still fail closed on their own.
- There is no built-in WAF, bot detection or click-fraud scoring. Click events are recorded, not
  judged.

## Dependency audit

```bash
pnpm audit:prod          # pnpm audit --prod --audit-level=high, over runtime dependencies only
pnpm audit --prod        # the same, including low and moderate findings
```

`pnpm audit:prod` exits non-zero on a high or critical advisory in a runtime dependency, so it is
safe to run in CI. Development-only tooling (vitest, eslint, tsup, playwright) is excluded on
purpose: it never runs in a deployment.

For the Python SDK (`packages/sdk-python`, runtime dependencies `httpx` and `pydantic`):

```bash
python3 -m pip install pip-audit
pip-audit --strict -r <(python3 -c "print('httpx>=0.27\npydantic>=2.7')")
```

`pip-audit` is not vendored and is not part of `pnpm test`; run it before a PyPI release.

### Accepted findings

None. As of 2026-09-04, `pnpm audit --prod` reports no known vulnerabilities at any severity.

The only advisories seen so far were four in `postcss` (two high, two moderate: arbitrary `.map`
file disclosure via an attacker-controlled `sourceMappingURL`), reached transitively through
`next@15.5.25` in `packages/dashboard` and `examples/nextjs-chat`. They were fixed rather than
accepted, with a pnpm override in the root `package.json`:

```json
"pnpm": { "overrides": { "postcss@<8.5.23": "^8.5.23" } }
```

When a future advisory cannot be fixed by an upgrade, record it here with the package, the
advisory id, why it is accepted, and the exposure it leaves — an entry with no exposure paragraph
is not an accepted finding, it is an unread one.

## Hardening checklist for a deployment

- Serve the gateway over TLS, or terminate TLS in a proxy that sets `X-Forwarded-Proto` (HSTS
  follows that header).
- Set `CORS_ALLOWED_ORIGINS` to the exact browser origins that need it; leave it empty when no
  browser calls the gateway directly. `*` is honoured only when written out in full, and is a
  choice, not a default.
- Give the gateway its own Postgres role with rights on the adgate schema and nothing else.
- Keep `ADGATE_SIGNING_KEY_PEM`, `ADMIN_PASSWORD`, `DASHBOARD_SESSION_SECRET` and API keys in a
  secret store, never in the repository or an image layer.
- Ship the structured logs somewhere you can search by `req_id`. They carry ids, statuses and
  durations, never message content and never key material.
- Run `pnpm audit:prod` in CI, and run the retention job on a schedule so stored records do not
  outlive each app's `privacy.retain_days`:
  `pnpm --filter @adgate/gateway retention` (see `docs/privacy.md` for the crontab line, and use
  `--dry-run` first).
