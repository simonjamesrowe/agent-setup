---
name: prod-logs
description: Fetch simonrowe.dev production logs from Grafana Cloud Loki, Portainer, or docker compose. Use when investigating prod errors, checking container output, or confirming a fix landed.
---

# Production Logs

Production container logs are shipped to Grafana Cloud Loki by the `alloy`
service (`config/alloy/config.alloy`, `loki.source.docker` → `loki.write`).
Loki is the fastest route and works from the dev machine with no host access.
Four high-volume containers are deliberately **not** shipped — for those you need
Portainer or the Pi.

## When to use

- A prod error needs a stack trace or the request that triggered it.
- Confirming a deployed fix actually changed behaviour ("did the error stop?").
- Checking what a backup, restore or redeploy operation did.
- Working out which container is generating load or noise.

## Prerequisites

- Loki credentials, from the env repo, referenced by name only:
  `GRAFANA_CLOUD_LOKI_USER` (tenant/user id), `GRAFANA_CLOUD_API_KEY`,
  `GRAFANA_CLOUD_LOKI_ENDPOINT`.
- The query base URL is `GRAFANA_CLOUD_LOKI_ENDPOINT` **minus the `/push`
  suffix**: the env var holds
  `https://logs-prod-035.grafana.net/loki/api/v1/push`, so queries go to
  `https://logs-prod-035.grafana.net/loki/api/v1/query_range`.
- For Portainer: a browser, and Portainer's own local admin login.
- For the Pi: no SSH from the dev machine — emit a copy-paste block and ask for
  the output.

## Workflow

### 1. Know the label set

`discovery.relabel "docker_logs"` produces exactly three labels:

| Label | Value | Example |
| --- | --- | --- |
| `container` | full compose container name, leading `/` stripped | `simonrowe-dev-monorepo-backend-1` |
| `image` | container image reference | `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-backend:latest` |
| `service` | compose service name | `backend` |

`container` is the one to reach for. Available containers (compose project
`simonrowe-dev-monorepo`, so `simonrowe-dev-monorepo-<service>-1`):
`backend`, `nginx`, `pinggy`, `alloy`, `elasticsearch`, `portainer`, `searxng`,
`langfuse`, `langfuse-worker`, `langfuse-clickhouse`, `langfuse-redis`,
`langfuse-minio`.

### 2. Query Loki

```bash
LOKI=https://logs-prod-035.grafana.net/loki/api/v1/query_range

curl -su "$GRAFANA_CLOUD_LOKI_USER:$GRAFANA_CLOUD_API_KEY" "$LOKI" \
  --data-urlencode 'query={container="simonrowe-dev-monorepo-backend-1"}' \
  --data-urlencode "start=$(date -u -v-30M +%s)000000000" \
  --data-urlencode "end=$(date -u +%s)000000000" \
  --data-urlencode 'limit=200' \
  --data-urlencode 'direction=backward'
```

`start`/`end` are Unix **nanoseconds** (RFC3339 is also accepted). The `date -v`
form above is macOS; on Linux use `date -u -d '30 minutes ago' +%s`.

Readable output:

```bash
curl -su "$GRAFANA_CLOUD_LOKI_USER:$GRAFANA_CLOUD_API_KEY" "$LOKI" \
  --data-urlencode 'query={container="simonrowe-dev-monorepo-backend-1"} |= "ERROR"' \
  --data-urlencode "start=$(date -u -v-1H +%s)000000000" \
  --data-urlencode 'limit=100' --data-urlencode 'direction=backward' \
  | python3 -c '
import json,sys
for s in json.load(sys.stdin)["data"]["result"]:
    for ts, line in s["values"]:
        print(line)
'
```

More queries — nginx 5xx, restore progress, chat traffic, per-container volume —
are in [references/loki-cookbook.md](references/loki-cookbook.md).

The backend emits **one-line ECS JSON** (`LOGGING_STRUCTURED_FORMAT_CONSOLE: ecs`),
so structured filtering works and includes `trace.id` / `span.id` for
correlation: `{container="simonrowe-dev-monorepo-backend-1"} | json | log_level="ERROR"`.
Other containers log plain text — use line filters (`|=`, `|~`) for those.

### 3. When Loki has nothing: the free-tier exclusions

`config/alloy/config.alloy` drops these compose services before shipping, to
control Grafana Cloud free-tier volume:

```
kafka | mongodb | frontend | langfuse-db
```

Their logs are **never in Loki**. If you are chasing a Kafka consumer problem, a
MongoDB slow query, a static-asset 404 from the frontend nginx, or Langfuse's
Postgres, use Portainer or the Pi instead. (Note the service is `mongodb`, not
`mongo`.) To ship one of them anyway, remove it from the `regex` in the `drop`
rule and restart `alloy` — and expect the ingest bill.

### 4. Portainer

`https://console.simonrowe.dev` → **Containers** → pick the container →
**Logs** (tail size, timestamps, live-follow, search all available). Portainer
has no published host port; it is reachable only through the prod nginx, and it
uses its own local admin account — Auth0 is not wired into it.

Browser automation works well here: with browser automation (Playwright MCP in
Claude Code) navigate, sign in, open the container's Logs tab and read/screenshot
the output. Otherwise print those steps for Simon and ask for the log excerpt.

Portainer is the best option for the four excluded containers, and the only
option when Loki ingest is lagging.

### 5. On the Pi

Emit this single block for Simon to run on the Pi, then ask for the output:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml logs --since 30m backend nginx
```

Variations — swap the service list and window as needed:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml logs --since 1h --tail 300 mongodb kafka frontend
```

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml logs pinggy | tail -40
```

That last one also prints the pinggy tunnel URL and any
`A tunnel with the same token is already active` error.

### 6. Correlate with a trace or request

Backend ECS lines carry `trace.id`. Once you have one, pivot on it:

```
{container="simonrowe-dev-monorepo-backend-1"} | json | trace_id="<trace id>"
```

For a user-facing 502/504, start at nginx (which logs `$status` and the real
client IP recovered from `X-Forwarded-For` via `real_ip`), get the timestamp and
path, then filter the backend around that window.

## What is NOT available

Be honest about this rather than inventing a dashboard:

- **Traces are not in Grafana Cloud.** In `config.alloy` the batch processor's
  `traces` output goes only to the AI-only filter → Langfuse. The Tempo exporter
  and its basic-auth block are commented out: `GRAFANA_CLOUD_TEMPO_ENDPOINT`
  points at `gb-south-1` while the account's Tempo instance is US region (HTTP
  404). Loki push on the US cluster works with the same key.
- **Only Spring AI spans reach Langfuse.** The `ai_only` filter drops any span
  without `gen_ai.operation.name`, `gen_ai.system` or `spring.ai.kind` — so
  HTTP-server, MongoDB and manual `@WithSpan` spans go nowhere. Chat generations,
  embeddings and tool calls are visible at `https://langfuse.simonrowe.dev`.
- **No metrics are collected.** `/actuator/prometheus` is exposed on the backend's
  management port but nothing scrapes it; there is no Prometheus, no Grafana Cloud
  metrics agent, no dashboards. Don't promise CPU/memory/latency graphs — use
  `prod-triage` for health signals (compose health status, `status-prod.sh`,
  `monitor-prod.sh` log).

## Gotchas

- The management port is not published, so `/actuator/*` is not reachable from
  outside the container (prod `8081`, local `8082`).
- Loki rejects a query with no non-empty label matcher. Always include a
  `container`, `service` or `image` matcher.
- Free-tier retention is limited — for an incident more than a couple of weeks
  old, Loki may have nothing and the Pi's `docker logs` is your only source.
- `container` includes the `-1` replica suffix. `simonrowe-dev-monorepo-backend`
  matches nothing; use `simonrowe-dev-monorepo-backend-1` or a regex matcher.
- After a redeploy the transient `backend-restarter` helper container also ships
  logs (it is not compose-labelled, so it has no `service` label).
- `alloy` reads `/var/run/docker.sock` read-only. If it is unhealthy, nothing
  ships and Loki looks deceptively quiet — check `alloy`'s own logs first.

## Related skills

- `prod-triage` — the ordered runbook when prod is down; use logs as evidence.
- `prod-deploy` — confirming a deploy landed and the stale-image check.
- `prod-data-restore` — reading restore failures from the backend log.
- `prod-backup-ops` — nightly backup job log lines.
