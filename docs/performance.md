# Performance

One recorded run of the load script against a local gateway. Not a contract document: the
numbers describe this machine on this date and are here so a regression is visible when the
script is run again. Latency targets live in docs/api.md (`/v1/evaluate` p95 under 300 ms with
a warm classifier cache, under 700 ms cold).

## Run of 2026-09-03

Machine: Apple M2 Pro (Apple Silicon), 16 GB, macOS (Darwin 25.5.0). Node v22.12.0, pnpm
9.15.9. Postgres 16 in Docker Desktop, published on localhost:5433 (`PGPORT_HOST=5433`).

Gateway: `tsx packages/gateway/src/server.ts` with the repo-root `.env` (LOG_LEVEL info,
default pool of 10 connections, DB_STATEMENT_TIMEOUT_MS 2000, DB_LOCK_TIMEOUT_MS 1000),
rules-only classifier (CLASSIFIER_MODEL empty, no LLM key), Koah and Gravity disabled, and the
rate limit raised so the run itself is not throttled:

```
PORT=8799 RATE_LIMIT_RPS=10000 RATE_LIMIT_BURST=10000 tsx packages/gateway/src/server.ts
```

App: `pnpm --filter @adgate/gateway create-app --name loadtest` (the documented default
policy, no affiliate config), catalog `pnpm --filter @adgate/gateway seed-creatives`
(examples/creatives.seed.json). Body: examples/evaluate.json, whose message classifies as
`software.devtools.database` by rules alone and serves the Example DB Cloud creative; every
request gets its own conversation_id, so the per_session cap never applies and each request
writes one signed audit record under the app's chain lock.

Command (run twice back to back; the first is the cold process, the second the warm one):

```
pnpm --filter @adgate/gateway load -- --url http://localhost:8799 --key <api key> --app <app_id> --requests 200 --concurrency 10
```

Cold (first 200 requests after boot):

```
adgate load: 200 requests, concurrency 10, POST http://localhost:8799/v1/evaluate
  wall time      1021 ms (195.8 req/s)
  status         200: 200
  errors         0
  decisions      serve: 200
  client latency p50 43.4 ms  p95 63.0 ms  p99 170.4 ms  max 189.6 ms
  server latency mean 41.2 ms (latency_ms over 200 responses)
```

Warm (the next 200):

```
adgate load: 200 requests, concurrency 10, POST http://localhost:8799/v1/evaluate
  wall time      853 ms (234.5 req/s)
  status         200: 200
  errors         0
  decisions      serve: 200
  client latency p50 40.8 ms  p95 45.6 ms  p99 67.1 ms  max 74.0 ms
  server latency mean 37.0 ms (latency_ms over 200 responses)
```

The gateway log had no warn or error lines during either run and every request answered
200. Both runs are inside the docs/api.md targets. Notes on reading the numbers:

- "Cold" is the process (JIT, connection pool, the first argon2 verify of the key); the
  classifier cache warms after the first request because every request carries the same text,
  and there is no LLM in this configuration, so a run with CLASSIFIER_MODEL set will be slower
  on cache misses by the LLM round trip (bounded by CLASSIFIER_TIMEOUT_MS, 400 ms).
- Requests of one app serialise on the apps-row lock for the audit transaction (chain
  position, cap update), so at concurrency 10 the per-request latency is roughly ten times the
  serialised work. Throughput, not latency, is the number that scales with concurrency.
- Client latency is measured around fetch in the script; `latency_ms` is the gateway's own
  measure from request start to response and excludes the socket.

## Reproduce

1. `docker compose up -d postgres`, `pnpm install`, `pnpm build`, `pnpm db:migrate`.
2. Put a signing key in `.env` (`pnpm --filter @adgate/gateway keygen`).
3. Start the gateway with the rate limit raised (see the command above) and wait for
   `curl localhost:8799/healthz`.
4. `pnpm --filter @adgate/gateway create-app --name loadtest` (copy the app_id and key),
   then `pnpm --filter @adgate/gateway seed-creatives`.
5. Run the load command twice and keep the second output as the warm figure.
6. Stop the gateway (SIGTERM) and check `lsof -nP -iTCP:8799 -sTCP:LISTEN` prints nothing.

`pnpm --filter @adgate/gateway load -- --help` lists every flag (`--body` takes another
EvaluateRequest JSON file; `--requests` and `--concurrency` default to 200 and 10).
