---
name: prod-backup-ops
description: Trigger, verify and manage simonrowe.dev production backups to Google Drive. Use when checking backup health, taking a pre-change backup, or pruning old backups.
---

# Production Backup Operations

Production data is backed up to Google Drive by the backend itself: a nightly
scheduled job plus an on-demand button/endpoint, with automatic retention
pruning. This skill covers taking a backup, proving the nightly job is healthy,
and pruning safely.

## When to use

- Before a risky deploy, migration or data change — take a fresh backup first.
- Auditing backup health ("when did we last have a good backup?").
- The Drive folder is filling up and you want to prune.
- Someone asks whether a given day's data is recoverable.
- Restoring **from** a backup is the other skill: `prod-data-restore`.

## Prerequisites

- Admin identity `admin@simonrowe.dev` holding the Auth0 `DEV_PORTAL_ADMIN` role
  (`SecurityConfig` guards `/api/admin/**` with `.hasRole("DEV_PORTAL_ADMIN")`).
  Password from the env repo — never inline it.
- Backend Google Drive credentials, by env var name:
  `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
  `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`. If any of the first
  three is blank the Drive bean is `null` and every Drive endpoint returns
  **503**.
- These are **OAuth2 user credentials for Simon's personal Google account**
  (scope `https://www.googleapis.com/auth/drive`), *not* a service account — so
  the quota consumed is his personal Drive quota, and revoking the app's access
  in his Google account breaks backups.
- For API calls, an admin bearer token exported as `ADMIN_JWT` (see
  `prod-data-restore/references/data-ops-api.md` for how to obtain one).

## Workflow

### 1. Check backup health

```bash
BASE=https://api.simonrowe.dev/api/admin/data-operations
curl -fsS -H "Authorization: Bearer $ADMIN_JWT" "$BASE/backups" \
  | python3 -m json.tool | head -40
```

`GET /backups` lists the Drive folder's backup files, newest first, each with
`fileId`, `fileName` (`backup-YYYYMMDD-HHmmss.zip`, UTC), `createdAt`,
`fileSize` and `fileSizeFormatted`.

**The newest entry must be less than 24 hours old.** `BackupScheduler` runs a
full backup on cron `0 0 22 * * *` in zone `Europe/London` (22:00 local, both
overridable via `backup.schedule.cron` / `backup.schedule.zone`). If the newest
file is older than that, the job is failing — the scheduler skips silently when
Drive is not connected or another data operation is in progress, so check the
backend log (see step 5).

Also sanity-check the **size**: a full backup is dominated by `uploads/`, so a
sudden drop of an order of magnitude means media went missing, not that the
backup got efficient.

Via the UI instead: `https://www.simonrowe.dev/admin/data-operations` → the
**Available Backups** panel lists the same rows. With browser automation
(Playwright MCP in Claude Code) log in as `admin@simonrowe.dev` and read the
table; otherwise print those steps and ask Simon for what he sees.

### 2. Take an on-demand backup

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_JWT" "$BASE/backup"
```

Returns **202 Accepted** and runs asynchronously. Follow it:

```bash
curl -N -H "Authorization: Bearer $ADMIN_JWT" "$BASE/progress"   # SSE
curl -fsS -H "Authorization: Bearer $ADMIN_JWT" "$BASE/status"   # poll
```

Or in the UI: **Backup to Google Drive** card.

**Policy: full-with-media only.** There is no partial or metadata-only mode —
`POST /backup` takes **no query parameters at all** (`DataOperationsController.startBackup()`
is parameterless), and `BackupService.performBackup()` unconditionally includes
collections, uploads and embeddings. If you have seen
`POST /backup?includeMedia=true` written down, the query string is simply ignored;
the behaviour it asks for is the only behaviour there is.

Progress milestones: collections 10–60% → media 60% → embeddings 70% → manifest
75% → Drive upload 80–95% (with a live "Uploading… N% (x / y)" message) →
complete, ending with a summary like
`13 collections, 412 documents, 268 media files backed up (252.0 MB)`.

Upload speed is tuned in `GoogleDriveService` (Apache5 transport, TCP_NODELAY,
1 MB socket buffers, 5-minute per-request read timeout) because the defaults
capped the Pi's residential uplink at ~5 KB/s. The resumable **upload** chunk
size is 1 MB (`GoogleDriveService.UPLOAD_CHUNK_SIZE_BYTES`); 10 MB is the
**download** chunk size, also in `GoogleDriveService`, not `GoogleDriveConfig`.
A large backup taking several minutes is normal.

### 3. Know what is in a backup

The archive is a single ZIP:

```
manifest.json                            # version 1.1, createdAt, per-collection doc counts
collections/<name>.json                  # 13 collections, MongoDB extended JSON
uploads/**                               # every regular file under the uploads dir
embeddings/content-embeddings.json       # Elasticsearch vector export (best-effort)
```

The **13 collections**: `blogs`, `tags`, `skills`, `skill_groups`, `jobs`,
`profiles`, `social_medias`, `tourSteps`, `media_assets`, `code_examples`,
`aggregated_articles`, `aggregated_events`, `content_sources`.

The embeddings export is best-effort — if it throws, the backend logs
`Failed to export embeddings, skipping` and the backup still completes. Such an
archive restores fine but leaves chat/semantic search empty until you run
`POST /reembed`. Worth checking after an Elasticsearch incident.

There is **no separate media-state sidecar file** in the Drive folder — media is
embedded in each ZIP. Incremental media exists only as a *read* path: if an
archive contains no `uploads/**` entries, `RestoreService` reads a `mediaSource`
field from its `manifest.json` and fetches media from that named earlier backup.
Current backups always embed their own uploads, so this only affects older
archives — but it is the reason to prune with the retention job rather than by
hand (see step 4).

### 4. Retention and pruning

**Policy: retain the last 7.** `BackupRetentionService.pruneToLimit()` keeps the
newest `backup.retention.max-backups` (default **7**) and deletes the rest. It
runs automatically after every *successful* nightly backup — and only then; a
failed backup skips the prune, so old files accumulate as a side effect of a
broken job rather than being the problem itself.

There is no dedicated prune endpoint. Options, in order of preference:

1. **Do nothing** — the nightly job prunes. If there are more than 7 backups, fix
   the backup job (step 5); the prune will catch up.
2. **Force a prune** by taking a successful on-demand backup — the retention
   sweep is wired to the scheduled path, so an interactive `POST /backup` alone
   does not prune. Prefer option 1.
3. **Delete by hand** — from the Drive UI, or the Data Ops **Available Backups**
   list. Only ever delete the *oldest* files, never a file that a newer archive's
   `manifest.json` names in `mediaSource` (that would orphan the newer backup's
   media). Deleting the newest backup is never right.

Pruning failures are non-fatal and per-file: one failed delete is logged
(`Backup retention: failed to delete <name>`) and the sweep continues.

### 5. Diagnose a failing backup job

Query the backend logs (details in `prod-logs`):

```logql
{container="simonrowe-dev-monorepo-backend-1"}
  |~ "Nightly backup|Backup retention|Backup failed|Failed to export embeddings"
```

Map the message to the cause:

| Log line | Cause | Fix |
| --- | --- | --- |
| `Nightly backup skipped: Google Drive is not connected` | Drive creds missing/invalid | Check the four `GOOGLE_DRIVE_*` env vars reached the backend; re-run `./scripts/google-drive-auth.sh "$GOOGLE_DRIVE_CLIENT_ID" "$GOOGLE_DRIVE_CLIENT_SECRET"` if the refresh token was revoked |
| `Nightly backup skipped: another data operation is in progress` | Lock held (restore/redeploy/reembed) | Retry manually; avoid long ops around 22:00 |
| `Backup failed: ...` (quota / 403) | Personal Drive quota full | Free space in Simon's Drive, or prune |
| `Backup retention skipped: Google Drive is not connected` | same as row 1 | as above |
| `Failed to export embeddings, skipping` | Elasticsearch down at backup time | Non-fatal; run `POST /reembed` after any restore of that archive |
| No lines at all near 22:00 | backend restarted/down, or timezone confusion | Check container uptime; the cron zone is `Europe/London`, filenames are UTC |

Nothing in Loki? Remember the backend *is* shipped (only `kafka`, `mongodb`,
`frontend`, `langfuse-db` are excluded), so an empty result means the backend
container was down or `alloy` is unhealthy — check via `prod-triage`.

### 6. Local tarball snapshots (separate, local-only)

Unrelated to Drive and not part of the production backup policy — use for
"snapshot before I break my local data":

```bash
./scripts/backup.sh    # writes ~/backups/backup-<UTC timestamp>.tar.gz
./scripts/restore.sh   # restores the newest ~/backups/backup-*.tar.gz
```

Contents differ from the Drive ZIP: a native `mongodump` of the `simonrowe`
database + `backend/uploads` + a real Elasticsearch filesystem snapshot (repo
`simonrowe_backup`). Both scripts locate containers by image (`mongo:8`,
`elasticsearch:8.17.0`), so the local compose stack must be running, and
`restore.sh` uses `mongorestore --drop`, so restart the backend afterwards. These
tarballs are never uploaded anywhere and are not covered by the 7-backup
retention.

## Gotchas

- **409 Conflict** on `POST /backup` = another data operation is in progress
  (globally, one at a time). **503** = Drive not connected.
- Backup filenames are **UTC** (`backup-20260725-210004.zip`) while the schedule
  is `Europe/London` — in summer a 22:00 BST run produces a `21:00` filename.
  Don't read that as a missed run.
- Drive quota is Simon's **personal** account. A full Drive silently breaks
  backups; there is no alerting for it, which is why step 1 exists.
- Nothing checks backup *integrity* beyond a restore. `RestoreService` validates
  only that the ZIP has `manifest.json` and a `collections/` directory — the only
  real proof is a restore into local (`prod-data-restore`).
- There is no backup alerting and no metrics scraping at all in this stack, so
  the freshness check in step 1 is a manual habit, not a monitor.
- `POST /clear` (confirmation phrase exactly `DELETE ALL DATA`) does **not**
  touch Drive backups — the UI says so explicitly.

## Related skills

- `prod-data-restore` — restoring these backups; `references/data-ops-api.md` has the full API.
- `prod-logs` — Loki queries for the nightly job.
- `prod-triage` — when the backend is down and therefore not backing up.
- `prod-deploy` — take a backup before shipping something invasive.
