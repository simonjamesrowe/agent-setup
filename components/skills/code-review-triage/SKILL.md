---
name: code-review-triage
description: Diagnose why the automated code reviewer did not review a pull request on simonrowe.dev. Use when a PR got no review comment, a review says it did not complete, or after changing GitHub App permissions or deploying software-factory.
---

# Code Review Triage

The automated reviewer is the `software-factory` container: a GitHub webhook
receiver and a Temporal worker in one JVM, reviewing pull requests with the
Claude CLI and commenting as `simonrowe-code-reviewer[bot]`. See
`docs/runbooks/software-factory.md` in the monorepo for its architecture.

**A failed review frequently posts nothing to the pull request.** Silence is the
normal presentation of failure, not an unusual one, so never conclude from a
quiet PR that the webhook never arrived. The Temporal UI is the only reliable
observability this subsystem has — there is no dashboard and no alerting.

## When to use

- A pull request got no automated review comment.
- A PR carries an "Automated code review — this review did not complete" notice.
- Immediately after changing the GitHub App's permissions, or after deploying a
  new `software-factory` image — both have caused full outages.
- Checking whether the reviewer is working at all.

## Prerequisites

- `gh` CLI, authenticated.
- Temporal UI: `https://temporal.simonrowe.dev`, behind Auth0 SSO, which requires
  `DEV_PORTAL_ADMIN`. Login is Google/Auth0 — **ask Simon to complete the login
  step in the browser**; never type or request a password.
- Container logs via the `prod-logs` skill: `{service="software-factory"}`.

## Workflow

### 1. Check the pull request — via the *issue* comments endpoint

```bash
gh api repos/simonjamesrowe/simonrowe-dev-monorepo/issues/<pr>/comments \
  --jq '.[] | select(.user.login=="simonrowe-code-reviewer[bot]") | {created_at, body: .body[0:200]}'
```

**Do not use `/pulls/<pr>/reviews` to decide whether a review happened.** It is
usually empty. The publish path posts to the Reviews API, but GitHub normalises a
`COMMENT` review with no successfully anchored inline comments into a plain
conversation comment, so the result appears only under issue comments
(`event: commented`). Checking the reviews endpoint alone reports "no review" on
pull requests that were reviewed perfectly well.

To sweep a range:

```bash
for n in $(seq 90 100); do
  gh api "repos/simonjamesrowe/simonrowe-dev-monorepo/issues/$n/comments?per_page=100" \
    --jq ".[] | select(.user.login==\"simonrowe-code-reviewer[bot]\") | [\"PR$n\", .created_at, (if (.body|contains(\"did not complete\")) then \"FAILED\" else \"ok\" end)] | @tsv" 2>/dev/null
done
```

### 2. Go to Temporal — the real source of truth

`https://temporal.simonrowe.dev/namespaces/default/workflows`, filter for
`code-review-`. Workflow ids are
`code-review-{owner}-{repo}-{pr}-{headSha}`, so one run per pushed commit.

| What you see | What it means |
| --- | --- |
| No workflow for that PR at all | Webhook never arrived, or no poller — go to step 5 |
| `Failed`, nothing on the PR | The failure itself failed to publish — step 3 |
| `Failed`, failure notice on the PR | Working as designed; read the reason |
| `Running` for more than ~20 min | The agent activity is hung; its `StartToCloseTimeout` will convert this into a normal failure |

Open the workflow → the `workflowExecutionFailedEventAttributes` result carries
`failure.cause.message` and a stack trace. Ignore the outer `"Activity task
failed"` — that is Temporal boilerplate; the inner `cause` is the real reason.

### 3. Match the failure signature

| Signature | Cause | Action |
| --- | --- | --- |
| `GitHub App token endpoint returned 422` in `GitHubCredentials.mintInstallationToken` | The App requests `contents:write`, `issues:write` and `pull_requests:write` on **every** token mint; GitHub 422s the entire request if any exceeds what the installation was granted | Step 4 — most likely cause after any deploy |
| `Claude exited with 1: ` with an empty reason | Agent-side failure on an image older than 2026-08-09, which reported stderr only — always blank in `-p --output-format json` mode | Deploy a current image (step 6); then the real reason appears |
| `Claude exited with 1:` *with* a reason | Genuine agent failure. `max_turns` exhaustion on a large diff is the common one — `CLAUDE_MAX_TURNS` defaults to 40 in compose but the deploy `.env` may pin it lower, which wins |
| `Pull request head changed before review started` / `STALE_PULL_REQUEST` | A newer push superseded this run | Benign — check the newer workflow |
| `Publishing a GitHub review requires GitHub credentials` / `MISSING_GITHUB_CREDENTIALS` | No App configured and no static token | Check `GITHUB_APP_CLIENT_ID` and the PEM bind-mount |
| `Failed` but nothing published | The failure happened inside `loadPullRequest`, so `pullRequest` was null and `CodeReviewWorkflowImpl.reportFailure` was skipped | Known gap; diagnose from Temporal only |

### 4. The 422 permission trap

This caused a full outage on 2026-08-11: seven consecutive failed reviews across
two repositories, all silent.

`GitHubCredentials.mintInstallationToken` requests a fixed permission set on
every token it mints, for both the code-review and feedback paths. GitHub's
access-tokens endpoint rejects the **whole** request with `422` if any requested
permission exceeds the grant — it does not quietly narrow it. So a single
un-bumped App permission fails token minting, which fails `loadPullRequest`,
which kills every review before anything can be posted.

**The rule: widen the App's permissions *before* deploying an image that requests
them, never after.**

Fix: org settings → Developer settings → GitHub Apps → `simonrowe-code-reviewer`
→ Permissions & events → set the permission → save → then **accept the
permission request on each installation** (saving on the App alone is not
enough). No redeploy or restart is needed: failed mints are never cached, so the
next review picks up the new grant. If it still 422s, the installation-side
acceptance was missed.

### 5. No workflow at all

Either the webhook never arrived, or nothing is polling. A `healthy` container
with **zero registered pollers** is a real and quiet state — the webhook returns
`202` and no review ever runs.

```bash
docker run --rm --network simonrowe-dev-monorepo_default \
  temporalio/admin-tools:1.31.2 \
  temporal task-queue describe --address temporal:7233 \
  --namespace default --task-queue code-review
```

Expect one `workflow` and one `activity` poller. Also check the webhook only
fires for `opened`, `reopened`, `synchronize`, `ready_for_review` — drafts are
ignored unless `ready_for_review`.

### 6. Deploying software-factory

`software-factory` was **absent from `redeploy.services` until 2026-08-11**, so
neither `POST /api/admin/data-operations/redeploy` nor `prod-deploy` ever
deployed it and it sat on whatever image was last started by hand. It is in the
list now, restarted on its own with `--no-deps` (it declares `temporal` and
`mongodb` as `service_healthy` dependencies, which must not be able to block or
restart during a redeploy).

Two things to check when it still looks stale:

- **A pinned `FACTORY_IMAGE` in the deploy `.env`.** The compose default is
  `…-software-factory:latest`, but the original cutover set this variable
  explicitly. Pinned to a tag or digest, redeploy dutifully re-pulls the same
  image forever.
- **A best-effort restart that failed.** Its restart does not abort the redeploy
  — a failure is appended to the operation's completion message as
  `WARNING: could not restart software-factory`. Read the completion message, not
  just the success status.

To deploy it directly on the Pi:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && docker compose -f docker-compose.prod.yml up -d --no-deps software-factory
```

`pull_policy: always` means that pulls the new image.

### 7. Re-running a review

The workflow id embeds the head SHA and uses `REJECT_DUPLICATE`, so the same
commit **cannot** be re-reviewed via the webhook — even after a failure. Either
push a new commit, or use the manual trigger with no `expectedHeadSha` (which
generates a UUID instead). The endpoint is not routed by nginx, so run it from
inside the container network:

```bash
docker exec simonrowe-dev-monorepo-software-factory-1 \
  curl -s -X POST localhost:8090/api/reviews \
  -H "X-Factory-Token: $FACTORY_TRIGGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"owner":"simonjamesrowe","repository":"simonrowe-dev-monorepo","pullNumber":100,"publish":true}'
```

Set `"publish": false` for a dry run — it reviews but posts nothing, so it is the
only safe way to exercise Claude auth and the authenticated clone path without
commenting.

## Gotchas

- **Reviews are issue comments, not PR reviews.** `/pulls/<pr>/reviews` is
  normally empty even on success.
- **`publish: false` posts nothing at all**, including failure notices. A green
  dry run does not prove the publish path works — that was how a clone-auth bug
  reached production.
- **Failures inside `loadPullRequest` are always silent** on the PR, because the
  failure-reporting path needs the pull request context it never obtained.
- **`Activity task failed` is never the real message** — unwrap to the innermost
  `cause`.
- The deploy `.env` can pin `CLAUDE_MAX_TURNS`, `CLAUDE_MODEL` and
  `CLAUDE_TIMEOUT` below the compose defaults; the `.env` value wins, so a
  committed default bump has no effect until `.env` is updated too.
- The `agent-setup` repo is reviewed by the same App and appears in the same
  Temporal list — a failure there is the same subsystem, not a separate one.

## Related skills

- `prod-logs` — container logs, `{service="software-factory"}`.
- `prod-deploy` — the main stack deploy, which does **not** cover this container.
- `prod-triage` — when the site itself is down.
