---
name: prod-data-restore
description: Restore the latest simonrowe.dev production backup (Google Drive) into a local environment via the admin Data Ops UI. Use when local data is stale, missing, or a bug needs prod-like data to reproduce.
---

# Restore Production Data Into Local

Pulls the newest production backup out of Google Drive and imports it into the
local MongoDB / uploads / Elasticsearch, using the backend's own Data Operations
pipeline. Always prefer this over hand-rolled mongo commands: the pipeline
handles `@DBRef` ordering, takes a safety backup, and rebuilds search state.

## When to use

- Local content is empty or months behind prod and you need real blogs, jobs,
  skills, tags or media to work against.
- Reproducing a bug that only shows up with production-shaped data.
- After `Clear All Data`, or after a schema/migration change you want to re-run
  against a realistic dataset.
- **Not** for restoring *into* production — that is the same API, but treat it as
  a production change and take a fresh backup first (see `prod-backup-ops`).

## Prerequisites

- Repo at `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` (or a Conductor
  workspace clone of it).
- `backend/.env` and `frontend/.env` present (copied from the private env repo).
  The backend reads Google Drive credentials from these env var names:
  `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
  `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`
  (mapped to `google.drive.*` in `backend/src/main/resources/application.yml`).
  If they are missing the backend logs a warning at boot and every backup /
  restore / list call returns **503**.
- One-time only, if there is no refresh token yet:
  `./scripts/google-drive-auth.sh "$GOOGLE_DRIVE_CLIENT_ID" "$GOOGLE_DRIVE_CLIENT_SECRET"`
  then store the printed refresh token in the env repo as
  `GOOGLE_DRIVE_REFRESH_TOKEN`.
- Admin identity: `admin@simonrowe.dev` with the `DEV_PORTAL_ADMIN` Auth0 role.
  The password lives in the env repo — never inline it, read it from the
  environment.

## Workflow

### 1. Get the local stack running

Bring up infrastructure, backend and frontend — port deconfliction between
Conductor workspaces and the individual start/stop scripts are all covered in
`local-env`.

Confirm the backend is up and Drive is connected before going further:

```bash
curl -fsS http://localhost:8082/actuator/health          # management port, local
curl -fsS -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:8080/api/admin/data-operations/status
```

(see [Alternatives](#alternatives) for how to obtain `$ADMIN_JWT`)

### 2. Open the Data Ops UI and sign in

Target page: `http://localhost:5173/admin/data-operations`.

With browser automation (Playwright MCP in Claude Code): navigate there, click
the Auth0 login, and sign in as `admin@simonrowe.dev` with the password read
from the environment. Otherwise print these manual steps for the user and wait:

1. Open `http://localhost:5173` and log in as `admin@simonrowe.dev`.
2. Go to **Admin** → **Data Operations**.
3. Report back what the **Available Backups** panel lists.

### 3. List the backups and pick the newest

The **Available Backups** panel shows one row per Drive file: file name
(`backup-YYYYMMDD-HHmmss.zip`, UTC), created date, and formatted size. The
newest row is the nightly job's output and should be less than 24 hours old.
If the panel says "No backups found in Google Drive", stop — that is a backup
problem, not a restore problem; go to `prod-backup-ops`.

### 4. Restore it

Click **Restore** on the newest row, then confirm in the **Confirm Restore**
dialog (it warns that all current data will be replaced with that archive).

What the backend actually does, in order:

1. Creates a **local safety backup** ZIP of the current data first
   (`BackupService.createLocalBackup()`, a temp file — it is *not* uploaded to
   Drive, and it is deleted when the operation finishes).
2. Downloads the archive from Drive and validates it has `manifest.json` and a
   `collections/` directory.
3. Drops and re-inserts each collection in **`@DBRef` dependency order** —
   independent first: `tags`, `skills`, `profiles`, `social_medias`,
   `tourSteps`, `media_assets`, `content_sources`, `aggregated_articles`,
   `aggregated_events`; then dependent: `skill_groups`, `jobs`, `blogs`,
   `code_examples`.
4. Clears the uploads directory and extracts `uploads/**` from the archive.
5. Runs `fullSyncSiteIndex()` + `fullSyncBlogIndex()` (Elasticsearch).
6. Imports `embeddings/content-embeddings.json` if the archive has one.

**Never** substitute `mongorestore` / `mongosh` for this flow. A raw dump
restore skips the dependency ordering, the safety backup, the uploads sync and
the index/embedding rebuild, and leaves dangling `@DBRef`s that surface as
half-rendered blogs and empty skill groups.

### 5. Watch progress

The UI subscribes to `GET /api/admin/data-operations/progress`, a
`text/event-stream` SSE endpoint, and renders the message + percentage. Leave
the page open — closing it does not cancel the operation, but you lose the live
feed and have to poll `GET /status` instead.

Expect roughly: safety backup 5% → download 15% → validate 25% → collections
30–65% → media 70% → search index 80% → embeddings 90% → done.

### 6. Rebuild index and re-embed

Once the restore reports success, trigger the two follow-ups from the same page:

1. **Rebuild Search Index** (`POST /rebuild-index`) — site index then blog index.
2. **Re-embed Content** (`POST /reembed`) — blogs, jobs, skills, code examples,
   articles, events.

The restore already rebuilt the search index and imported embeddings, so these
are cheap re-assurance in the normal case — but they are **required** when the
archive contained no `embeddings/content-embeddings.json` (the backend logs
`No vector embeddings found in backup` when that happens), otherwise chat and
semantic search return nothing.

### 7. Verify

```bash
curl -fsS http://localhost:8080/api/blogs | head -c 400
curl -fsS 'http://localhost:9200/_cat/indices?v'
```

Then load `http://localhost:5173`, open a blog page, and check images render and
dates are present.

## Alternatives

**API instead of the UI** — when the SPA is broken or you want this scripted, every
operation is available over HTTP under `/api/admin/data-operations`. See
[references/data-ops-api.md](references/data-ops-api.md) for the full endpoint
list, auth, status codes and `curl` examples.

**Local tarball snapshots** — separate, local-only, and much faster for
"snapshot before I break something" loops. Not connected to Drive:

```bash
./scripts/backup.sh    # writes ~/backups/backup-<UTC timestamp>.tar.gz
./scripts/restore.sh   # restores the newest ~/backups/backup-*.tar.gz
```

Each tarball is a `mongodump` of the `simonrowe` database + `backend/uploads` +
a real Elasticsearch filesystem snapshot (repo `simonrowe_backup`). Both scripts
find the containers by image (`mongo:8`, `elasticsearch:8.17.0`), so the compose
stack must be up. **Restart the backend after `./scripts/restore.sh`** — it uses
`mongorestore --drop` underneath and the running app caches state.

## Gotchas

- **503 on `/backups`, `/backup` or `/restore`** = Google Drive is not connected.
  Check the four `GOOGLE_DRIVE_*` env vars reached the backend process.
- **409 on any POST** = another data operation is already in progress. Only one
  runs at a time; poll `GET /status` and wait it out.
- The nightly backup job runs at 22:00 Europe/London. Starting a restore inside
  that window can lose the race and 409.
- The safety backup is a temp file that is deleted in the `finally` block. It is
  a crash cushion for the operation, not a restore point you can come back to —
  take `./scripts/backup.sh` first if you care about the current local data.
- The uploads directory is **wiped** before media is extracted. Anything you
  uploaded locally and never backed up is gone.
- Prod uploads path is `/workspace/uploads`; locally it is `backend/uploads/`
  (`UPLOADS_PATH=uploads/` relative to the backend CWD, exported by
  `start-backend.sh`). A restore respects whichever the running process uses.
- `POST /clear` needs the confirmation phrase exactly `DELETE ALL DATA`, and it
  does **not** touch Drive backups.
- Auth0 tokens are short-lived. A restore that runs for minutes is fine (it is
  async, server-side), but your next admin call may need a fresh token.

## Related skills

- `prod-backup-ops` — taking, verifying and pruning the Drive backups this skill consumes.
- `local-env` — starting, stopping and port-deconflicting the local stack.
- `prod-deploy` — shipping to prod; `POST /redeploy` lives on the same controller.
- `prod-logs` — reading backend logs when a restore fails.
- `prod-triage` — when prod itself, not local data, is the problem.
