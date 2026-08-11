# Manual additions

> Maintained in simonjamesrowe/agent-setup — edit there.

- The `pinggy` tunnel is single-tenant per `PINGGY_TOKEN`: if another host still holds the tunnel, reclaim it by appending `+force` to the token value (`PINGGY_TOKEN=<token>+force`).
- On macOS, running the production compose file under OrbStack requires overriding `DOCKER_BINARY_PATH=/opt/homebrew/bin/docker` and `DOCKER_PLUGINS_PATH=~/.docker/cli-plugins`, since the compose defaults assume a Linux Docker install.
- There is a management-port mismatch between environments: `docker-compose.prod.yml` sets `MANAGEMENT_SERVER_PORT: 8081`, while `application.yml` defaults `management.server.port` to `8082`; local health checks should target `8082` unless an env override is in effect.
- The README's backup/restore instructions are stale: `scripts/create-backup.sh`, `scripts/restore-backup.sh`, and `scripts/migrate-strapi-data.js` no longer exist in the repo — use `scripts/backup.sh` and `scripts/restore.sh` instead.
- The backend exposes a self-redeploy endpoint, `POST /api/admin/data-operations/redeploy`, which pulls the backend, frontend, nginx and software-factory images and restarts the backend container via an ephemeral `docker:cli` helper container (since the backend can't safely recreate its own running container). `software-factory` is restarted on its own with `--no-deps` and best-effort: it declares `temporal` and `mongodb` as `service_healthy` dependencies, and a failure appends `WARNING: could not restart software-factory` to the completion message rather than aborting the redeploy.
- Never restart prod nginx unless all four upstreams (frontend, backend, portainer, langfuse) are running — this is duplicated here deliberately, as it is the highest-cost gotcha in the stack.
