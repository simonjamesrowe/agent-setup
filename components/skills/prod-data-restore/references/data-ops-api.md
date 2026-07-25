# Data Operations API

Source of truth:
`backend/src/main/java/com/simonrowe/dataops/DataOperationsController.java`.

All endpoints are under **`/api/admin/data-operations`**.

- Local base URL: `http://localhost:8080`
- Production base URL: `https://api.simonrowe.dev`

## Authentication

`SecurityConfig` guards `/api/admin/**` with `.hasRole("DEV_PORTAL_ADMIN")`, over
an Auth0 JWT (OAuth2 resource server, issuer `https://dev-igsu3mpz.us.auth0.com/`,
audience `https://api.simonrowe.dev`). Sessions are stateless; CSRF is disabled.

Send `Authorization: Bearer <token>`.

Getting a token: the Auth0 application is a **public SPA client**, so there is no
client-credentials shortcut. Log in to the admin UI as `admin@simonrowe.dev`
(password from the env repo — never inline it) and lift the bearer token from any
`/api/admin/**` request's `Authorization` header. With browser automation
(Playwright MCP in Claude Code) read it from the network log; otherwise print the
manual steps (DevTools → Network → any admin request → Request Headers) and ask
for the token. Export it as `ADMIN_JWT` for the examples below.

```bash
AUTH="Authorization: Bearer $ADMIN_JWT"
BASE=http://localhost:8080/api/admin/data-operations
```

## Endpoints

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/status` | – | Current/last operation state. No Drive requirement. |
| GET | `/progress` | – | `text/event-stream` (SSE) progress feed. |
| GET | `/backups` | – | Lists Drive backups. Requires Drive. |
| POST | `/backup` | – | Starts a full backup. Requires Drive. **No query params.** |
| POST | `/restore` | `{"backupFileId":"<id>"}` | Requires Drive. `backupFileId` mandatory. |
| POST | `/clear` | `{"confirmationPhrase":"DELETE ALL DATA"}` | Exact phrase or 400. |
| POST | `/rebuild-index` | – | Site index then blog index. |
| POST | `/reembed` | – | Blogs, jobs, skills, code examples, articles, events. |
| POST | `/redeploy` | – | Pulls + restarts `backend`, `frontend`, `nginx`. |

Every `POST` returns **202 Accepted** with the started `DataOperation` and runs
asynchronously — track it via `/progress` or `/status`.

## Status codes

- **202 Accepted** — operation started (all POSTs).
- **400 Bad Request** — `backupFileId` blank, or `confirmationPhrase` is not
  exactly `DELETE ALL DATA`.
- **401 / 403** — missing/expired token, or the token lacks `DEV_PORTAL_ADMIN`.
- **409 Conflict** — "Another data operation is already in progress". One at a
  time, globally.
- **503 Service Unavailable** — Google Drive not connected (`/backups`,
  `/backup`, `/restore`), or Docker socket not reachable (`/redeploy`).
- **500** — Drive listing failed.

## Examples

List backups, newest first:

```bash
curl -fsS -H "$AUTH" "$BASE/backups"
```

```json
[
  {
    "fileId": "1AbC...",
    "fileName": "backup-20260725-210004.zip",
    "createdAt": "2026-07-25T21:00:04Z",
    "fileSize": 264241152,
    "fileSizeFormatted": "252.0 MB"
  }
]
```

Restore the newest backup:

```bash
FILE_ID=$(curl -fsS -H "$AUTH" "$BASE/backups" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["fileId"])')

curl -fsS -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"backupFileId\":\"$FILE_ID\"}" "$BASE/restore"
```

Follow progress (SSE — stream, do not expect it to exit):

```bash
curl -N -H "$AUTH" "$BASE/progress"
```

Poll instead of streaming:

```bash
curl -fsS -H "$AUTH" "$BASE/status"
```

Take a backup:

```bash
curl -fsS -X POST -H "$AUTH" "$BASE/backup"
```

Rebuild index / re-embed:

```bash
curl -fsS -X POST -H "$AUTH" "$BASE/rebuild-index"
curl -fsS -X POST -H "$AUTH" "$BASE/reembed"
```

Clear all data (destructive; Drive backups are untouched):

```bash
curl -fsS -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"confirmationPhrase":"DELETE ALL DATA"}' "$BASE/clear"
```

Redeploy production:

```bash
curl -fsS -X POST -H "$AUTH" \
  https://api.simonrowe.dev/api/admin/data-operations/redeploy
```

## Google Drive configuration

`GoogleDriveConfig` builds the Drive client from OAuth2 **user** credentials
(Simon's personal Google account, drive scope `https://www.googleapis.com/auth/drive`),
not a service account. Env var names:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

If any of the first three is blank the Drive bean is `null`, the backend logs a
warning at startup, and Drive-backed endpoints return 503.

One-time refresh-token bootstrap (Desktop-app OAuth client, out-of-band code):

```bash
./scripts/google-drive-auth.sh "$GOOGLE_DRIVE_CLIENT_ID" "$GOOGLE_DRIVE_CLIENT_SECRET"
```

It prints an authorization URL, takes the pasted code, and returns the refresh
token to store in the env repo.

## Archive layout

A backup ZIP produced by `BackupService`:

```
manifest.json                            # version 1.1, createdAt, per-collection doc counts
collections/<name>.json                  # 13 collections, MongoDB extended JSON
uploads/**                               # every regular file under the uploads dir
embeddings/content-embeddings.json       # Elasticsearch vector export (best-effort)
```

The 13 collections: `blogs`, `tags`, `skills`, `skill_groups`, `jobs`,
`profiles`, `social_medias`, `tourSteps`, `media_assets`, `code_examples`,
`aggregated_articles`, `aggregated_events`, `content_sources`.

`RestoreService` imports them in `@DBRef` dependency order — independent
(`tags`, `skills`, `profiles`, `social_medias`, `tourSteps`, `media_assets`,
`content_sources`, `aggregated_articles`, `aggregated_events`) before dependent
(`skill_groups`, `jobs`, `blogs`, `code_examples`) — dropping each collection
before inserting. A collection missing from the archive is skipped with a warning.

If a ZIP has no `uploads/**` entries, `RestoreService` reads a `mediaSource`
field from `manifest.json` and pulls media from that named earlier backup in the
Drive folder. Current backups always embed their own uploads, so this path only
matters for older archives — but it means **deleting an old backup can orphan a
newer one's media**. See `prod-backup-ops` before pruning by hand.

## Redeploy internals

`redeploy` config lives in `application.yml` under `redeploy:`
(`compose-file: /workspace/docker-compose.prod.yml`,
`project-name: simonrowe-dev-monorepo`, `services: [backend, frontend, nginx]`,
`docker-binary: docker`, `self-restart-delay-seconds: 5`,
`helper-image: docker:cli`).

Sequence: pull each service image → pull `docker:cli` → `up -d frontend nginx` →
mark the operation complete → after 5 seconds, launch an ephemeral
`docker:cli` container named `backend-restarter` that runs
`docker compose up -d --force-recreate --no-deps backend` and then
`docker start simonrowe-dev-monorepo-backend-1`. The helper container exists
because recreating the backend would otherwise kill the compose process running
inside it. Individual docker commands time out after 5 minutes.
