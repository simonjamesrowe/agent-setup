# LogQL Cookbook — simonrowe.dev

Canned queries for the Grafana Cloud Loki tenant that `alloy` ships to.

## Setup

```bash
LOKI=https://logs-prod-035.grafana.net/loki/api/v1/query_range
AUTH="$GRAFANA_CLOUD_LOKI_USER:$GRAFANA_CLOUD_API_KEY"

# Helper: lq '<logql>' [minutes] [limit]
lq() {
  local q="$1" mins="${2:-30}" limit="${3:-200}"
  curl -su "$AUTH" "$LOKI" \
    --data-urlencode "query=$q" \
    --data-urlencode "start=$(date -u -v-${mins}M +%s)000000000" \
    --data-urlencode "end=$(date -u +%s)000000000" \
    --data-urlencode "limit=$limit" \
    --data-urlencode 'direction=backward' \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)["data"]["result"]
for s in d:
    for ts,line in s.get("values",[]):
        print(line)
    if "value" in s:
        print(s["metric"], s["value"])'
}
```

`date -u -v-30M` is macOS. On Linux: `date -u -d '30 minutes ago' +%s`.

Labels available: `container` (e.g. `simonrowe-dev-monorepo-backend-1`),
`service` (e.g. `backend`), `image`.

Not shipped at all (dropped in `config/alloy/config.alloy`): `kafka`, `mongodb`,
`frontend`, `langfuse-db`.

---

## 1. Backend errors (plain line filter)

```logql
{container="simonrowe-dev-monorepo-backend-1"} |= "ERROR"
```

```bash
lq '{container="simonrowe-dev-monorepo-backend-1"} |= "ERROR"' 60 100
```

## 2. Backend errors, structured

The backend emits one-line ECS JSON (`LOGGING_STRUCTURED_FORMAT_CONSOLE: ecs`),
so `| json` flattens dotted ECS fields with underscores (`log.level` →
`log_level`, `trace.id` → `trace_id`).

```logql
{container="simonrowe-dev-monorepo-backend-1"}
  | json
  | log_level="ERROR"
  | line_format "{{.log_logger}} {{.message}} {{.error_type}}"
```

Everything for one trace:

```logql
{container="simonrowe-dev-monorepo-backend-1"} | json | trace_id="<trace id>"
```

## 3. nginx 5xx

`config/nginx/nginx-proxy.conf` defines the `real_ip` access log format:
`$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" xff="..."`.
So the status code follows the quoted request line:

```logql
{container="simonrowe-dev-monorepo-nginx-1"} |~ "\" 5[0-9]{2} "
```

```bash
lq '{container="simonrowe-dev-monorepo-nginx-1"} |~ "\" 5[0-9]{2} "' 60 200
```

Upstream resolution failures (the crash-loop signature — see `prod-triage`):

```logql
{container="simonrowe-dev-monorepo-nginx-1"} |= "host not found in upstream"
```

5xx rate per minute:

```logql
sum(rate({container="simonrowe-dev-monorepo-nginx-1"} |~ "\" 5[0-9]{2} " [1m]))
```

## 4. Backup / restore / redeploy progress

`DataOperationsService`, `BackupService`, `RestoreService`, `BackupScheduler` and
`RedeployService` all log from the backend container:

```logql
{container="simonrowe-dev-monorepo-backend-1"}
  |~ "Restored|Restore failed|Backup failed|Nightly backup|Backup retention|Redeploy|Running: docker"
```

Restore only, per collection ("Restored N documents to collection X"):

```logql
{container="simonrowe-dev-monorepo-backend-1"} |= "Restored" |= "collection"
```

Nightly backup outcome (job runs 22:00 Europe/London):

```logql
{container="simonrowe-dev-monorepo-backend-1"} |~ "Nightly backup|Backup retention"
```

```bash
lq '{container="simonrowe-dev-monorepo-backend-1"} |~ "Nightly backup|Backup retention"' 1440 100
```

## 5. Chat requests

`ChatController` / `ChatService` log lines:

```logql
{container="simonrowe-dev-monorepo-backend-1"}
  |~ "Received chat message|Processing message for session|Completed response for session"
```

Errors and rate-limit rejections:

```logql
{container="simonrowe-dev-monorepo-backend-1"}
  |~ "Error processing chat|exceeded message limit|Web search failed|fetchUrl failed"
```

Chat messages per hour:

```logql
sum(count_over_time(
  {container="simonrowe-dev-monorepo-backend-1"} |= "Received chat message" [1h]
))
```

## 6. Per-container log volume

Which containers are burning the free tier:

```logql
sum by (container) (
  count_over_time({container=~"simonrowe-dev-monorepo-.+"} [1h])
)
```

```bash
lq 'sum by (container) (count_over_time({container=~"simonrowe-dev-monorepo-.+"} [1h]))' 60 100
```

By compose service (shorter names):

```logql
sum by (service) (count_over_time({service=~".+"} [1h]))
```

Bytes rather than lines:

```logql
sum by (container) (bytes_over_time({container=~"simonrowe-dev-monorepo-.+"} [1h]))
```

## 7. Pinggy tunnel health

```logql
{container="simonrowe-dev-monorepo-pinggy-1"}
  |~ "already active|error|Error|tunnel"
```

The tunnel URL is printed at startup; `A tunnel with the same token is already
active` means another host holds `PINGGY_TOKEN`.

## 8. Alloy itself

If Loki looks suspiciously empty, check the shipper:

```logql
{container="simonrowe-dev-monorepo-alloy-1"} |~ "level=error|level=warn"
```

Common causes: bad `GRAFANA_CLOUD_API_KEY`, wrong
`GRAFANA_CLOUD_LOKI_ENDPOINT`, rate limiting / over quota, or the Docker socket
mount missing. The disabled Tempo exporter is *not* an alloy error — it is
commented out in `config.alloy` on purpose.

---

## Cheatsheet

| Need | Fragment |
| --- | --- |
| One container | `{container="simonrowe-dev-monorepo-backend-1"}` |
| One service | `{service="nginx"}` |
| All prod containers | `{container=~"simonrowe-dev-monorepo-.+"}` |
| Substring | `\|= "text"` |
| Regex | `\|~ "a\|b"` |
| Exclude | `!= "healthcheck"` |
| Parse backend JSON | `\| json` |
| Field equality | `\| json \| log_level="WARN"` |
| Reformat output | `\| line_format "{{.message}}"` |
| Count over window | `count_over_time({...}[5m])` |
| Group a metric query | `sum by (container) (...)` |

API notes: `start`/`end` are Unix nanoseconds or RFC3339; `limit` caps returned
entries (log queries only); `direction=backward` returns newest first; metric
queries (`sum`, `rate`, `count_over_time`) come back as `resultType: matrix` or
`vector` with `metric`/`value` instead of `values`. Use
`/loki/api/v1/labels` and `/loki/api/v1/label/container/values` to discover what
is actually being ingested.
