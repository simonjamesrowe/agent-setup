---
name: local-env
description: Start, stop and verify the simonrowe.dev local development environment. Use when running the app locally, tests need infrastructure, or ports conflict between Conductor workspaces.
---

# Local Development Environment

The local stack is three layers: a `docker-compose.yml` infrastructure stack, a
Spring Boot backend run with `gradlew bootRun`, and a Vite dev server. All of it
binds **fixed host ports**, which is the single biggest source of trouble because
Conductor workspaces are separate checkouts of the same repo competing for those
same ports.

Everything below assumes `~/workspace/simonjamesrowe/simonrowe-dev-monorepo`
(or a Conductor workspace clone of it) as the working directory.

| Service | Host port | Notes |
| --- | --- | --- |
| backend | `8080` | `gradlew bootRun`, `server.port: 8080` |
| backend actuator | `8082` | `management.server.port: 8082` — separate port |
| frontend | `5173` | Vite, `strictPort: true` |
| mongodb | `27017` | `mongo:8`, db `simonrowe` |
| kafka | `9092` | `confluentinc/cp-kafka:7.8.0`, KRaft single node |
| elasticsearch | `9200` | `elasticsearch:8.17.0`, security disabled |
| langfuse | `3000` | `langfuse/langfuse:2.95.1` + a `langfuse-db` postgres |

## When to use

- Running the app locally to see a change, or to drive the admin UI.
- A test or script needs real MongoDB / Elasticsearch / Kafka. (Backend *unit and
  integration tests do not* — see `backend-test`.)
- `bootRun` fails on a bound port, Vite exits with a port error, or two Conductor
  workspaces are fighting over the stack.
- Before a data restore (`prod-data-restore`) or a change-unit verification run
  (`mongock-migration`), both of which need the stack up.

## Prerequisites

- Docker running (OrbStack or Docker Desktop) and `docker compose` v2 available.
- Java 21 toolchain (Gradle resolves it) and Node 20+ with `npm`.
- **Env files.** `scripts/start-backend.sh` and `scripts/start-frontend.sh` both
  hard-fail with `Error: <path> not found` and `exit 1` if their `.env` is
  missing. The source of truth is the private env file
  `~/workspace/simonjamesrowe/env`; never inline secret values into commands or
  skills, refer to variable names only.

  ```bash
  cp ~/workspace/simonjamesrowe/env backend/.env
  cp ~/workspace/simonjamesrowe/env frontend/.env
  cp ~/workspace/simonjamesrowe/env .env      # root: compose interpolation
  ```

  Conductor automates this: `conductor.json`'s `setup` copies that file to all
  three locations. `.conductor/settings.local.toml` has a second, older `setup`
  that copies only `backend/.env` and `frontend/.env` — if you used that path, add
  the root `.env` by hand or compose will warn about unset `NEXTAUTH_SECRET`,
  `SALT`, `ENCRYPTION_KEY`, `AUTH_AUTH0_*` and start Langfuse broken.

## Workflow

### 1. Free the shared ports first (Conductor contention)

Fixed ports plus multiple workspaces means **only one stack may run at a time**.
Check before starting anything:

```bash
lsof -ti:8080 -ti:5173 -ti:27017 -ti:9200 -ti:9092 -ti:3000
```

Any PID here means something already holds a port. Identify the owner, then stop
it *in its own workspace* so its compose project comes down with it:

```bash
lsof -i:8080 -sTCP:LISTEN            # PID + command
ps -o command= -p "$(lsof -ti:8080)" # which checkout it came from
docker compose ls                    # which compose projects are up
```

The compose project name is derived from the directory name, so each workspace
gets its own project and its own volumes — `docker compose down` in workspace A
will not touch workspace B's containers, but the published ports still collide.

```bash
cd <other-workspace> && ./scripts/stop.sh
```

### 2. Start the infrastructure

```bash
docker compose up -d --wait
```

Brings up all five services: `mongodb`, `kafka`, `elasticsearch`, `langfuse-db`,
`langfuse`. `--wait` blocks until the healthchecks pass (mongodb, kafka and
elasticsearch each define one; the two Langfuse services only have to reach
`running`). Expect 30–60s on a cold start, mostly Elasticsearch.

```bash
docker compose ps                     # State + health per service
docker compose logs -f elasticsearch  # when --wait times out
```

### 3. Start backend and frontend

Both at once, with cleanup on exit:

```bash
./scripts/start.sh
```

That script runs `docker compose up -d --wait` itself, then launches
`start-backend.sh` and `start-frontend.sh` as background jobs and installs
`trap '"$SCRIPT_DIR/stop.sh"' EXIT INT TERM` — so `Ctrl-C` (or the process dying)
takes the backend, the frontend **and the whole compose stack** down. It is the
right choice for an interactive session, the wrong one for an agent that wants
long-lived services.

For separate terminals or long-lived services, run them individually:

```bash
./scripts/start-backend.sh    # sources backend/.env, exports UPLOADS_PATH=uploads/, exec ../gradlew bootRun
./scripts/start-frontend.sh   # npm install --silent, then npm run dev
```

Both `exec` into their long-running process, so each occupies its terminal.
Neither one starts infrastructure — do step 2 first.

### 4. Verify

```bash
curl -fsS http://localhost:8082/actuator/health          # actuator, port 8082
curl -fsS http://localhost:8080/api/blogs | head -c 200  # app on 8080
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:5173
curl -fsS 'http://localhost:9200/_cat/indices?v'
```

`show-details: always` and `show-components: always` are set, so the actuator
health body names the failing component. Kafka and Elasticsearch health
indicators are **enabled** in the default profile, so a missing container shows
up as `DOWN` there.

Langfuse UI is `http://localhost:3000` (Auth0 SSO, or the
`LANGFUSE_INIT_USER_EMAIL` / `LANGFUSE_INIT_USER_PASSWORD` admin).

An empty local database is normal on a fresh volume — see `prod-data-restore`.

### 5. Stop

```bash
./scripts/stop.sh
```

Kills whatever listens on `8080` and `5173` (`lsof -ti:<port> | xargs kill`) and
then runs `docker compose down`. It reports `not running` rather than failing, so
it is safe to run when nothing is up, and it is the correct thing to run in every
*other* workspace before starting this one.

`docker compose down` keeps the named volumes (`mongodb-data`, `kafka-data`,
`elasticsearch-data`, `elasticsearch-backups`, `langfuse-db-data`), so data
survives a restart. `docker compose down -v` wipes them — you then need a
restore.

## Gotchas

- **`stop.sh` kills by port, not by PID.** `lsof -ti:8080 | xargs kill` will kill
  *any* process on 8080, including another workspace's backend or an unrelated
  app. Know what is on the port before running it.
- **Vite sets `strictPort: true`.** It will not silently move to 5174; it exits.
  That is deliberate — the backend's `cors.allowed-origins` defaults to
  `http://localhost:5173` and the Vite proxy hard-codes `localhost:8080`.
- **The backend actuator is not on 8080.** `curl localhost:8080/actuator/health`
  returns 404. Use `8082` locally (prod uses `MANAGEMENT_SERVER_PORT: 8081`).
- **The start scripts' error message is stale**: it says "copy `~/workspace/env`",
  but the real path is `~/workspace/simonjamesrowe/env` (what `conductor.json`
  uses). Follow the path in the Prerequisites above.
- **Root `.env` is only for compose interpolation** (Langfuse secrets and
  `LANGFUSE_DB_*`); the backend reads `backend/.env` via `start-backend.sh`, not
  the root file. Missing root `.env` = Langfuse boots without `NEXTAUTH_SECRET`
  and the compose command prints `variable is not set` warnings.
- **Mongock runs at every backend boot** against local MongoDB. A brand-new
  volume replays every change unit; `MONGOCK_ENABLED=false` skips them. See
  `mongock-migration`.
- **`start-frontend.sh` runs `npm install` every time** (not `npm ci`), so a
  lockfile drift shows up here rather than in CI.
- **`UPLOADS_PATH=uploads/`** is exported by `start-backend.sh` relative to
  `backend/`, so uploaded media lands in `backend/uploads/`. Running `bootRun`
  from the repo root instead uses the `application.yml` default
  `backend/uploads/` — same place, different relative base. Prefer the script.
- **Don't run the prod compose file locally by habit.** `docker-compose.prod.yml`
  is a different, much larger stack (Langfuse v3 with ClickHouse/Redis/MinIO,
  nginx, pinggy). See `prod-deploy`.

## Related skills

- `backend-test` — tests use Testcontainers and need none of this running.
- `mongock-migration` — verifying a change unit against the local stack.
- `prod-data-restore` — filling an empty local database with prod-shaped data.
- `prod-deploy` — the production stack, ports and compose file.
- `prod-logs` — reading backend logs (locally they go to the `bootRun` console).
