---
name: prod-triage
description: Runbook for simonrowe.dev being down or misbehaving in production. Use when the site is unreachable, a page breaks after deploy, containers are unhealthy, or Portainer/Langfuse are inaccessible.
---

# Production Triage

Ordered runbook. Work the checks top to bottom — they are sequenced by how often
each cause actually fires, and later checks assume the earlier ones came back
clean.

Prod topology: Cloudflare → `pinggy` tunnel → the `nginx` container → four
upstreams (`frontend:80`, `backend:8080`, `portainer:9000`, `langfuse:3000`).
Everything runs from `docker-compose.prod.yml`, compose project
`simonrowe-dev-monorepo`, on the Raspberry Pi at
`~/workspace/simonjamesrowe/simonrowe-dev-monorepo`.

## When to use

- `simonrowe.dev` is unreachable or timing out.
- A page renders wrong, 502s, or breaks right after a deploy.
- `status-prod.sh` reports `DEGRADED` / `DOWN`, or containers look unhealthy.
- Portainer (`console.simonrowe.dev`) or Langfuse (`langfuse.simonrowe.dev`)
  won't load.

## Prerequisites

- Use [Raspberry Pi Connect](references/raspberry-pi-connect.md) for host-side
  commands. Reuse the browser session; manual copy-paste is the fallback when
  Connect is unavailable.
- `curl` locally. Optionally Loki credentials (see `prod-logs`) and an admin
  Auth0 token.

## Workflow

Read the deployed `scripts/monitor-prod.sh` and the current
`docs/runbooks/prod-monitoring.md` before repairs. Historical thresholds and
recovery commands below must be checked against that version. If Connect also
shows the Pi offline, use `docs/runbooks/wifi-resilience.md`; a host network
failure cannot be fixed through an unreachable browser shell.

### 1. Establish what is actually broken, from the outside

```bash
curl -fsS -o /dev/null -w 'www:      %{http_code} in %{time_total}s\n' -m 10 https://www.simonrowe.dev
curl -fsS -o /dev/null -w 'api:      %{http_code} in %{time_total}s\n' -m 10 https://api.simonrowe.dev/api/blogs
curl -fsS -o /dev/null -w 'mcp:      %{http_code}\n' -m 10 https://www.simonrowe.dev/mcp
curl -s  -o /dev/null -w 'console:  %{http_code}\n' -m 10 https://console.simonrowe.dev
curl -s  -o /dev/null -w 'langfuse: %{http_code}\n' -m 10 https://langfuse.simonrowe.dev
```

Two important corrections to the obvious commands:

- **Check `www.simonrowe.dev`, not the bare `simonrowe.dev`.** The bare domain
  301-redirects to `www` at the Cloudflare edge and `curl -f` treats 3xx as
  success, so it reports healthy while nginx/frontend/backend/pinggy are all
  down. `scripts/monitor-prod.sh` hard-codes `www` for exactly this reason.
- **`https://api.simonrowe.dev/actuator/health` returns 404** — the actuator is
  on a separate management port (`MANAGEMENT_SERVER_PORT: 8081` in prod), which
  is neither published to the host nor proxied by nginx (`api.simonrowe.dev` maps
  only to `backend:8080`). Use a real API route such as `/api/blogs` from
  outside; for the actuator view use the compose health column in
  `status-prod.sh` (the backend healthcheck does hit `:8081/actuator/health`
  from inside the container).

Read the pattern:

| Symptom | Most likely | Go to |
| --- | --- | --- |
| Everything times out / connection refused | pinggy tunnel or whole stack down | 2 |
| `www` 502 but console loads | frontend/backend upstream dead, nginx alive | 4, 5 |
| Nothing loads, including console | nginx down or refusing to boot | 5 |
| Site loads but behaves like the old build | stale image | 6 |
| Site loads, one feature errors | application error | 7 |

### 2. Unreachable → suspect the pinggy tunnel

The Pi runs `scripts/monitor-prod.sh` from cron **every minute** (installed by
`scripts/install-prod-monitoring.sh`). It curls
`https://www.simonrowe.dev`; after **3 consecutive failures**
(`FAILURE_THRESHOLD`) it reconciles the stack with
`docker compose -f docker-compose.prod.yml up -d` and then restarts `nginx`,
rate-limited to **3 restarts per 600s window** (`MAX_RESTARTS` / `BACKOFF_WINDOW`)
before it logs `CRIT` and backs off. State lives in `/tmp/prod-health/`
(`failure_count`, `restart_timestamps`); output is appended to
`/var/log/prod-health/monitor.log` (logrotate daily, 7 rotations).

So: if the outage is under ~3 minutes old, self-healing may still be in flight —
read the log before touching anything.

Run in the Connect remote shell and read the output:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && ./scripts/status-prod.sh && tail -50 /var/log/prod-health/monitor.log
```

`status-prod.sh` prints Service / State / Health per container, an
`External: www.simonrowe.dev  reachable|UNREACHABLE` line, and
`ALL HEALTHY` / `DEGRADED` / `DOWN`. Repeated `CRIT Max restarts reached` means
reconciliation is not fixing it — keep going.

### 3. Pinggy token conflict

One `PINGGY_TOKEN` = one active tunnel, and the token maps to the
`*.simonrowe.dev` custom domain. If another host (a laptop running the prod
stack for testing, an old Pi) still holds it, the pinggy container logs
`A tunnel with the same token is already active`.

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml logs pinggy | tail -40
```

Reclaim it by appending `+force` to the token value in the Pi's `.env` —
`PINGGY_TOKEN=<token>+force` — which terminates the stale session, then
`docker compose -f docker-compose.prod.yml up -d pinggy`. Also stop the stack on
whatever other host is holding it. If the tunnel itself looks fine, check
[status.pinggy.io](https://status.pinggy.io) for a provider incident.

### 4. Containers stuck in `created`

An interrupted `docker compose up` leaves containers built but never started.
`docker restart` cannot fix that (no process to restart); `up -d` starts any
non-running container in `depends_on` order and is a no-op for healthy ones.

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml ps -a && docker compose -f docker-compose.prod.yml up -d
```

Watch for anything in `Created` or `Restarting`. This is the single most common
prod failure mode, and it usually shows as a 502 because nginx keeps serving with
a stale cached upstream IP.

### 5. nginx and upstream failures

Inspect the deployed `config/nginx/nginx-proxy.conf`, container health and logs.
Current main uses `resolver 127.0.0.11` and variable upstreams: a down upstream
returns an error for that route rather than preventing nginx from starting.
The old static-DNS failure applies only to a deployment still using that config.
Keep the standing upstream-health check before restarting; never infer readiness
from `up -d` alone.

Read `docs/runbooks/prod-monitoring.md` and `docs/runbooks/deploy.md` for recovery.
An intentional maintenance 503 during a deploy is different from a failed proxy.
Inspect the active deploy before restarting services or clearing maintenance.

### 6. Site up but behaving like the old build → stale image

If prod behaviour predates the merge you are expecting, prod is running a stale
image. `up -d` only recreates containers whose image or config changed, so a
`pull` that failed silently leaves the old image in place. Run the digest
comparison in **`prod-deploy` running-release verification**, then re-run `./scripts/restart-prod.sh`
(it pulls). Remember `docker-compose.prod.yml`, `.env`, `frontend/nginx.conf` and
`config/nginx/nginx-proxy.conf` are bind-mounted from the Pi's checkout, so a
config fix also needs `git pull` there.

### 7. Site up, a feature is erroring → go to the logs

Hand off to `prod-logs`: query Loki for
`{container="simonrowe-dev-monorepo-backend-1"} | json | log_level="ERROR"`, and
`{container="simonrowe-dev-monorepo-nginx-1"} |~ "\" 5[0-9]{2} "` for the 5xx
that the user saw. Remember `kafka`, `mongodb`, `frontend` and `langfuse-db` do
not ship logs to Loki — use Portainer (`https://console.simonrowe.dev`) or
`docker compose logs` on the Pi for those.

## Gotchas

- **Do not remove `JAVA_TOOL_OPTIONS: -Xshare:off` from the backend service.** It
  disables Class Data Sharing to work around an aarch64 G1GC SIGSEGV (JDK 21 bug)
  that crashes the JVM on the Pi. Removing it "because it looks like leftover
  debug config" reintroduces random hard crashes.
- The backend healthcheck sends a real HTTP request to `:8081/actuator/health`
  over bash `/dev/tcp` (the buildpack image has no curl/wget) and requires
  `"status":"UP"` — so a wedged JVM is correctly reported unhealthy rather than
  passing a bare TCP connect.
- `elasticsearch` has `stop_grace_period: 90s`; a full stack restart is slow, do
  not assume it hung.
- nginx and portainer publish **no host ports** — all ingress is the pinggy
  tunnel. You cannot curl them from the Pi's host on `:80`.
- `monitor-prod.sh` state lives in `/tmp/prod-health`, so counters reset on
  reboot. That is intentional.
- The nightly backup runs 22:00 Europe/London and holds the single
  data-operations lock; admin POSTs in that window return 409.
- Deployments now run through software-factory/deployer. Use `prod-deploy` to
  distinguish active maintenance from a stuck deployment.
- Cloudflare sits in front of everything: a Cloudflare error page (520/521/522)
  means the origin/tunnel is unreachable, not that nginx returned an error.

## Related skills

- `prod-logs` — Loki / Portainer / compose logs, and what telemetry does *not* exist.
- `prod-deploy` — restart scripts, the stale-image check, smoke tests.
- `prod-backup-ops` — take a backup before invasive recovery.
- `prod-data-restore` — recovering data, not availability.
