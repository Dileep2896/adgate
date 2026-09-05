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

## Metrics (`GET /metrics`)

The gateway exposes Prometheus metrics in the text exposition format (version 0.0.4). The
format is written by the gateway itself (`packages/gateway/src/metrics/`), with no client
library: HELP/TYPE lines, counters and cumulative histogram buckets are a few dozen lines of
code, and CLAUDE.md keeps dependencies to the stack list. `prom-client` is the standard choice
if that ever stops being true.

### Access

- `GET /metrics` requires `Authorization: Bearer $METRICS_TOKEN`, compared in constant time.
  It is an operator secret and is **not** an API key: API keys belong to one app, this body
  describes the whole process.
- Wrong or missing token: `401` with the usual `{ "error": { "code": "unauthorized" } }` body.
- **`METRICS_TOKEN` unset: the route is not mounted at all and a scrape gets `404`.** A
  deployment that forgot to set the token exposes nothing. Recording always happens; only the
  endpoint is gated, so setting the variable and restarting is all that is needed.
- The response carries `Cache-Control: no-store` and the same security headers as every other
  response. The endpoint is deliberately absent from `openapi.json`: docs/api.md is the API
  contract, and this is an operational endpoint.

### What is exposed

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `adgate_decisions_total` | counter | `decision`, `reason` | Every evaluate outcome. `reason="none"` on a serve; otherwise the documented suppress reason (`paid_user`, `sensitive_category:health`, `no_fill`, `error`, …). |
| `adgate_evaluate_duration_seconds` | histogram | – | The whole `POST /v1/evaluate` handler. Buckets 0.005 … 5 s, with edges at the docs/api.md targets (p95 under 300 ms warm, under 700 ms cold). |
| `adgate_demand_adapter_duration_seconds` | histogram | `source` | One observation per demand adapter queried, taken from the `latency_ms` of the audit record's demand trace, so the metric equals what was audited. Buckets end just past the 250 ms per-adapter budget. |
| `adgate_classify_cache_total` | counter | `result` | Classifier cache lookups: `hit_memory` (process LRU), `hit_postgres` (`classify_cache` table), `miss`. |
| `adgate_http_requests_total` | counter | `route`, `status` | Every response, including 404, 413 and 500. `route` is the route PATTERN (`/v1/audit/:id`), never the path; anything unrouted is `other`. |
| `adgate_attest_total` | counter | `result` | `POST /v1/attest` outcomes: `ok`, `invalid_request`, `not_found`, `already_attested`, `unauthorized`, `rate_limited`, `error`. |
| `adgate_rate_limited_total` | counter | – | Requests refused with 429 by the per-key token bucket. |
| `adgate_process_uptime_seconds` | gauge | – | Seconds since this process built its registry. |
| `adgate_metrics_series_dropped_total` | counter | – | Series refused because a family hit its cardinality limit (256 label combinations). Non-zero means a metric is being labelled with something unbounded: it is a bug, not a capacity signal. |

Cardinality is bounded by construction. Every label value is a member of a contract enum, an
HTTP status, or a route pattern from a fixed list. No `app_id`, `audit_id`, creative id,
conversation hash or user hash is ever a label: those identify one tenant or one turn, they
already live in the audit record and the logs, and as labels they would multiply every series
by the number of tenants.

The classifier cache **ratio is not exposed as a gauge**, deliberately: a ratio gauge is an
average over the whole process lifetime that no query can window, and it cannot be aggregated
across replicas. Three counters can, over any range:

```promql
# Cache hit ratio over 5 minutes
sum(rate(adgate_classify_cache_total{result=~"hit_.*"}[5m]))
  / sum(rate(adgate_classify_cache_total[5m]))

# Evaluate p95, the docs/api.md target
histogram_quantile(0.95, sum by (le) (rate(adgate_evaluate_duration_seconds_bucket[5m])))

# Suppression mix
sum by (reason) (rate(adgate_decisions_total{decision="suppress"}[5m]))

# Fill rate on turns that reached demand
sum(rate(adgate_decisions_total{decision="serve"}[5m]))
  / sum(rate(adgate_decisions_total{decision="serve"}[5m])
      + rate(adgate_decisions_total{reason="no_fill"}[5m]))
```

### Scrape config

```yaml
scrape_configs:
  - job_name: adgate-gateway
    metrics_path: /metrics
    scheme: http
    scrape_interval: 15s
    authorization:
      type: Bearer
      # Prometheus reads the token from a file so it is not in the config.
      credentials_file: /etc/prometheus/adgate-metrics-token
    static_configs:
      - targets: ['gateway:8787']
```

Check it by hand with:

```
curl -sS -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:8787/metrics | head -20
```

Counters are per process and reset when it restarts, which is what `rate()` and `increase()`
expect. Run one scrape job per gateway instance rather than behind a load balancer, or the
series of several processes will be mixed into one.
