---
name: prod-deploy
description: Deploy simonrowe.dev to production: merge, watch the Publish workflow, restart on the Pi, smoke-test. Use when shipping merged changes to prod or checking whether prod runs the latest build.
---

# Deploy simonrowe.dev To Production

Production is a `docker-compose.prod.yml` stack (compose project
`simonrowe-dev-monorepo`) running on Simon's Raspberry Pi, deployed from
`~/workspace/simonjamesrowe/simonrowe-dev-monorepo` on that host and exposed to
the internet through the `pinggy` tunnel → Cloudflare. Deploying means: merge to
`main`, let GitHub Actions publish new `:latest` images to ghcr.io, then make the
Pi pull them.

## When to use

- A PR has merged to `main` and you need the change live.
- Someone reports "my fix isn't on prod" and you need to prove whether prod is
  running the latest build (the stale-image check in step 5).
- After a config change to `docker-compose.prod.yml`, `config/nginx/nginx-proxy.conf`
  or `frontend/nginx.conf` — those are bind-mounted from the Pi's checkout, so
  they need a `git pull` there, not just an image pull.

## Prerequisites

- `gh` authenticated against `github.com/simonjamesrowe`.
- **There is no SSH from the dev machine to the Pi.** Every host-side step must
  be emitted as a single copy-paste block for Simon to run on the Pi, after which
  you ask for the output before continuing.
- For the API alternative: an Auth0 access token for `admin@simonrowe.dev` with
  the `DEV_PORTAL_ADMIN` role (see `prod-data-restore/references/data-ops-api.md`).

## Workflow

### 1. Confirm the merge landed on main

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo
git fetch origin
git log --oneline -5 origin/main
```

Note the merge commit SHA — you will match it against the published image tags.

### 2. Watch the Publish workflow

`.github/workflows/publish.yml` (`name: Publish`) triggers on every push to
`main`. It has two jobs, both on `ubuntu-24.04-arm` runners (ARM64, matching the
Pi): **Publish Backend Image** (`./gradlew :backend:bootBuildImage`, buildpacks)
and **Publish Frontend Image** (`docker/build-push-action` with
`Dockerfile.frontend`). Each pushes `:<git sha>` **and** `:latest`.

```bash
gh run list --workflow=publish.yml --limit 5
gh run watch "$(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

The backend job is the slow one (native/buildpack image build on an ARM runner).
If it fails, stop — nothing to deploy:

```bash
gh run view --log-failed "$(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

### 3. Confirm ghcr.io `:latest` actually moved

Both images live under the `simonjamesrowe` **organisation**:

- `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-backend:latest`
- `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-frontend:latest`

```bash
for pkg in simonrowe-dev-monorepo-backend simonrowe-dev-monorepo-frontend; do
  echo "== $pkg"
  gh api "/orgs/simonjamesrowe/packages/container/$pkg/versions?per_page=5" \
    --jq '.[] | select(.metadata.container.tags[]? == "latest")
          | {digest: .name, tags: .metadata.container.tags, updated_at}'
done
```

The `tags` array for the newest version must contain both `latest` and the merge
commit SHA from step 1. Equivalent local check (`digest` here is the manifest
digest, the same value as `.name` above):

```bash
docker manifest inspect ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-frontend:latest | head -20
```

### 4. Deploy on the Pi

Emit exactly this block for Simon to run on the Pi, then ask for the output:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && ./scripts/restart-prod.sh && ./scripts/status-prod.sh
```

`restart-prod.sh` does `docker compose -f docker-compose.prod.yml pull`, then
`up -d`, then `docker compose restart nginx`. That final nginx bounce is
deliberate and load-bearing: `config/nginx/nginx-proxy.conf` uses static
`proxy_pass http://<name>` with no `resolver`, so nginx caches upstream IPs from
boot and would keep proxying to the dead IPs of the containers `up -d` just
recreated (502s). All four upstreams are healthy at that point because `up -d`
honours `depends_on`, so the restart is safe.

`status-prod.sh` prints a per-service table (Service / State / Health), an
`External: www.simonrowe.dev  reachable|UNREACHABLE` line, and an overall verdict
of `ALL HEALTHY` / `DEGRADED` / `DOWN` (exit 0 only when all healthy).

If the change touched compose or nginx config rather than app code, the block
needs a pull of the checkout too:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && git pull --ff-only && ./scripts/restart-prod.sh && ./scripts/status-prod.sh
```

**Alternative when the Pi is not to hand** — the backend can redeploy itself.
It has the Docker socket and the compose file bind-mounted:

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.simonrowe.dev/api/admin/data-operations/redeploy
```

It pulls `backend`, `frontend` and `nginx`, brings up frontend and nginx, then
after 5 seconds an ephemeral `docker:cli` helper container (`backend-restarter`)
recreates the backend — the backend cannot recreate itself without killing the
compose process mid-flight. Expect a ~30–60s API gap while the backend restarts,
and note that this path does **not** `git pull`, so bind-mounted config stays as
it was. `503` means the Docker socket is not reachable; `409` means another data
operation is in progress.

### 5. Stale-image check (the recurring incident pattern)

If prod behaviour predates the merge, prod is almost certainly running a stale
image — `up -d` only recreates containers whose image or config changed, and a
`pull` that failed silently leaves the old image in place.

Emit this block for the Pi and ask for the output:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml images && docker inspect --format '{{.Image}}' simonrowe-dev-monorepo-frontend-1 && docker inspect --format '{{.Image}}' simonrowe-dev-monorepo-backend-1 && docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-frontend:latest && docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-backend:latest
```

Read it as: `docker compose ... images` and `docker inspect --format '{{.Image}}'`
give the **local image IDs** the containers are running; the `RepoDigests` lines
give the **manifest digests** of what the Pi last pulled. Compare those digests
with the ghcr `digest` values from step 3. If they differ, the Pi never pulled
the new image — re-run `./scripts/restart-prod.sh` (it pulls) and re-check.
Both services set `pull_policy: always`, so a successful `up -d` should not be
able to run a stale image; a mismatch usually means the pull errored (rate limit,
network) and the script's `set -euo pipefail` aborted before `up -d`.

### 6. Smoke-test

Run these from the dev machine:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' https://www.simonrowe.dev
curl -fsS -o /dev/null -w '%{http_code}\n' https://www.simonrowe.dev/mcp
curl -fsS https://api.simonrowe.dev/api/blogs | head -c 300
```

- **Use `https://www.simonrowe.dev`, not `https://simonrowe.dev`.** The bare
  domain 301-redirects to `www` at the Cloudflare edge, and `curl -f` treats a
  3xx as success — so it reports healthy even when nginx, frontend, backend and
  pinggy are all down, because the request never reaches the origin.
  `scripts/monitor-prod.sh` hard-codes `www` for exactly this reason.
- **`curl -fsS https://api.simonrowe.dev/actuator/health` returns 404 and is not
  a valid check.** The actuator runs on a separate management port
  (`MANAGEMENT_SERVER_PORT: 8081` in prod, `8082` locally) which is neither
  published to the host nor proxied by nginx — nginx only maps
  `api.simonrowe.dev → backend:8080`. Use a real API route
  (`/api/blogs`) for backend liveness from outside, and the compose health column
  in `status-prod.sh` (whose healthcheck does hit `:8081/actuator/health` inside
  the container) for the actuator view.
- `/mcp` is served by `frontend/nginx.conf` as a `location = /mcp` that branches
  on method: `GET` rewrites to the SPA `index.html`, anything else proxies to
  `backend:8080/mcp` (Streamable-HTTP JSON-RPC, `proxy_buffering off`). A `200`
  on `GET` only proves the SPA route; exercise a POST if you changed MCP tools.
- Finally spot-check a blog page in a browser: images render (they come from the
  `backend-uploads` volume, not the image) and dates are present. With browser
  automation (Playwright MCP in Claude Code) navigate and screenshot it;
  otherwise print the URL and ask Simon to eyeball it.

## Gotchas

- `pinggy` publishes the only ingress. One `PINGGY_TOKEN` = one active tunnel; if
  another host holds it you get `A tunnel with the same token is already active`.
  See `prod-triage`.
- nginx will refuse to boot (`host not found in upstream`) if any of `frontend`,
  `backend`, `portainer`, `langfuse` is not running — and that also takes
  Portainer offline. Never restart prod nginx in isolation without checking all
  four.
- Don't remove `JAVA_TOOL_OPTIONS: -Xshare:off` from the backend service. It
  disables Class Data Sharing to dodge an aarch64 G1GC SIGSEGV crash.
- Only `backend`, `frontend` and `nginx` are in the redeploy service list. New
  services (searxng, langfuse, alloy…) need a real `up -d` on the Pi.
- The nightly backup runs 22:00 Europe/London and holds the data-operations lock;
  a `redeploy` POST in that window can 409.
- `docker-compose.prod.yml`, `.env`, `frontend/nginx.conf` and
  `config/nginx/nginx-proxy.conf` are bind-mounted from the Pi's checkout —
  changes to them require `git pull` there.

## Related skills

- `prod-triage` — the site is down or broken after a deploy.
- `prod-logs` — reading backend/nginx logs to confirm a fix landed.
- `prod-backup-ops` — take a backup before a risky deploy.
- `prod-data-restore` — the same Data Operations controller as `/redeploy`.
