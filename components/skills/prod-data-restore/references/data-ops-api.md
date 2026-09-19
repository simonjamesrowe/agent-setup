# Data Operations API reference

Read `backend/src/main/java/com/simonrowe/dataops/DataOperationsController.java`
and `frontend/src/services/dataOperationsApi.ts` in the target checkout before
using an endpoint. Base path: `/api/admin/data-operations`; local default origin
`http://localhost:8080`, production `https://api.simonrowe.dev`.

Use the admin UI for restores. Its Google/Auth0 login needs `DEV_PORTAL_ADMIN`.
Browser login and the backend's Drive OAuth credentials are separate. For
necessary API diagnosis, keep bearer tokens inside the authenticated session or
an env-backed client. Never print Authorization headers or ask for a token in chat.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Current/last operation |
| GET | `/progress` | SSE progress |
| GET | `/backups` | Application Drive archives |
| GET | `/platform-backups` | Separate platform archives; listing only |
| POST | `/backup` | Full backup; no partial-media parameter |
| POST | `/restore` | Application restore; body contains `backupFileId` |
| POST | `/clear` | Destructive clear; requires `confirmationPhrase` |
| POST | `/rebuild-index` | Rebuild search |
| POST | `/reembed` | Regenerate embeddings |

POST acceptance is asynchronous; follow status to `COMPLETED` or `FAILED`.
`401/403` means authentication/role failure, `409` a busy operation, and `503`
missing Drive connectivity on Drive operations. A failed list is not an empty list.

The old backend `/redeploy` endpoint was removed. Deployment belongs to the
software-factory/deployer workflow; see `prod-deploy`.

Drive configuration: `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`. Check presence without
printing values. Diagnose OAuth provisioning using the checkout's
`scripts/google-drive-auth.sh` only when needed.

Read `BackupService` / `RestoreService` for archive contents and restore hooks;
the old 13-collection list is obsolete. Application ZIPs include collections,
media and available embeddings; platform Postgres/ClickHouse archives use a
separate flow (`docs/runbooks/platform-backup-restore.md`). A restore's safety ZIP
is temporary and is deleted even on failure. It is not an automatic rollback.
