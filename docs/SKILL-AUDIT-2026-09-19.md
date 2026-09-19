# Skills audit — 2026-09-19

## Verdict

Keep the distinct org workflows. The main excess is repeated procedure and stale
implementation detail, not 18 copies of the same capability. `frontend-design` is
optional generic guidance; the nine repo-local Moderne skills are a separate
candidate for removal from this JavaScript setup repository. Neither was deleted
without establishing what would replace it. There is no usage telemetry here, so
“rarely used” cannot be established from this audit.

## Verification boundaries

- Read all 18 distributed skill bodies, relevant references, provisioning code
  and conventions; inspected the nine repo-local Moderne skill purposes.
- Compared operational claims to monorepo `origin/main` at `e21e22c3`
  (2026-09-19). The ordinary monorepo checkout was older, so source checks used
  `git show origin/main:<path>` rather than assuming its working tree was current.
- Used Playwright MCP for the production admin UI and Raspberry Pi Connect.
  The browser initially required sign-in; Simon completed the interactive login.
  Subsequent admin navigation reused the session. Unattended env-password login
  and session persistence across MCP restarts were not tested.
- No data restore, backup creation/pruning, deployment, migration, publication,
  permission change or production restart was performed. Static/source review
  does not certify every external integration end to end.

## Live evidence

**Admin/Drive:** Data Operations showed **Google Drive: Connected**. Selecting
**Choose Backup** listed seven application archives. Newest:
`backup-20260917-210001.zip`, displayed creation time **17 September 2026, 22:10:09**
(browser local time), **1359.3 MB**. At the audit this was about **39 hours old**:
the expected September 18 application backup was absent. This is an operational
follow-up, not a reason to claim backups are healthy. The current backend
container’s bounded 48-hour log query returned no matching backup messages;
that does not establish the cause or cover logs from replaced containers.
The separate Platform Data list had a September 19 archive; it does not
compensate for the older application backup.

**Pi:** Connect → `simon-rowe-dev-server` → Remote shell executed hostname,
architecture, checkout and compose checks. Results: expected hostname, `aarch64`,
checkout `e21e22c`, and **23 listed services running/healthy**. This verifies
browser-shell access and those service states, not complete application health.
The shared procedure is [Raspberry Pi Connect](../components/skills/prod-triage/references/raspberry-pi-connect.md).
Proposed secret names are `RPI_CONNECT_EMAIL` and `RPI_CONNECT_PASSWORD`; those
names were not present in the checked env file. A cached session already works.
`.env*` and Playwright output are now gitignored.

**Restore:** source and UI agree on the application-backup route. Google/Auth0
authenticates the admin; the backend’s existing Drive OAuth credentials perform
archive access. The destination must be the local workspace/backend. This audit
verified the production archive list, not local stack readiness, archive integrity
or completed restore. A real local restore remains the end-to-end proof.

## Inventory and decisions

Line counts are before → after this audit. They are not quality scores; long
paragraphs can hide substantial word counts.

| Skill | Lines | Decision | Findings / remaining work |
| --- | ---: | --- | --- |
| [backend-test](../components/skills/backend-test/SKILL.md) | 230 → 231 | Keep; trim reference detail | Corrected module/toolchain/property drift. Keep commands and failure interpretation; derive versions, exclusions and counts from build files. |
| [blog-publish](../components/skills/blog-publish/SKILL.md) | 145 → 145 | Keep | Distinct editorial/CMS workflow. Reasonable length; avoid repeating its policy across migration docs. Publishing was not exercised. |
| [chat-e2e-verify](../components/skills/chat-e2e-verify/SKILL.md) | 200 → 200 | Keep; trim | Distinct live behavior checks. Updated tracing guidance. Move transport/widget tables and old eval implementation detail to references; no chat/eval run in this audit. |
| [code-review-triage](../components/skills/code-review-triage/SKILL.md) | 195 → 200 | Keep; refresh further | Different task from PR shepherding: diagnose the reviewer service. Corrected bot identity/access. Historical API/permission/failure tables still need reconciling with the current factory runbook. |
| [content-source-add](../components/skills/content-source-add/SKILL.md) | 269 → 269 | Keep; trim | Preserves source strategy, seeding and verification conventions. Long scraper implementation inventory should become conditional reference; no scraper/backfill execution. |
| [dependency-cve-fix](../components/skills/dependency-cve-fix/SKILL.md) | 237 → 171 | Keep | Removed forced credential provisioning and duplicate PR loop/reset-branch commands. Preserve advisory triage; use pr-review-loop for delivery. No vulnerability query performed. |
| [embabel-guide](../components/skills/embabel-guide/SKILL.md) | 299 → 295 | Keep as optional setup | Server setup is distinct from agent coding. Removed a command that printed keys. Move cold-start timings, captured output and old build observations into a dated reference; server not started. |
| [frontend-design](../components/skills/frontend-design/SKILL.md) | 59 → 59 | Optional; strongest removal candidate | Generic vendored design guidance, rather than org operations. Keep only if this is the preferred design skill across agents; replace with one upstream installation if equivalent guidance is already supplied. No deletion without establishing that replacement. |
| [langfuse-verify](../components/skills/langfuse-verify/SKILL.md) | 199 → 59 | Keep | Rewrote around supported local/prod v3 tracing, explicit target host, current capture flag and trace evidence. Configuration verified; no fresh trace generated. |
| [local-env](../components/skills/local-env/SKILL.md) | 199 → 54 | Keep | Shortened to ownership, env, start/verify/stop; corrected Java/local tracing and Conductor settings assumptions. Local stack not launched. |
| [mongock-migration](../components/skills/mongock-migration/SKILL.md) | 252 → 253 | Keep; trim | Distinct reproducible data-change rules. Corrected restore/history claim. Old tip/order examples and repeated rationale belong in reference; no migration executed. |
| [pr-review-loop](../components/skills/pr-review-loop/SKILL.md) | 523 → 521 | Keep; largest remaining trim | Owns four independent merge signals. 4,000+ words still repeat gate warnings and historical incidents. Retain the loop/exit criteria; extract GraphQL/Sonar recipes and incident evidence. No PR opened or merged. |
| [prod-backup-ops](../components/skills/prod-backup-ops/SKILL.md) | 217 → 202 | Keep | Backup health/retention is distinct from restore. Fixed contradictory on-demand pruning advice and obsolete collection inventory; distinguished platform archives. Live application backup freshness failed. |
| [prod-data-restore](../components/skills/prod-data-restore/SKILL.md) | 188 → 95 | Keep | Rewrote to local destination → cached Google/Auth0 login → Choose Backup → restore completion → content verification. Actual restore not executed. |
| [prod-deploy](../components/skills/prod-deploy/SKILL.md) | 221 → 54 | Keep | Replaced obsolete backend self-redeploy with current Publish/Temporal/deployer workflow; retained running-release verification and separate deployer update. No deploy executed. |
| [prod-logs](../components/skills/prod-logs/SKILL.md) | 210 → 209 | Keep; trim | Useful standalone diagnostic entry point. Added Connect, corrected Loki GET examples and trace filter. Further reduce duplicated telemetry history; no authenticated Loki query performed. |
| [prod-triage](../components/skills/prod-triage/SKILL.md) | 210 → 193 | Keep; refresh further | Owns outage diagnosis and shared Connect access. Corrected nginx/current deploy notes. Historical monitoring thresholds should be read from deployed scripts; no repair performed. |
| [spring-boot-upgrade](../components/skills/spring-boot-upgrade/SKILL.md) | 305 → 48 | Keep | Replaced obsolete pre-Boot-4 blocker narrative with a reusable upgrade procedure and completed-upgrade runbook. Marked bundled 2026-08 research historical. No migration recipe run. |

## Verbosity and ownership

The 18 main skill bodies went from **29,985 to 23,929 words**
(**20.2% less**). This excludes reference files and the audit report.
The largest remaining bodies are `pr-review-loop`, `embabel-guide`, and the
migration/content-source runbooks. Preserve their distinctive checks, but move
API payloads, captured output, historic incidents and detailed implementation
descriptions into references loaded only for that branch.

Changes to the convention remove the artificial 100-line minimum. Aim for the
shortest complete procedure, usually under 150 lines; investigate bodies above
300. Keep one owner for PR review, admin restore/login, and Pi access.

Nine `.claude/skills/` entries (`analyze-code`, `change-symbols`, `edit-code`,
`find-symbols`, `inspect-status`, `pattern-replace`, `prethink`, `query-datatable`,
`search-code`) wrap Moderne. They are not distributed by the skills provisioner
or included by the skill linter. They appear tool-generated, and `prethink` points
to a missing `.moderne/context/index.md`. They need a separate ownership decision:
prefer tool-managed installation where Moderne is used instead of maintaining
checked-in copies here. Keep the JVM-specific wrappers in JVM repositories when
their typed tools are available; several have little relevance to this Node CLI.

## Remaining follow-ups

1. Investigate the missing September 18 application backup using retained Loki
   logs and scheduler/operation history. An empty current-container log is inconclusive.
2. When requested, perform a restore into a verified local workspace and verify
   media/search/embeddings. Do not use the production UI as that destination.
3. Trim the PR review body and reconcile the reviewer-triage historical tables
   with current check-run creation and manual-trigger behavior.
4. Revalidate remaining source-specific scraper/test/monitoring claims during
   those workflows. Their retention here is not an end-to-end certification.
5. Decide whether to retain the vendored design skill and repo-local generated
   Moderne skills. No distributed skill was removed or renamed in this patch.

## Sources and checks

- [Monorepo source revision](https://github.com/simonjamesrowe/simonrowe-dev-monorepo/tree/e21e22c3):
  `DataOperationsAdmin.tsx`, `DataOperationsController`, `BackupService`,
  `RestoreService`, `BackupScheduler`, `BackupRetentionService`, version catalogue,
  module list, compose files, Alloy/nginx config and deploy/upgrade runbooks.
- [Raspberry Pi Connect documentation](https://www.raspberrypi.com/documentation/services/connect.html)
  supports browser remote-shell access; the actual shell interaction was tested.
- [Playwright profiles](https://playwright.dev/mcp/configuration/user-profile)
  explains profile-specific browser state; cached access is not a universal guarantee.
- `npm run lint:skills`: passed. Validates frontmatter, not runbook correctness.
- `npm test`: **89 passed** (includes isolated install/doctor for all three agents).
- Independent documentation scenario check: correctly selected a local destination
  and stopped an audit before restore; Pi instructions produced bounded read-only checks.
- No skills were installed into the real agent homes; edits remain in this workspace.
