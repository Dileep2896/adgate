# Bootstrap catalog

Twelve creative **templates** covering the categories the rules-only classifier reaches with
enough confidence to serve: databases, hosting, CI, observability, AI tooling, security and
productivity. Two per category so mediation has something to rank.

Load it into a gateway:

```bash
pnpm --filter @adgate/gateway seed-creatives --file examples/affiliate-catalog.seed.json
```

The script is idempotent, so re-running after an edit updates rather than duplicates. It also
prints, per app, how many of these twelve can actually serve for that app and why the rest
cannot. **Read that block.** Straight out of the box it will tell you that none of them can
serve yet, for the two reasons below.

## Before any of these can serve

A creative sitting in the catalog, `active: true`, matching the turn's category perfectly, still
serves nothing until two things are true of the **app** it should serve for. Neither is a bug and
neither shows up in the catalog: the only other evidence is one line inside the audit record's
`demand.responses` trace.

**1. The app needs your affiliate ids.** Affiliate links use the app owner's own accounts
(`docs/decisions.md` item 6), so an app whose `affiliate_config` is empty has no account to credit
and every affiliate demand adapter answers `affiliate_not_configured`. Set the ids for each
network you use:

```json
{
  "partnerstack": { "program_id": "your-partnerstack-key" },
  "impact": { "program_id": "your-impact-program-id" }
}
```

**2. The creative's `network` must be an enabled affiliate entry in the app's policy.** The policy
`demand` list decides which sources are queried at all, and each affiliate entry names exactly one
network. The default list enables a single one, `partnerstack`, so the four creatives in this file
on the `impact` network are never queried — they are not rejected, they are never asked for. Four
of twelve, silently, at zero fill.

Add an entry per network you stock, in the app's policy:

```yaml
demand:
  - source: direct
    enabled: true
  - source: affiliate
    network: partnerstack
    enabled: true
  # Without this entry the four impact creatives in this file are never queried.
  - source: affiliate
    network: impact
    enabled: true
  - source: koah
    enabled: false
  - source: gravity
    enabled: false
```

A creative with no `network` field belongs to whichever network the policy's affiliate entry
names, so it works under any single-network policy.

To see exactly where you stand, per app and per creative:

```bash
pnpm --filter @adgate/gateway check-catalog
pnpm --filter @adgate/gateway check-catalog --app app_01H...
```

It prints `yes`/`no` per creative with the first blocking reason, never writes anything and always
exits 0.

## These are templates, not live ads

Every `advertiser`, `advertiser_domain` and `url_template` here points at `*.example`, a reserved
domain that resolves nowhere. **Nothing in this file is a real partner, and no creative here should
be served to real users as written.** They exist so you can measure fill rate before you have a
single affiliate account.

To make one real, replace four fields with the details from a program you have actually joined:

| Field | Replace with |
| --- | --- |
| `advertiser` | the partner's real name |
| `advertiser_domain` | their real domain, used for competitor exclusions |
| `url_template` | their affiliate link, keeping the `{{program_id}}` or `{{tag}}` placeholder |
| `network` | `partnerstack`, `impact` or `amazon` — and it must be an enabled affiliate entry in the app's policy `demand` list, see above |

Then put your own account identifiers in the app's `affiliate_config`. The dashboard has a form
for it — **the app's page, "Affiliate accounts"** — or set the column directly if you are
scripting. The gateway fills the placeholder at click time, so the commission is attributed to you
and never to this file. Until a network has an entry, its adapter answers
`affiliate_not_configured` and every eligible turn ends in `no_fill`.

Leave `target_categories` and `keywords` alone unless you know the taxonomy. They are aligned with
the terms the rules classifier actually matches, in
`packages/core/src/classify/rules/data/commercial/`. A keyword the classifier never emits will
never contribute to a match.

## Writing copy that survives in an answer

A sponsored line sitting under a model's answer is judged against that answer. Promotional copy
reads as noise and trains people to skip the block.

- Say what the thing does, then one concrete fact. "A free tier that stays free" beats "the best
  developer experience".
- No superlatives, no invented statistics, no urgency.
- Keep the headline under about 50 characters so it does not wrap in a narrow chat column.
- Write the body as one sentence a developer would accept from a colleague.

## eCPM here is a guess

The `ecpm` values are placeholders used only for ranking, since mediation sorts by eCPM multiplied
by how well the creative matched. Replace them with the real effective rate once a program reports
one. Until then they only decide which of two matching creatives wins, not what you earn.
