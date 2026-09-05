# adgate privacy: what is stored, and for how long

This document is a complete inventory of everything adgate persists, why each field exists,
whether it can contain data derived from an end user, and when it is deleted. It is descriptive,
not a contract: `docs/api.md`, `docs/policy.md` and `docs/audit.md` are the contract, and nothing
here changes their meaning. Where the two ever disagree, they are right and this is a bug.

Two claims sit above the table and are enforced by tests:

1. **Raw conversation text is stored only when `policy.privacy.store_raw_text` is true, only in
   the `raw_text` table, and only keyed by `audit_id`.** It is never inside the signed audit
   record, never in a log line, never in an event, never in the classifier cache.
   `packages/gateway/src/evaluate/evaluate-privacy.integration.test.ts` runs the gateway over a
   serve, a suppression and a low-intent turn and then searches *every text, varchar, json and
   jsonb column of every table in the database* — the column list comes from
   `information_schema`, not from a hand-written list — for the message text, words out of it,
   the raw conversation id and the raw user id. Under the default policy the answer must be
   "nowhere". With `store_raw_text: true` the answer must be exactly `raw_text.text`.
2. **`store_raw_text` cannot be turned on by a request.** `policy_overrides` may only tighten a
   policy (docs/policy.md), so an integrator cannot make the gateway start keeping text by
   sending a flag; the stored policy is the only place that decides.

---

## Hashing

Every identifier that could point back at a person is hashed with the app's own salt before it
reaches any column.

- `apps.salt` is 32 random bytes, hex encoded, minted per app when the app is registered
  (`packages/gateway/src/apps/register-app.ts`). It is never sent anywhere, never logged, and
  never appears in an audit record.
- `conversation_id_hash = sha256(app_salt + conversation_id)`, written as `sha256:<hex>`. Because
  the salt is per app, the same conversation id under two apps produces two unrelated hashes, and
  nobody holding the database without the salt can confirm a guessed id.
- `user_hash` follows the same rule with one documented exception: a value the app already sent
  as a 64 character hex digest is normalised to `sha256:<lowercase hex>` and **not** hashed again.
  That is deliberate — per-user frequency caps have to key on one stable value, and an app that
  hashes its own user ids should not be forced to hand adgate the raw one. Anything else (a bare
  user id, an email) is salted and hashed exactly like a conversation id, so a raw user id is
  never stored. `null`, `undefined` and the empty string stay `null`.
- Both live in `packages/core/src/audit/privacy-hash.ts`.

`turn_id` is the exception to all of this: `docs/audit.md` puts it in the signed record verbatim,
so it is stored as sent. Keep it opaque (`turn_7`), never a subject line or a user identifier.

---

## Every stored field

Legend for **User-derived**: **no** = never contains anything traceable to an end user;
**hashed** = derived from user data but only as a salted one-way digest; **yes** = can contain
user-derived content in the clear.

### `apps` — one row per tenant

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `id` | `app_` ULID, the tenant key | no | until the app is deleted |
| `name` | display name the operator chose | no | until the app is deleted |
| `salt` | per-app hash salt (above); a secret | no | until the app is deleted |
| `policy_yaml` | the stored policy as written (docs/policy.md) | no | until the app is deleted |
| `policy_hash` | hash of the fully defaulted policy, written into every record | no | until the app is deleted |
| `policy_version` | policy revision counter | no | until the app is deleted |
| `affiliate_config` | the app owner's PUBLIC affiliate ids; never credentials | no | until the app is deleted |
| `created_at`, `updated_at` | audit of the row itself | no | until the app is deleted |

### `api_keys` — credentials

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `id` | `key_` ULID | no | kept after revocation (`revoked_at` set) |
| `app_id` | owning tenant | no | as above |
| `key_prefix` | public lookup handle of `ak_<prefix>_<secret>` | no | as above |
| `hashed_key` | argon2id of the secret; the secret itself is never stored | no | as above |
| `role` | `app` or `advertiser_read` | no | as above |
| `advertiser_id` | the advertiser an `advertiser_read` key may read | no | as above |
| `created_at`, `revoked_at`, `last_used_at` | issue, revocation and last use | no | as above |

Revocation sets `revoked_at`; the row stays, so "who could have called this" remains answerable.

### `audit_records` — the signed log (one row per `/v1/evaluate` call, plus one per attestation)

The signed document is in `record` (jsonb). The other columns are indexed copies of fields inside
it and must never be edited on their own — `record_hash` does not cover them, so an edit there is
a silent lie the verifier cannot catch.

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `record_hash` | primary key; the record's own hash | no | `privacy.retain_days` |
| `id` | `aud_` ULID; the id the app and the click URL carry | no | `privacy.retain_days` |
| `app_id` | owning tenant | no | `privacy.retain_days` |
| `seq` | position in the app's hash chain | no | `privacy.retain_days` |
| `prev_hash`, `supersedes_hash` | chain and attestation links | no | `privacy.retain_days` |
| `is_latest` | which version of an id the API serves | no | `privacy.retain_days` |
| `decision`, `reason` | copies of the signed decision | no | `privacy.retain_days` |
| `creative_id`, `advertiser_id` | copies for lookups and reports | no | `privacy.retain_days` |
| `ts` | when the evaluation happened | no | `privacy.retain_days` |
| `attest_rendered` | whether the SDK reported the slot rendered | no | `privacy.retain_days` |
| `created_at` | when the row was written | no | `privacy.retain_days` |
| `record` | **the signed AuditRecord** — see below | hashed | `privacy.retain_days` |

Inside `record` (docs/audit.md is the authority):

| Field | Purpose | User-derived |
| --- | --- | --- |
| `conversation_id_hash` | frequency caps and joining a conversation's turns | hashed |
| `user_hash` | per-user daily caps; `null` when the app sent no user id | hashed |
| `turn_id` | the app's own turn label, stored as sent | yes, if the app puts data in it |
| `ts`, `surface` | when and where the turn happened | no |
| `classification` | commercial intent, taxonomy categories, sensitive flags, confidence, method, prompt version | derived from the message, but **categories from a fixed taxonomy only** — never phrases from the text |
| `policy_version`, `policy_hash`, `policy_decisions`, `override_rejected` | which policy ran and what each rule said | no |
| `decision`, `reason` | the outcome | no |
| `demand` | which sources were asked, how many candidates, latencies, exclusions | no |
| `creative` | the ad served: id, advertiser, domain, content hash | no |
| `disclosure` | the label, position and style shown | no |
| `model_output_hash` | hash of the assistant's answer at attestation; never the answer | hashed |
| `separation_attestation`, `attested_at`, `supersedes_hash` | the attestation | no |
| `prev_hash`, `record_hash`, `signature`, `key_id` | the chain and its signature | no |

The classification is the one place where an inference about the conversation is kept. It holds
scores and taxonomy identifiers (`software.devtools.database`, `health`), never a phrase lifted
from the message: the rules classifier's matched terms are dictionary entries and are stripped
before anything is persisted.

### `raw_text` — conversation text, only when the policy says so

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `audit_id` | the turn the text belongs to | no | `privacy.retain_days` |
| `app_id` | owning tenant | no | `privacy.retain_days` |
| `text` | **the prepared conversation text** | **yes** | `privacy.retain_days` |
| `created_at` | when it was written | no | `privacy.retain_days` |

A row exists **only** when the app's stored policy has `privacy.store_raw_text: true`. What is
stored is the prepared text the classifier saw: the last four user and assistant messages as
`role: content` lines, truncated to 4 000 code points. System and tool messages are dropped
before that. Turning `store_raw_text` off stops new rows immediately; it does not delete the old
ones — run the retention job, or delete them yourself.

### `events` — impressions, clicks, dismissals, conversions

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `id` | `ev_` ULID | no | with its audit record |
| `audit_id` | the turn the event belongs to | no | with its audit record |
| `app_id` | owning tenant | no | with its audit record |
| `type` | `impression`, `click`, `dismiss`, `conversion` | no | with its audit record |
| `ts` | when it happened | no | with its audit record |
| `meta` | free-form jsonb the caller sends, capped at 4 096 bytes serialized | **yes, if the caller puts data in it** | with its audit record |
| `created_at` | when the row was written | no | with its audit record |

`meta` is the one field an integrator can fill with anything. adgate never reads inside it, never
logs it, and never puts it in a record — but it is stored as sent, so do not put message text,
email addresses or raw user ids in it.

### `cap_state` and `user_day_caps` — frequency cap counters

| Table.field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `cap_state.app_id` | owning tenant | no | until overwritten (see below) |
| `cap_state.conversation_hash` | the salted conversation hash | hashed | until overwritten |
| `cap_state.user_hash` | the user hash seen on this conversation | hashed | until overwritten |
| `cap_state.session_count`, `.turn_count`, `.last_turn_index` | the counters the policy engine reads | no | until overwritten |
| `cap_state.updated_at` | last turn on this conversation | no | until overwritten |
| `user_day_caps.app_id` | owning tenant | no | until overwritten |
| `user_day_caps.user_hash` | the salted user hash | hashed | until overwritten |
| `user_day_caps.day` | the UTC calendar day | no | until overwritten |
| `user_day_caps.count` | ads served to that user that day | no | until overwritten |
| `user_day_caps.updated_at` | last update | no | until overwritten |

These hold no text and no raw identifiers, so the retention job leaves them alone. They are
counters keyed by hash: a `cap_state` row is rewritten on every turn of its conversation, and a
`user_day_caps` row is one integer per (app, user hash, day). If you want them gone, delete rows
older than your window directly; nothing reads a `user_day_caps` row for a past day.

### `classify_cache` — the shared classifier cache

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `hash` | the cache key | hashed | 10 minutes (`expires_at`) |
| `classification` | the Classification the key resolved to | derived; taxonomy values only | 10 minutes |
| `expires_at` | when the row stops being served | no | — |

The key is `sha256` of the normalised prepared text joined with the classifier prompt version,
the rules version and the two policy knobs that change the answer (`sensitive_detection`,
`min_confidence`). It is a one-way digest, but be clear-eyed about what it is: a stable
fingerprint of the text. It is **not** salted per app, on purpose — the whole value of the cache
is that two apps asking the same question share one classification — so an attacker holding the
database can test a guessed conversation against it. It cannot be reversed, it carries no ids
that link it back to an app, a conversation or a user, and rows stop being served after ten
minutes. Expired rows are ignored on read and overwritten by the next write of the same key, but
nothing deletes them: the retention job does not touch this table, because a row here belongs to
no app and has no window of its own. If that matters to you, `delete from classify_cache where
expires_at < now()` is safe to run at any time — a deleted row is a cache miss, nothing more.

### `advertisers`, `creatives`, `reports` — the catalog and its output

None of these tables can contain user-derived data. `advertisers` holds a name and a domain;
`creatives` holds the ad copy an operator typed in plus its targeting, price and content hash;
`reports` holds a generated verification report (aggregate counts and check results over one
advertiser's records for one period, plus the audit ids and record hashes of failing records —
never a conversation). Nothing is ever deleted from `advertisers` or `creatives`: a creative is
retired by flipping `creatives.active` to false, because audit records name the row forever.
`reports` is append only.

### `rate_limits` — token buckets

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `key_id` | the API key id the bucket belongs to | no | until overwritten |
| `tokens` | the balance after the last request | no | until overwritten |
| `updated_at` | when the balance was computed | no | until overwritten |

One row per API key, rewritten on every request. No conversation data, no user data.

### `retention_state` — what the retention job deleted

| Field | Purpose | User-derived | Retention |
| --- | --- | --- | --- |
| `app_id` | the app the watermark is for | no | until the app is deleted |
| `pruned_before` | the cutoff applied: every record older than this was deleted | no | until the app is deleted |
| `pruned_through_seq` | the highest chain position deleted | no | until the app is deleted |
| `updated_at` | when the job last pruned this app | no | until the app is deleted |

Two numbers per app, so that verification can tell a chain shortened by policy from a chain
somebody tampered with. See "Retention and the hash chain" below.

---

## What the click redirect logs

`GET /c/:audit_id` is the URL every creative points at. It is public — the audit id is an
unguessable ULID and is itself the capability, so no API key is read — and it is the only adgate
endpoint an end user's browser ever touches directly.

For each click it:

- resolves the destination from the creative and the app's affiliate config, and refuses
  (404) anything that is not an absolute `http(s)` URL;
- writes one `events` row: `type: 'click'`, the audit id, the app id, the timestamp, and an
  **empty** `meta`;
- writes one structured log line — `{ audit_id, app_id, source, via }` plus the request id — where
  `source` is the demand source and `via` is the affiliate network or `direct`;
- answers `302` with `Cache-Control: no-store` (a cached redirect would skip the event) and
  `Referrer-Policy: no-referrer`, so the destination never learns the gateway URL and therefore
  never learns the audit id.

What it does **not** do: it stores no IP address, no `User-Agent`, no cookie, no referrer, and no
click id of its own. There is no per-user click profile in adgate, because there is nothing to
build one from.

The same is true of logging generally (`packages/gateway/src/logger.ts`): request lines carry
method, path, status and duration; every log line passes through a redactor that replaces the
value of any key named `messages`, `context_summary`, `authorization`, `cookie`, `api_key`,
`password`, `private_pem` or `hashed_key` at any depth, so no call site can leak conversation text
or a bearer token by accident. Request bodies are never logged at all.

---

## Retention

Each app's window is `privacy.retain_days` in its own policy (docs/policy.md; the default is 90).
The window is enforced by a job you run — nothing expires on its own:

```
pnpm --filter @adgate/gateway retention [--dry-run] [--app <app_id>] [--now <iso 8601>]
```

For every app it reads that app's stored policy, computes `cutoff = now - retain_days`, and
deletes from the **oldest end of the app's audit chain only**: every `audit_records` row up to
the last chain position whose whole prefix predates the cutoff, plus the `events` and `raw_text`
rows of the audit ids that lost their last record. Then it writes the app's `retention_state`
watermark. All of that for one app happens in a single transaction.

- **An app whose stored policy no longer parses is skipped**, with an error log naming the app
  and the error class, and the run continues with the other apps. The job never deletes under a
  policy it could not read: the window is a promise the operator made, and guessing at it could
  destroy records nobody authorised deleting. The process exits 1 when any app was skipped or
  failed, so cron does not swallow it.
- **`--dry-run` changes nothing.** It does the identical work inside a transaction and rolls it
  back, so the counts it prints are the counts a real run would produce, not an estimate.
- **Running it twice is a no-op.** The second run finds nothing older than the cutoff and writes
  nothing.
- It logs one structured line per app — app id, retain days, cutoff, chain position, and row
  counts. Counts only, never content.

### Cron

Once a day is plenty. The job connects to `DATABASE_URL` (from the environment or the repo-root
`.env`) exactly like the other gateway scripts:

```cron
# adgate retention: every day at 03:17 UTC
17 3 * * * cd /srv/adgate && /usr/bin/env DATABASE_URL="$DATABASE_URL" pnpm --filter @adgate/gateway retention >> /var/log/adgate-retention.log 2>&1
```

In a container image, `node dist/scripts/retention.js` is the same entry without pnpm or tsx.

Before the first real run on a database that matters, do the dry run:

```
pnpm --filter @adgate/gateway retention --dry-run
```

### Retention and the hash chain

Audit records for an app form a hash chain, and verification checks each record against the
record at chain position `seq - 1`. Deleting a record therefore takes the predecessor away from
the record above it. Two decisions keep that honest.

**Deletion is a prefix, never a predicate.** The job deletes `seq <= n`, not `ts < cutoff`. A
timestamp predicate is free to punch a hole anywhere in the chain, and every record after such a
hole would fail `previous record missing` forever — the log would become unusable exactly where
it still exists. A prefix can only shorten the chain from the oldest end: at most one surviving
record has a missing predecessor. `n` is bounded by the *first* row at or after the cutoff, not
by the last row before it, because an attestation copies the timestamp of the record it attests
onto a row at the top of the chain — so seq order and ts order are not the same order, and taking
the highest seq with an old timestamp could delete records the cutoff says to keep. The job
over-retains a little rather than over-delete, which is the only direction it may err in.

**The watermark explains the one gap, and only that gap.** `retention_state` records how far the
job got (`pruned_through_seq`) and under which cutoff (`pruned_before`). When verification finds
no record at `seq - 1`, it reports `chain` as **ok, detail `pruned`** if and only if that position
is at or below the watermark *and* the record being verified post-dates the cutoff. A record
missing anywhere above the watermark, or in an app the job has never touched, still fails
`previous record missing` — which is exactly what a deletion the job did not make must look like.
This runs in one place, `packages/gateway/src/audit-api/verify-context.ts`, so `GET /v1/verify/:id`,
the dashboard's `/audit/[id]` page and a generated verification report all say the same thing.

If your compliance story needs the chain to stay complete for longer than your text retention,
raise `retain_days` and delete `raw_text` on its own schedule instead: the records are hashes and
taxonomy identifiers, the text is the sensitive part.

---

## Deleting one app or one user

adgate has no "delete this user" endpoint, and the shape of the data is why.

- **A user.** Everything about a person is a salted one-way hash, so the gateway cannot find
  their rows from a raw user id — and neither can anyone else who takes the database. If you must
  erase a specific person, compute `sha256(apps.salt + user_id)` yourself and delete the matching
  `cap_state` and `user_day_caps` rows. The audit records cannot be selectively deleted without
  breaking the chain; let them age out under `retain_days`, or accept that what remains is a hash
  that no longer resolves to anybody.
- **An app.** Delete its `raw_text`, `events`, `audit_records`, `cap_state`, `user_day_caps` and
  `retention_state` rows, then its `api_keys` and the `apps` row. Deleting the `apps` row destroys
  the salt, which makes every remaining hash of that app permanently unresolvable.

---

## Where the guarantees live in code

| Claim | Enforced by |
| --- | --- |
| No raw text anywhere unless `store_raw_text` | `packages/gateway/src/evaluate/evaluate-privacy.integration.test.ts` (scans every textual column of every table) |
| `store_raw_text` cannot be turned on by a request | the same file; `mergeOverrides` in `packages/core/src/policy/merge.ts` |
| Ids are salted and hashed | `packages/core/src/audit/privacy-hash.ts` and its tests |
| Logs never carry text or secrets | `redactSensitive` in `packages/gateway/src/logger.ts` and `logger.test.ts` |
| Retention deletes only the oldest end | `packages/gateway/src/retention/` and `retention.integration.test.ts` |
| A pruned chain verifies as `pruned`, a tampered one does not | `retention-chain.integration.test.ts` and `packages/dashboard/lib/retention-verify.integration.test.ts` |
