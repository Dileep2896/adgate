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
pnpm --silent --filter @adgateio/gateway keygen >> .env
pnpm db:migrate
```

Then, in separate terminals:

```bash
pnpm --filter @adgateio/gateway dev           # :8787
pnpm --filter @adgateio/dashboard dev         # :3000  (DASHBOARD_PORT to move it)
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
| Dashboard end-to-end (Playwright) | `pnpm exec playwright install chromium` once, then `pnpm --filter @adgateio/dashboard test:e2e` | docker Postgres. Deliberately **not** part of `pnpm test` |
| Python SDK | `cd packages/sdk-python && pip install -e ".[dev]" && ruff check . && mypy && pytest` | nothing (respx fakes the gateway). Not a pnpm package, so `pnpm test` never sees it |
| FastAPI example | `cd examples/fastapi-chat && pip install -e ../../packages/sdk-python && pip install -e ".[dev]" && ruff check . && pytest` | nothing, same reason |

Integration test files read `DATABASE_URL_TEST` (whose database name must contain `test`), apply
the migrations and truncate every table between tests. They must never assume the compose init
script ran, and never depend on any local service other than that Postgres.

They also open their database handle with `createTestDb` from
`packages/gateway/src/db/test-support.ts` (`testStatementTimeoutMs()` from `lib/db.ts` in the
dashboard), never with `createDb`. The deployed gateway runs on a 2 s `statement_timeout` so a
wedged connection fails closed; a loaded CI runner is slow enough to trip that on a healthy query,
so tests get 15 s instead. `DB_STATEMENT_TIMEOUT_MS` and `DB_LOCK_TIMEOUT_MS` override it, and
`packages/gateway/src/db/create-db-usage.test.ts` fails the build if a test goes back to `createDb`.

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
`deploy.md`, `architecture.md`, `decisions.md`) is ordinary documentation you are welcome to
improve.

`docs/deploy.md` is the hosted-deployment walkthrough: managed Postgres, the gateway container,
the dashboard on Vercel, and the complete environment table for both. A change that adds an
environment variable or moves a production boot check belongs there as well as in
`.env.example` — the table is what an operator reads before a first deploy.

`docs/integration.md` is executable: its `ts`/`tsx` blocks are typechecked by
`packages/sdk/src/docs-snippets.test.ts` in `pnpm test`, and its `python` blocks are compiled by
`packages/sdk-python/tests/test_docs_snippets.py` in CI. A change to an SDK's public surface that
breaks a snippet fails the build — fix the document in the same commit.

## Generated files

Four things in the tree are generated and guarded by a test that fails when they go stale. Never
hand-edit them; run the generator and commit the result.

| What | Regenerate with | Guarded by |
| --- | --- | --- |
| `packages/schemas/json/*.schema.json` | `pnpm --filter @adgateio/schemas gen:json` | `packages/schemas/src/json-schema.test.ts` |
| `docs/api-reference.md` | `pnpm docs:api` | `packages/gateway/src/openapi/reference.test.ts` |
| `packages/sdk-python/src/adgate/models.py` | `cd packages/sdk-python && python -m scripts.generate_models` | `tests/test_models_generated.py`, and a `git diff --exit-code` step in CI |
| `packages/gateway/drizzle/*.sql` + `meta/` | `pnpm --filter @adgateio/gateway db:generate --name <change>` | the migration count in `db/migrate.integration.test.ts` |

A change to a contract schema usually touches three of those in one commit: the JSON Schema
files, `docs/api-reference.md` (the OpenAPI document is built from the same schemas), and the
Python models.

## Adding a migration

1. Edit the Drizzle table modules under `packages/gateway/src/db/tables/`. Those modules may
   import `@adgateio/schemas` **as types only** — drizzle-kit loads them through a CJS hook that
   cannot resolve the ESM-only workspace packages, so `CHECK` lists are local tuples that
   `db/schema.test.ts` pins against the schema enums.
2. `pnpm --filter @adgateio/gateway db:generate --name <short_change_name>` (no database needed).
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

**Nothing has been published yet.** The pipeline below is built and exercised, but no version of
any artefact is on npm, PyPI or GHCR, and `.github/workflows/release.yml` has never run on
GitHub: this repository has no remote. The first real release is a human decision (see
"What a human must do once", below).

### What is published, and what is not

| Artefact | Where | Versioned by |
| --- | --- | --- |
| `@adgateio/schemas` | npm, public | changesets |
| `@adgateio/sdk` | npm, public | changesets |
| `adgate` | PyPI | `packages/sdk-python/pyproject.toml`, by hand |
| the gateway image | `ghcr.io/<owner>/<repo>/gateway` | the git tag |

`@adgateio/core`, `@adgateio/gateway`, `@adgateio/dashboard` and the examples are `"private": true`
and are never published. `@adgateio/core` is deliberately one of them: only the gateway and the
dashboard import it, and `@adgateio/sdk` does not — the SDK's one runtime dependency is
`@adgateio/schemas`, which is why that package has to be public. `pnpm publish -r` skips every
private package on its own, and they are also listed in `.changeset/config.json`'s `ignore`.

### Adding a changeset

A change to `@adgateio/schemas` or `@adgateio/sdk` needs a changeset in the same pull request:

```bash
pnpm changeset      # pick the packages, pick major/minor/patch, write the entry for the changelog
```

That writes a small markdown file under `.changeset/`. Commit it. It is not a release; it is a
note saying what the next release should do. Changes that touch only private packages need none.
A change to the Python SDK needs no changeset either — see the version bump below.

### Cutting a release

```bash
pnpm run version               # changeset version + pnpm install --lockfile-only
```

`pnpm run version` consumes every changeset file, bumps the versions, writes each package's
`CHANGELOG.md`, and refreshes the lockfile. Use the root script, not `changeset version` on its
own: the lockfile has to be rewritten in the same commit or CI's `--frozen-lockfile` install
fails. Workspace dependencies stay `workspace:*` in the repository; pnpm rewrites them to the
real version (`"@adgateio/schemas": "0.1.0"`) inside the published tarball.

Then bring the Python package to the same version by hand — changesets does not know about it:

```bash
# packages/sdk-python/pyproject.toml   version = "0.1.0"
# packages/sdk-python/src/adgate/__init__.py   __version__ = "0.1.0"
```

`tests/test_version.py` fails if those two disagree, and the release workflow fails if either
disagrees with the tag.

Before tagging: `pnpm audit:prod`, all four gates green, the Playwright suite green, the Python
suites green, and the local dry runs below.

```bash
git commit -am "chore: release v0.1.0"
git tag v0.1.0
git push --follow-tags         # the tag is what triggers .github/workflows/release.yml
```

### The release workflow

`.github/workflows/release.yml` runs on any `v*` tag and has three independent jobs:

| Job | Does | Needs |
| --- | --- | --- |
| `npm` | install, build, `pnpm publish -r` | `NPM_TOKEN` |
| `pypi` | `python -m build`, `twine check`, `twine upload` | `PYPI_API_TOKEN` |
| `image` | `docker build` from `packages/gateway/Dockerfile`, push to GHCR | nothing (`GITHUB_TOKEN` with `packages: write`) |

Each job first checks the tag against the version in the repository and fails rather than
publishing a mismatch. Publishing an already published version is skipped, so re-running a
partially failed release is safe.

The same workflow can be run by hand from the Actions tab (**Release → Run workflow**) with the
`dry_run` input, which **defaults to true**. In that mode every job does all of its real work
and stops one step short: `pnpm publish --dry-run`, `twine check` without `twine upload`, and
`docker build` with `push: false`. No secrets are involved, so a fork or a repository with no
tokens can still exercise the whole pipeline.

### Running the dry runs locally

These are the exact commands the dry-run path runs:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm publish -r --dry-run --no-git-checks         # prints one tarball per public package

cd packages/sdk-python
pip install build twine
python -m build                                   # dist/adgate-<version>{.tar.gz,-py3-none-any.whl}
twine check dist/*
cd ../..

docker build -f packages/gateway/Dockerfile -t adgate-gateway:dev .
```

The image is built from the repo root, not from `packages/gateway`: the gateway imports its
workspace siblings, so the whole workspace is the build context (`.dockerignore` trims it). To
run it against the compose Postgres:

```bash
docker run --rm -p 8787:8787 \
  -e DATABASE_URL='postgres://adgate:adgate@host.docker.internal:5433/adgate' \
  -e ADGATE_SIGNING_KEY_ID=k_2026_09 \
  -e ADGATE_SIGNING_KEY_PEM="$(grep '^ADGATE_SIGNING_KEY_PEM=' .env | cut -d= -f2- | tr -d '"')" \
  adgate-gateway:dev
curl -s localhost:8787/healthz     # {"ok":true}
```

Two things bite here. `docker --env-file` does **not** strip the quotes around a value, so
passing `.env` straight in hands the gateway a PEM that starts with `"` and it exits 1; pass the
signing key with `-e` as above. And `localhost` inside the container is the container, so the
host Postgres is `host.docker.internal` — on this repository's dev machine on port 5433, on a
fresh clone 5432. The image runs the server only; apply migrations from a checkout with
`pnpm db:migrate`.

### What a human must do once

1. Create the npm organisation `@adgateio` and add a granular access token with publish rights for
   `@adgateio/schemas` and `@adgateio/sdk` as the repository secret `NPM_TOKEN`.
2. Claim the `adgate` name on PyPI and add a project-scoped API token as the repository secret
   `PYPI_API_TOKEN`.
3. Nothing for GHCR: the image is pushed with the built-in `GITHUB_TOKEN`. After the first push,
   set the package's visibility to public in the repository's package settings if that is what
   you want.
4. Run the workflow manually once with `dry_run` left at true, confirm all three jobs are green,
   then tag `v0.1.0`.
5. Verify from a clean machine: `npm view @adgateio/sdk`, `pip install adgate`, and
   `docker pull ghcr.io/<owner>/<repo>/gateway:0.1.0`.
