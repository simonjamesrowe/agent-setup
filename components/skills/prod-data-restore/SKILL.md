---
name: prod-data-restore
description: Restore the latest simonrowe.dev production backup (Google Drive) into a local environment via the admin Data Ops UI. Use when local data is stale, missing, or a bug needs prod-like data to reproduce.
---

# Restore production data into local

Restore the latest **application backup** from Google Drive through the local
admin Data Operations page. Use Playwright MCP with the existing browser profile.
The backend downloads from Drive; opening Drive in the browser is unnecessary.

## 1. Verify the destination

Use `local-env` in the intended monorepo workspace. Confirm its frontend and
backend are running and that the frontend targets that local backend. Default
page: `http://localhost:5173/admin/data-operations`; use the workspace's actual
ports if configured differently.

A request to restore **from production** means production data into local.
Restoring **into production** needs an explicit production-restore request.
For a skills audit, inspect access and backup availability without executing a
restore. State that this does not prove archive integrity.

## 2. Sign in with the existing session

Navigate to the admin page. If redirected to Auth0, choose **Continue with Google**
and reuse Simon's cached Google session. After login, navigate back to Data
Operations if the callback lands on the dashboard. The account must have
`DEV_PORTAL_ADMIN`; a successful Google login alone does not grant admin access.

If Google asks for a password, passkey, MFA or a challenge, let Simon complete
that browser step. Do not request credentials or tokens in chat. Use an env-backed
password login only when the configured account and browser tooling support it
without printing the secret. Inspect the page before filling credentials; avoid
snapshots or screenshots of populated credential fields.

Cached login belongs to the browser profile used by this MCP session; do not
assume it shares cookies with normal Chrome or another workspace. See the
[Playwright profile documentation](https://playwright.dev/mcp/configuration/user-profile).

## 3. Select the latest application backup

Require **Google Drive: Connected**. Click **Choose Backup** in **Restore from
Google Drive**, then read **Available Backups**. Select the newest application
ZIP by creation time; record its filename, date and size. A backup older than
24 hours should be reported and investigated with `prod-backup-ops`.

The separate **Platform Data** list contains Postgres/ClickHouse archives;
those are not inputs to this restore flow. Its restore procedure lives in the
monorepo's `docs/runbooks/platform-backup-restore.md`.

Drive access uses the backend's `GOOGLE_DRIVE_CLIENT_ID`,
`GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` and
`GOOGLE_DRIVE_FOLDER_ID`. Browser Google login authenticates the admin user;
it does not replace these backend credentials.

## 4. Restore and wait for completion

Recheck the destination origin and local backend before selecting **Restore**.
Confirm the selected archive in the UI dialog, then keep the progress page open
until the operation reports `COMPLETED` or `FAILED`. An accepted request or
100% progress alone is not the completion criterion.

Restoring replaces application data and media. The backend creates a temporary
safety ZIP, but deletes it when the operation ends, including on failure; it is
not a durable rollback point or an automatic rollback. Preserve any needed local
data before starting. Use the application's restore pipeline, not raw MongoDB
writes or `mongorestore`.

## 5. Verify the result

Open a restored blog and check text, dates and images. Exercise search and, when
needed for the task, chat against known restored content. Record the archive,
destination and terminal operation result.

Restore already rebuilds search and imports available embeddings. Run **Rebuild
Index** only if indexing failed or verification finds missing results. Run
**Re-embed All** if embeddings were absent/incompatible or semantic verification
fails; this can make paid model calls, so it is not a routine reassurance step.

## Failures and implementation reference

- `401` / `403`: refresh the login or check the admin role.
- `503`: check backend Drive configuration; another Google browser login will
  not repair a missing refresh token.
- `409`: another data operation holds the lock; inspect status and wait.
- Empty backup list: use `prod-backup-ops`; do not clear data to fix it.
- Failed restore: preserve the error and inspect backend logs with `prod-logs`.
  Do not claim that the temporary safety ZIP recovered the previous data.

For diagnosis, read `DataOperationsAdmin.tsx`, `RestoreService.java` and
`BackupService.java` in the target checkout. Collection lists, index hooks and
archive contents change with the application; do not copy an old list here.
The [API reference](references/data-ops-api.md) covers status and auth details;
the supported restore workflow remains the admin UI.
