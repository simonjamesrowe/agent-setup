---
name: langfuse-verify
description: Verify Langfuse LLM trace plumbing for simonrowe.dev end to end. Use when checking whether chat/agent calls produce traces, or after observability changes.
---

# Verify Langfuse Trace Plumbing

Production **does** produce LLM traces, and only LLM traces. The path is:

```
backend  ──Micrometer Observation (Spring AI gen_ai)
         ──micrometer-tracing-bridge-otel → OTLP gRPC
         ──▶ alloy:4317
              └─ otelcol.processor.filter "ai_only"   (drops every non-AI span)
                 └─▶ http://langfuse:3000/api/public/otel   (basic auth, project keys)
```

Two version facts drive everything below:

- **Prod runs Langfuse v3** (`langfuse/langfuse:3.212.0` + `langfuse-worker:3.212.0`,
  with ClickHouse, Redis, MinIO and Postgres) in `docker-compose.prod.yml`. v3
  added `/api/public/otel`, which is why the Alloy exporter was re-enabled on
  2026-07-12. Traces flow.
- **Local `docker-compose.yml` still runs `langfuse/langfuse:2.95.1`** with only
  a Postgres, and there is **no `alloy` service locally at all**. v2 has no OTLP
  ingest endpoint and nothing is listening on the backend's default
  `http://localhost:4317`. **Local can never show a trace** — do not debug it as
  a fault.

## When to use

- Checking whether chat / agent calls are being traced at all.
- After changing `config/alloy/config.alloy`, the backend tracing config, the
  Langfuse version, or the project keys.
- A Langfuse project looks empty, or shows spans that should have been filtered
  out.
- Confirming an observability change survived a redeploy.

## Prerequisites

- Credentials by name only (from the private env repo; in prod they live in the
  deploy-dir `.env`): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, optionally
  `LANGFUSE_HOST`. Alloy uses the same two keys as its OTLP basic auth, and
  compose wires them to `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` /
  `LANGFUSE_INIT_PROJECT_SECRET_KEY`, so the exporter and the project agree by
  construction.
- For the UI: an Auth0 account holding the `DEV_PORTAL_ADMIN` role. The Auth0
  post-login Action treats the Langfuse client id as a protected application and
  calls `api.access.deny(...)` for anyone without that role, so a valid Google
  login alone will be rejected.
- The verify script runs from the repo/deploy dir and reads that dir's `.env`
  only when the two keys are not already exported. On the dev machine it will
  therefore work against **prod** if the root `.env` was copied from the private
  env file (see `local-env`).

## Workflow

### 1. Read the current wiring before trusting any memory of it

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo
sed -n '1,80p' config/alloy/config.alloy
grep -n -A4 'langfuse\|langfuse-worker' docker-compose.prod.yml | head -60
sed -n '28,45p' backend/src/main/resources/application.yml
cat docs/runbooks/langfuse-observability.md
```

This area has changed more than once (Tempo disabled, Langfuse upgraded, the
`ai_only` filter added), and the comments in `config.alloy` are dated. The
runbook is the owner-facing source of truth.

### 2. Confirm the UI is reachable and the project exists

`https://langfuse.simonrowe.dev` (prod nginx `server_name`, proxying
`http://langfuse:3000` with WebSocket upgrade — the container publishes no host
port, so nginx is the only route in).

With browser automation (Playwright MCP in Claude Code): navigate there, sign in
with Auth0 as the admin user, and confirm a project is visible with recent
traces. Otherwise print those steps and ask Simon for a screenshot of the Traces
list.

Bootstrap is deterministic and idempotent: `LANGFUSE_INIT_ORG_ID`,
`LANGFUSE_INIT_PROJECT_ID`, `LANGFUSE_INIT_USER_EMAIL` and
`LANGFUSE_INIT_USER_PASSWORD` recreate the org, project, admin membership and
fixed keys on every boot, creating only what is missing. `LANGFUSE_INIT_USER_PASSWORD`
must be set or the admin user and its org membership are never created and the
SSO login lands with no project.

### 3. Generate a trace

Send a chat message on the live site (open the **ASK AI** panel and ask anything
on-topic). One user turn produces the chat generation span plus any embedding and
tool-call spans. See `chat-e2e-verify` for driving that surface properly.

Note that an **off-topic** message is answered by `GuardrailAdvisor` with a fixed
pivot string — the classifier call is still an LLM call and still traces, but
there is no main generation, so use an on-topic question when checking the happy
path.

### 4. Run the verify script

Read `scripts/verify-langfuse-trace.sh` first — it is short, read-only, and
documents the intended flow.

```bash
scripts/verify-langfuse-trace.sh                    # any trace at all
scripts/verify-langfuse-trace.sh --since-minutes 5  # a trace since 5 min ago
```

It `GET`s `${LANGFUSE_HOST}/api/public/traces?limit=1[&fromTimestamp=…]` with the
project keys as basic auth and parses `meta.totalItems`:

- `OK: found N matching trace(s) …` → exit 0. Plumbing works.
- `FAIL: no matching traces found.` → exit 1, with hints about the keys and the
  Alloy OTLP endpoint.
- `ERROR: unexpected response from Langfuse API:` → the raw body is printed.
  A 401 here is a key mismatch, HTML is nginx or the Langfuse login page rather
  than the API.

`LANGFUSE_HOST` defaults to `https://langfuse.simonrowe.dev`, so with no
arguments the script targets **prod**. Pointing it at a local `localhost:3000`
will always fail while local Langfuse is v2 — there is no OTLP ingest and no
Alloy to feed it.

### 5. When there are zero traces, diagnose in this order

1. **Containers.** `langfuse`, `langfuse-worker`, `langfuse-clickhouse`,
   `langfuse-redis`, `langfuse-minio`, `langfuse-db` and `alloy` all need to be
   up; v3 ingest is asynchronous, so a dead worker or ClickHouse means the API
   accepts spans and never surfaces them. Check via Portainer or
   `docker compose -f docker-compose.prod.yml ps` (`prod-triage`).
2. **Alloy's own logs.** `alloy` is shipped to Loki, so
   `{container="simonrowe-dev-monorepo-alloy-1"}` shows export failures — 401
   (key mismatch), connection refused (Langfuse down), or 404 (a v2 Langfuse
   with no `/api/public/otel`). See `prod-logs`.
3. **The backend is exporting.** `OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4317`
   is set for the backend service in `docker-compose.prod.yml`; without it the
   backend falls back to `http://localhost:4317` inside its own container and
   spans go nowhere. `management.tracing.sampling.probability` is `1.0`, so
   sampling is never the explanation.
4. **Keys.** Reconcile the deploy-dir `.env` and restart **only** `langfuse` and
   `alloy` — not nginx, which will fail to start unless all four upstreams
   (frontend, backend, portainer, langfuse) are up.
5. **The filter.** `ai_only` **drops** any span whose OTTL condition is true —
   i.e. one with none of `gen_ai.operation.name`, `gen_ai.system`,
   `spring.ai.kind`. If your new instrumentation carries none of those
   attributes, it is being dropped by design. `error_mode = "ignore"` means a
   malformed condition fails quietly rather than loudly.
6. **Ingest lag.** Retry `--since-minutes 5` after a minute before concluding
   anything.

### 6. Know what is deliberately absent

Say this rather than hunting for it:

- **No prompt or completion text.** Content capture is off by default (decision
  2026-07-17, privacy): spans record that a generation happened, its model and
  token usage, but not visitor chat content. The commented block in
  `backend/src/main/resources/application.yml` shows how to enable it
  temporarily — verify the property names against the pinned Spring AI version
  first.
- **No HTTP, MongoDB or `@WithSpan` spans.** Removed by `ai_only` before export.
- **No traces in Grafana Cloud.** The Tempo exporter and its basic-auth block are
  commented out: `GRAFANA_CLOUD_TEMPO_ENDPOINT` points at `gb-south-1` while the
  account's Tempo instance is US region (404). Langfuse is the only trace sink.
- **No metrics anywhere.** `/actuator/prometheus` is exposed on the backend's
  unpublished management port and nothing scrapes it.
- **Nothing local.** No `alloy` in `docker-compose.yml`; local Langfuse v2 is UI
  only.

## Gotchas

- **Two different Langfuse majors in one repo.** Prod is v3, local is v2. Always
  state which one a finding applies to; advice that assumes v3 locally is wrong.
- **Cost may be blank while token usage is populated.** Langfuse derives cost
  from its own model-price table, so a brand-new model id is unpriced until a
  custom price is added in Settings → Models. That is not a plumbing fault.
- **`micrometer-tracing-bridge-otel` is the load-bearing dependency.** The
  OpenTelemetry Spring Boot starter alone bridges Micrometer *metrics*, not the
  Observation API — before that bridge was added, Langfuse received HTTP/Mongo
  noise and zero generations. Removing it silently ends all AI tracing.
- **`langfuse-db` logs are not in Loki.** Alloy's drop rule excludes
  `kafka|mongodb|frontend|langfuse-db`, so Langfuse's Postgres has to be read via
  Portainer or on the Pi.
- **The script's `--since-minutes` uses BSD `date -v` with a GNU `date -d`
  fallback**, so it works on macOS and on the Pi — but a bad value fails the
  date parse rather than the query.
- **Do not restart nginx to "fix" Langfuse.** It resolves all upstreams at
  startup and will refuse to come up if any are down, turning an observability
  question into an outage.

## Related skills

- `chat-e2e-verify` — generating the chat traffic that produces traces.
- `prod-logs` — Alloy and backend logs, and what is excluded from Loki.
- `prod-triage` — container health checks when Langfuse's stack is part-down.
- `prod-deploy` — the prod compose file, restart ordering, and the nginx caveat.
- `local-env` — why the local stack cannot produce traces.
