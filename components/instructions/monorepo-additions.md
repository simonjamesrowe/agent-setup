# Manual additions

> Maintained in simonjamesrowe/agent-setup — edit there.

- The `pinggy` tunnel is single-tenant per `PINGGY_TOKEN`: if another host still holds the tunnel, reclaim it by appending `+force` to the token value (`PINGGY_TOKEN=<token>+force`).
- On macOS, running the production compose file under OrbStack requires overriding `DOCKER_BINARY_PATH=/opt/homebrew/bin/docker` and `DOCKER_PLUGINS_PATH=~/.docker/cli-plugins`, since the compose defaults assume a Linux Docker install.
- There is a management-port mismatch between environments: `docker-compose.prod.yml` sets `MANAGEMENT_SERVER_PORT: 8081`, while `application.yml` defaults `management.server.port` to `8082`; local health checks should target `8082` unless an env override is in effect.
- Use `prod-data-restore` for application restores through the admin Data Ops UI. Platform Postgres/ClickHouse restores use `docs/runbooks/platform-backup-restore.md`; local snapshot scripts are a separate workflow.
- Deployment is handled by software-factory/deployer, not a backend self-redeploy endpoint. Use `prod-deploy` and the checkout's `docs/runbooks/deploy.md`.
- Use Raspberry Pi Connect's browser remote shell for host checks (`prod-triage` has the shared access procedure); manual copy-paste is the fallback.
- Check nginx/upstream health and the deployed DNS configuration before a restart; current nginx uses runtime upstream resolution, while older static configurations had an all-upstreams boot dependency.
- When adding form fields to an API that reconstructs a full resource from the request payload (whole-document update), write a test that saves with the field unchanged and asserts it survives the round trip — omitted request fields silently dropping saved data is the failure mode to catch.
