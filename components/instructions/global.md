# simonjamesrowe / simonrowe.dev

This section applies when working in repos under the `simonjamesrowe` GitHub
org (the simonrowe.dev monorepo and its satellites). Ignore it in other repos.

## Environment map

- https://simonrowe.dev — the site (React frontend)
- https://api.simonrowe.dev — Spring Boot backend (`/actuator/health`, `/api/blogs`, `/api/profile`; management port 8081 in prod, 8082 default locally)
- https://console.simonrowe.dev — Portainer (container management)
- https://langfuse.simonrowe.dev — Langfuse (prod runs v3: LLM traces flow via Alloy's `ai_only` filter; local compose is still v2 with no OTLP ingest — expect no local traces)
- Grafana Cloud Loki — prod container logs (`logs-prod-035.grafana.net`, query by `container` label)
- Production host: Raspberry Pi (ARM64) running `docker-compose.prod.yml`, ingress via Cloudflare → pinggy tunnel → nginx. **No SSH access from this machine**: emit a single copy-paste command block for Simon to run on the Pi and ask for the output.
- Images: `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-{backend,frontend}` — pushed by the "Publish" GitHub Actions workflow on merge to main; the Pi pulls (no push deploy).

## Non-negotiables

- **Credentials come from env files** (`.env` in the repo, sourced from `~/workspace/simonjamesrowe/env`). Admin identity is `admin@simonrowe.dev`; the password is in env. Never ask for or echo credential values.
- **Mongock-first**: any production data change ships as a Mongock change unit in the backend, not an ad-hoc script.
- **Data restores go through the admin Data Ops UI** (browser automation), not raw mongorestore against prod data.
- **Backups**: full-with-media only; retain the last 7.
- **Never restart prod nginx** unless all four upstreams (frontend, backend, portainer, langfuse) are running — nginx aborts at boot if any upstream is down, taking Portainer with it.

## Git conventions (this org)

Conventional commits and branch prefixes (`feat/`, `fix/`, `chore/`). No Jira
ticket references. CI must be green before merge; branches auto-delete on merge.

## Installed skills

Reach for these before improvising:

- `prod-data-restore` — restore the latest prod backup into a local environment
- `prod-deploy` — ship a merge to production and verify it
- `prod-logs` — fetch prod logs (Loki, Portainer, docker compose)
- `prod-triage` — site down / broken page runbook
- `prod-backup-ops` — trigger and verify backups
- `local-env` — start/stop/verify the local stack (Conductor port contention)
- `backend-test` — gradle test/checkstyle incantations and the pre-commit hook
- `mongock-migration` — scaffold a data migration the right way
- `content-source-add` — add a content-aggregation scraper source
- `chat-e2e-verify` — browser-driven chatbot quality pass
- `langfuse-verify` — check LLM trace plumbing end-to-end
