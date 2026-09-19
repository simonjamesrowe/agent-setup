---
name: local-env
description: Start, stop and verify the simonrowe.dev local development environment. Use when running the app locally, tests need infrastructure, or ports conflict between Conductor workspaces.
---

# Run the local environment

Work in the intended monorepo checkout. Read its compose file, start/stop scripts,
frontend proxy and backend configuration before starting services. Defaults are
backend 8080, management 8082, frontend 5173, MongoDB 27017, Kafka 9092,
Elasticsearch 9200, Langfuse 3000 and Alloy OTLP 4317; inspect Temporal and any
additional published ports in the current compose file too.

## Prepare and start

1. Check Docker, Node and the declared Java toolchain (currently Java 25).
   Backend tests use Testcontainers; they need Docker but not this full stack.
2. Check `.env`, `backend/.env` and `frontend/.env`. On this Mac their source is
   `~/workspace/simonjamesrowe/env`. Copy missing files without printing values.
   Check Conductor's effective TOML settings / Files to copy; do not assume the
   legacy `conductor.json` setup ran. Use the bundled Conductor skill for changes
   to that setup. TOML settings take precedence over legacy JSON.
3. Identify existing port owners with `lsof` and `docker compose ls`. Fixed ports
   are shared across workspaces even when compose projects/volumes differ.
   Coordinate before stopping another workspace's services.
4. Start infrastructure with `docker compose up -d --wait`. Inspect
   `docker compose ps` and bounded logs if readiness fails.
5. Run `./scripts/start-backend.sh` and `./scripts/start-frontend.sh` in persistent
   terminals. `./scripts/start.sh` is an interactive alternative; its exit trap
   stops the whole stack. Read the scripts rather than assuming detached jobs
   survive the agent command that launched them.

## Verify

Check management health, `/api/blogs`, the frontend, and search using the actual
configured ports. Open the changed page in a browser. For an empty database, use
`prod-data-restore` only when realistic data is needed.

Local Langfuse now runs v3 with worker, Postgres, ClickHouse, Redis, MinIO and
Alloy. `config/alloy/config.local.alloy` forwards local traces to it. Use
`langfuse-verify` with `LANGFUSE_HOST=http://localhost:3000`; its script otherwise
defaults to production. Check root `.env` for compose secrets and backend `.env`
for backend settings — having one does not supply the other.

## Stop

Read `scripts/stop.sh` before running it: it kills by ports 8080/5173, so it can
kill another workspace's processes. Confirm ownership, then stop this workspace's
processes and run compose down in its project. Keep named volumes unless data
removal was requested. `down -v` discards the data.

Vite's strict port and backend CORS/proxy configuration must agree. Changing one
port alone is insufficient. Keep production compose/tunnel credentials out of
routine local startup.
