# adgate gateway.
#
# The build context is the REPO ROOT, not this directory: the gateway imports its workspace
# siblings (@adgateio/core, @adgateio/schemas) and pnpm needs the lockfile and every package
# manifest to install. Build and run it from the repo root:
#
#   docker build -f packages/gateway/Dockerfile -t adgate-gateway .
#   docker run --rm -p 8787:8787 \
#     -e DATABASE_URL='postgres://adgate:adgate@host.docker.internal:5432/adgate' \
#     -e PUBLIC_BASE_URL='https://ads.example.com' \
#     -e ADGATE_SIGNING_KEY_ID=k_2026_09 -e ADGATE_SIGNING_KEY_PEM="$PEM" adgate-gateway
#
# PUBLIC_BASE_URL IS REQUIRED HERE. The runtime stage sets NODE_ENV=production (below), which
# turns on the production configuration checks in src/config.ts: the base URL every creative
# click URL is built from may not be https-less and may not be localhost/127.0.0.1/0.0.0.0/::1,
# and its default is `http://localhost:8787`. Passing nothing therefore exits 1 with that
# message rather than serving links that point back into the container. To poke at the image
# locally instead, add `-e NODE_ENV=development` and the checks are off, exactly as on a laptop.
#
# Not `--env-file .env`: docker does not strip the quotes around a value, and the repo's .env
# quotes ADGATE_SIGNING_KEY_PEM, so the gateway would see a PEM starting with `"` and exit 1.
# `localhost` inside the container is the container: the host Postgres is host.docker.internal
# (port 5433 on this repository's dev machine, 5432 on a fresh clone).
#
# The image serves the gateway only. It does not run migrations and it does not contain the
# dashboard or the examples. Apply migrations from a checkout (`pnpm db:migrate`) or by running
# this image with `node dist/db/migrate.js` before starting the service.

# ---------------------------------------------------------------------------------------------
# Builder: install the whole workspace, build the gateway and the two packages it depends on,
# then let pnpm assemble a self-contained production directory in /out.
# ---------------------------------------------------------------------------------------------
FROM node:20-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack reads the exact pnpm version from package.json "packageManager", so the image and the
# repository can never drift.
RUN corepack enable

# argon2 (API key hashing) is a native addon and ships no prebuilt binary for every platform, so
# node-gyp compiles it here. These toolchain packages exist in the builder only; the runtime
# stage receives the compiled .node file and nothing else.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@adgateio/gateway..." build
# `pnpm deploy` writes a self-contained copy of one workspace package: package.json, the files
# its "files" field lists (dist/ and drizzle/) and a node_modules with the production
# dependencies resolved from the lockfile — @adgateio/core and @adgateio/schemas copied in rather
# than symlinked out of the store. --prod drops devDependencies (drizzle-kit). The runtime stage
# therefore needs no pnpm, no store and no sources.
RUN pnpm deploy --filter=@adgateio/gateway --prod /out

# ---------------------------------------------------------------------------------------------
# Runtime: Node 20 and the deployed directory. No pnpm, no sources, no dev dependencies.
# ---------------------------------------------------------------------------------------------
FROM node:20-slim AS runtime

# NODE_ENV=production is what makes this an image rather than a laptop: it turns on the
# production configuration checks (src/config.ts) as well as every library's production mode.
ENV NODE_ENV=production
# DATABASE_URL, PUBLIC_BASE_URL, ADGATE_SIGNING_KEY_ID and ADGATE_SIGNING_KEY_PEM are required
# at boot and every other variable is optional; .env.example documents all of them, and
# docs/deploy.md has the full table plus a hosted walkthrough. There is no .env inside the
# image: pass them with --env-file or -e. The gateway exits 1 with a readable message listing
# every problem at once, before it opens a port.
#
# A hosted runtime (Render, Fly, Railway) INJECTS PORT and expects the process to use it, which
# this default only covers when the host injects nothing.
ENV PORT=8787

WORKDIR /app
COPY --from=builder --chown=node:node /out ./

# node:20-slim ships an unprivileged `node` user (uid 1000). Nothing in the image is writable
# by it, which is what we want: the gateway's only state is Postgres.
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
