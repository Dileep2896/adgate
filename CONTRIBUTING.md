# Contributing to adgate

Thanks for looking. adgate decides whether an ad may appear in a conversation turn and writes a
signed record proving what happened, so the bar for changes is a little unusual: **the contract
documents win over the code, and every behaviour is a test before it is an implementation.**

Read [README.md](README.md) first — its quickstart gets you a running gateway, a seeded catalog
and a chat example in about ten minutes. This file is what to know once it runs.

## Running the stack locally

```bash
pnpm install
pnpm build                                  # required on a fresh clone: packages import dist/
docker compose up -d postgres               # Postgres 16, databases adgate and adgate_test
cp .env.example .env
pnpm --silent --filter @adgate/gateway keygen >> .env
pnpm db:migrate
```

Then, in separate terminals:

```bash
pnpm --filter @adgate/gateway dev           # :8787
pnpm --filter @adgate/dashboard dev         # :3000  (DASHBOARD_PORT to move it)
pnpm --filter nextjs-chat dev               # :3001  (PORT, set in the shell, to move it)
```

`.env.example` is the canonical list of every environment variable, one comment line per
variable. **When you add a variable, add it there** (and to the CI job env if a test needs it).

If a native Postgres already owns 5432, set `PGPORT_HOST` and use that port in both
`DATABASE_URL` and `DATABASE_URL_TEST`; the README has the details.

## The gates

All four must be green before anything is committed:

```bash
pnpm test          # vitest, every workspace package, through turbo
pnpm typecheck     # tsc --noEmit, strict, per package
pnpm lint          # eslint (flat config at the repo root)
pnpm format:check  # prettier
```

Prefix them with `CI=1` when running non-interactively: without it vitest's interactive reporter
can block on captured stdout and a 25-second suite looks like a hang.

`pnpm build` is also needed whenever you add a dependency between workspace packages or change a
package entry point, because turbo builds dependencies before `test` and `typecheck`.

## Test layout

| Suite | How to run | Needs |
| --- | --- | --- |
| Unit tests (all TS packages) | `pnpm test` | nothing — they never touch the network and always fake the LLM |
| Gateway and dashboard integration tests | `pnpm test` | docker Postgres, and `DATABASE_URL_TEST` in `.env` |
| Dashboard end-to-end (Playwright) | `pnpm exec playwright install chromium` once, then `pnpm --filter @adgate/dashboard test:e2e` | docker Postgres. Deliberately **not** part of `pnpm test` |
| Python SDK | `cd packages/sdk-python && pip install -e ".[dev]" && ruff check . && mypy && pytest` | nothing (respx fakes the gateway). Not a pnpm package, so `pnpm test` never sees it |
| FastAPI example | `cd examples/fastapi-chat && pip install -e ../../packages/sdk-python && pip install -e ".[dev]" && ruff check . && pytest` | nothing, same reason |

Integration test files read `DATABASE_URL_TEST` (whose database name must contain `test`), apply
the migrations and truncate every table between tests. They must never assume the compose init
script ran, and never depend on any local service other than that Postgres.

CI (`.github/workflows/ci.yml`) runs three jobs: the pnpm workspace against a Postgres 16 service
container, the Python SDK, and the FastAPI example.

## Conventions that matter

These come from [CLAUDE.md](CLAUDE.md), which is the full list.

- **Tests first.** A failing test, then the implementation. No stubs and no `TODO` left for later.
- **Fail closed.** Any error, timeout or low-confidence result returns `decision: "suppress"`.
  The gateway never throws to the caller, and `/v1/evaluate` never answers 5xx.
- **Ads never render inside model output.** Separate block, after the answer, always labelled.
  The SDK refuses to render inline and the example asserts it against the real DOM.
- **Zod schema first.** Derive TypeScript types with `z.infer`. Never hand-write a duplicate type
  next to a schema.
- **Pure logic lives in `packages/core`** — no HTTP, no database, no `process.env`, no network.
  `packages/gateway` only wires. Several packages have a `purity.test.ts` that pins the import
  graph; if you add a file there, add it to that list.
- **Named exports only** inside `packages/*/src` (ESLint enforces it). Next.js pages, layouts and
  tool config files are the documented exceptions.
- **Files under 300 lines.** Split by responsibility rather than growing a module.
- **Never log or persist message content** unless the effective policy sets
  `privacy.store_raw_text`. Store hashes and categories. Structured pino logs only.
- IDs are prefixed ULIDs (`app_`, `cr_`, `aud_`, `ev_`, `key_`, `adv_`); timestamps are ISO 8601
  UTC strings in JSON and `timestamptz` in Postgres.
- Relative imports inside `src` carry the `.js` extension (TypeScript NodeNext ESM).
- New dependencies beyond the stack list in CLAUDE.md need a reason written down in
  `progress.txt`. Prefer well-known, actively maintained packages.

## The contract documents

`docs/api.md`, `docs/policy.md` and `docs/audit.md` are **the contract**. `packages/schemas`
implements them exactly, and several tests read the JSON examples out of those files at test
time so a documentation edit fails the build rather than drifting from it.

They change only by an explicit human decision, recorded in `progress.txt`. If a change seems to
require editing one of them, stop and raise it instead — that is a design discussion, not a
patch. Everything else under `docs/` (`integration.md`, `privacy.md`, `performance.md`,
`architecture.md`, `decisions.md`) is ordinary documentation you are welcome to improve.

`docs/integration.md` is executable: its `ts`/`tsx` blocks are typechecked by
`packages/sdk/src/docs-snippets.test.ts` in `pnpm test`, and its `python` blocks are compiled by
`packages/sdk-python/tests/test_docs_snippets.py` in CI. A change to an SDK's public surface that
breaks a snippet fails the build — fix the document in the same commit.

## Generated files

Four things in the tree are generated and guarded by a test that fails when they go stale. Never
hand-edit them; run the generator and commit the result.

| What | Regenerate with | Guarded by |
| --- | --- | --- |
| `packages/schemas/json/*.schema.json` | `pnpm --filter @adgate/schemas gen:json` | `packages/schemas/src/json-schema.test.ts` |
| `docs/api-reference.md` | `pnpm docs:api` | `packages/gateway/src/openapi/reference.test.ts` |
| `packages/sdk-python/src/adgate/models.py` | `cd packages/sdk-python && python -m scripts.generate_models` | `tests/test_models_generated.py`, and a `git diff --exit-code` step in CI |
| `packages/gateway/drizzle/*.sql` + `meta/` | `pnpm --filter @adgate/gateway db:generate --name <change>` | the migration count in `db/migrate.integration.test.ts` |

A change to a contract schema usually touches three of those in one commit: the JSON Schema
files, `docs/api-reference.md` (the OpenAPI document is built from the same schemas), and the
Python models.

## Adding a migration

1. Edit the Drizzle table modules under `packages/gateway/src/db/tables/`. Those modules may
   import `@adgate/schemas` **as types only** — drizzle-kit loads them through a CJS hook that
   cannot resolve the ESM-only workspace packages, so `CHECK` lists are local tuples that
   `db/schema.test.ts` pins against the schema enums.
2. `pnpm --filter @adgate/gateway db:generate --name <short_change_name>` (no database needed).
3. Commit the generated `.sql` and the `meta/` snapshot exactly as written.
4. `pnpm db:migrate` to apply it locally. Migrations are tracked, so re-running is a no-op.

A **new table** moves three tests — `db/schema.test.ts`'s `TABLE_NAMES`, the table count in
`src/index.test.ts`, and the applied-migration count in `db/migrate.integration.test.ts` — and it
belongs in `docs/privacy.md`, which is the data inventory. A stale inventory is worse than none.

## Commits and pull requests

- One logical change per commit. Conventional-commit subjects: `feat(scope): …`, `fix(scope): …`,
  `docs(scope): …`, `chore(scope): …`, `test(scope): …`. Stories built by the autonomous loop use
  the story id as the scope (`feat(S39): docs and quickstart`).
- The subject line is imperative and under ~72 characters; the body says _why_, not _what_.
- Never commit `.env`, a private key, an API key or any other secret. `.env` and `.env.*` are git
  ignored (except the `.example` files).
- A pull request should state which acceptance criteria or issue it satisfies, list any new
  dependency and why, and show that all four gates are green.
- Security issues do **not** go in a public issue or pull request. See [SECURITY.md](SECURITY.md).

## Releasing

<!-- TODO(S40): the release pipeline — changesets, the GitHub Actions publish jobs for
     @adgate/sdk, @adgate/schemas and the `adgate` PyPI package, and the gateway image on GHCR —
     lands with story S40. The flow below is the intended shape; S40 confirms or corrects it. -->

Versioning is by [changesets](https://github.com/changesets/changesets). A change to a published
package (`@adgate/sdk`, `@adgate/schemas`, `packages/sdk-python`) needs a changeset in the same
pull request.

```bash
pnpm changeset                 # describe the change and pick the version bumps
pnpm changeset version         # applies the bumps and writes CHANGELOG.md
git commit -am "chore: release v0.1.0"
git tag v0.1.0
git push --follow-tags         # the tag is what triggers the publish workflows
```

Before tagging: `pnpm audit:prod`, all four gates green, the Playwright suite green, and the
Python suites green.
