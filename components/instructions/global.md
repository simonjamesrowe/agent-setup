# simonjamesrowe / simonrowe.dev

This section applies when working in repos under the `simonjamesrowe` GitHub
org (the simonrowe.dev monorepo and its satellites). Ignore it in other repos.

## Environment map

- https://simonrowe.dev — the site (React frontend)
- https://api.simonrowe.dev — Spring Boot backend (`/api/blogs`, `/api/profile`; `/actuator/health` is on the separate management port, 8081 in prod, 8082 default locally)
- https://console.simonrowe.dev — Portainer (container management)
- https://langfuse.simonrowe.dev — Langfuse (both prod and local run v3 with Alloy; explicitly target the correct host/project when verifying traces)
- Grafana Cloud Loki — prod container logs (`logs-prod-035.grafana.net`, query by `container` label)
- Production host: Raspberry Pi (ARM64) running `docker-compose.prod.yml`, ingress via Cloudflare → pinggy tunnel → nginx. Use Playwright MCP → Raspberry Pi Connect → Remote shell for host commands (`prod-triage` has the access procedure). Direct SSH is unavailable; manual copy-paste is the fallback when Connect cannot be used.
- Images: `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-{backend,frontend}` — pushed by the "Publish" GitHub Actions workflow on merge to main; the Pi pulls (no push deploy).

## Non-negotiables

- **Credentials come from env files** (`.env` in the repo, sourced from `~/workspace/simonjamesrowe/env`). Reuse Simon’s Google/Auth0 browser session for admin access and verify `DEV_PORTAL_ADMIN`; use configured env credentials when a password login is needed. Never ask for or echo credential values.
- **Mongock-first**: any production data change ships as a Mongock change unit in the backend, not an ad-hoc script.
- **Data restores go through the admin Data Ops UI** (browser automation), not raw mongorestore against prod data.
- **Backups**: full-with-media only; retain the last 7.
- **Check nginx and upstream health before a production restart.** Current nginx resolves upstreams at runtime; older static configurations abort at boot when an upstream is absent. Verify the deployed config and follow `prod-triage`.
- **Renumbering documentation sections**: after renumbering, grep the whole doc (and any files that reference its section numbers) for stale references — manual inspection misses them.
- **Regexes over unbounded input** (logs, error traces, batched data), especially in error-detection paths: test against a 100k+ char string shaped to trigger worst-case matching, and use possessive quantifiers (`++`, `*+`) to rule out catastrophic backtracking — a `StackOverflowError` there can cascade to complete system failure.

## Code quality

- **Clean up root causes even when guards prevent them from triggering.** Cancel
  timers, close resources, dispose observers, or clear state when the async
  operation completes — don't just guard against stale effects later.
- **Prefer mechanical constraints over enumerating failure modes.** Instead of
  checking every way something might be hidden or fail, apply a constraint
  (clamping, clipping, bounding) that inherently handles all cases without
  requiring knowledge of every possible edge case.
- **Validate URL allowlists by parsed origin, not string prefix.** Use the
  `URL()` constructor and compare origins; `startsWith('https://example.com')`
  is forgeable by suffix (`https://example.com.attacker.example/phish`).
- **Revalidate redirect targets before following them.** Disable automatic
  redirect-following on HTTP clients doing security-sensitive fetches, then
  validate each hop's destination before requesting it, to prevent SSRF via
  redirect chains.
- **Classify by final destination, not the requested URL.** When a fetch
  follows redirects, attribute resource properties (source type, host origin,
  etc.) based on the resolved destination after redirects — attributing them
  from the initial URL misattributes third-party content to the original
  source.
- **Apply constraints at the operation boundary, not in a one-off
  post-processing pass.** A scope or constraint that must always hold on a
  resource belongs inside the core operation that produces it, so it persists
  across every invocation instead of being lost on re-fetches that skip the
  post-processing step.
- **When a fix would create a worse problem, document the tradeoff instead of
  leaving it implicit.** State the constraint and why it's accepted directly
  in the code or PR so future maintainers know the fragility exists before
  they touch the surrounding code.
- **Match the tool to the actual problem.** Don't reach for an optimization
  technique built for a different problem class; use the simplest solution
  that directly addresses the performance or correctness issue at hand.
- **Keep defensive null checks on third-party library return values** even if
  static analysis flags them unreachable — third-party behavior varies by
  version, and the check is cheaper than the NPE from a future dependency
  upgrade.
- **Test layered configuration flags (request-level + global) in asymmetric
  combinations**, not just both-true/both-false. A test suite that never sets
  them in opposite states will miss a code path that checks one flag but not
  the other.
- **Don't assume similar operations share dry-run semantics.** When adding a
  preview/dry-run mode across multiple operations, decide independently what
  each should expose — don't just copy the guard conditions from a similar
  operation.
- **Scope bug fixes to your PR's new code.** When a finding applies to both new
  and pre-existing code, fix only the new occurrences and raise pre-existing
  instances as a separate, focused technical-debt PR.

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
- `pr-review-loop` — **open a pull request and drive it to green.** Owns the whole
  sequence: pre-flight locally, open the PR, wait on all four signals (CI, reviewer check,
  review threads, SonarQube Cloud), triage findings, push, re-wait, bounded. Use it
  whenever you are about to create a pull request or shepherd one to merge — do not
  improvise the loop.
- `code-review-triage` — when the reviewer bot posted nothing at all
- `dependency-cve-fix` — patch a Dependency-Track CVE finding and drive CI green
- `spring-boot-upgrade` — cross-version backend upgrades via OpenRewrite/Moderne
- `blog-publish` — research, draft, illustrate and publish a first-party post
- `frontend-design` — visual direction when building or restyling UI
- `embabel-guide` — run the Embabel docs MCP server when authoring agent code

## Planning before building

`grill-me` (from `mattpocock-skills`, installed for all three agents) replaced
superpowers' brainstorming flow. Reach for it before work that is not yet pinned
down: it walks the design tree in rounds, asking every question whose
prerequisites are already settled and waiting for answers before the next round.
It plans only — it never writes code. `grill-me` is user-invoked (type it);
`grilling` is the half an agent can reach for itself.

**Creating a pull request in this org means using `pr-review-loop`.** The four
signals each have their own way of being misread, and a red `Static Analysis` check
is a broken scanner rather than a cosmetic advisory failure. The skill records both.
