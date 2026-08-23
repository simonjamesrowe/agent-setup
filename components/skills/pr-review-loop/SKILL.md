---
name: pr-review-loop
description: Drive a simonrowe.dev pull request from ready-to-review to all-signals-green — pre-flight locally, open the PR, wait on CI, the code-review bot and SonarQube Cloud, triage findings, push, re-wait, bounded. Use when work is ready for review, a PR needs shepherding to green, or review/analysis findings need addressing.
---

# Pull Request Review Loop

A simonrowe.dev pull request is judged by **three independent signals**, each with
its own read mechanism and its own way of being misread:

| Signal | What it is |
| --- | --- |
| **CI checks** | `ci.yml` — backend, frontend, software-factory, and the advisory `sonar` job |
| **Reviewer verdict** | the `software-factory` container, commenting as `simonrowe-code-reviewer[bot]` |
| **Analysis findings** | SonarQube Cloud, project `simonjamesrowe_simonrowe-dev-monorepo` |

This skill owns the sequence: pre-flight locally → open the pull request → wait on
all three → triage → fix → push → re-wait, **bounded** → report.

Work from `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` or a Conductor
workspace clone.

> **One assumption is stated up front and is not yet verified.** The SonarQube API
> calls in step 4c are written against documented API behaviour. At the time this
> skill was written the SonarQube Cloud project did not exist yet, so **no call in
> step 4c has ever been executed against a live project.** Treat the first real run
> as verification: if a response shape differs from what is described here, fix this
> skill rather than working around it. See
> `docs/runbooks/static-analysis.md` in the monorepo for the setup this depends on.

## When to use

- Work is complete on a branch and ready for review.
- A pull request is open and needs driving to green.
- The reviewer bot or SonarQube has posted findings that need triaging.
- You are about to open a pull request and want to not waste a CI round trip.

**When not to use**: if the reviewer posted *nothing at all* and you only want to
know why, go straight to the `code-review-triage` skill — that is its whole job.

## Prerequisites

- `gh` CLI, authenticated.
- A clean working tree on a feature branch off an up-to-date `main`.
- Nothing else. The SonarQube reads are attempted **unauthenticated** first,
  because the repository is public (step 4c).

---

## 1. Pre-flight — run locally what CI will run

A local failure costs seconds. A CI failure costs a round trip. Run all four
before opening anything.

Defer to the **`backend-test`** skill for the backend Gradle incantations —
checkstyle, tests, JaCoCo verification, and how to read each failure. Do not
restate them here.

Note that `backend-test` currently describes the build as single-module. It is
not: `settings.gradle.kts` includes both `backend` and `software-factory`, and
`software-factory` has its own Checkstyle gate. So run it explicitly:

```bash
./gradlew :software-factory:check
```

And the frontend, which CI now lints as a **blocking** step for the first time:

```bash
cd frontend && npm run lint && npm test
```

`npm run lint` should exit 0. It currently reports 5
`react-refresh/only-export-components` **warnings** and 0 errors, and there is
deliberately no `--max-warnings` flag in CI — so warnings are expected and fine,
but a new **error** will fail the build.

If your change touched the frontend, also confirm coverage still generates:

```bash
cd frontend && npm run test:coverage && test -s coverage/lcov.info && echo OK
```

**Do not run `./gradlew sonar` locally.** Without a token it takes about ten
minutes and then fails. Use `./gradlew sonar --dry-run` if you need to confirm the
task graph resolves.

## 2. Commit and push

Conventional commit prefix. **No Jira ticket reference** — this org does not use
them. **No attribution to Claude** in the commit message or anywhere in the pull
request.

```bash
git fetch origin main
git add <the files you actually changed>
git commit -m "feat: <imperative description>"
git push -u origin <branch>
```

## 3. Open the pull request — never as a draft

```bash
gh pr create --base main --title "<type>: <imperative description>" --body "..."
```

**Not a draft.** The reviewer bot ignores draft pull requests, so a draft is
**silently never reviewed** — and you will wait for a comment that is never
coming. Drafts also save no CI, because `pull_request` fires for them anyway.

Title: conventional prefix, imperative mood, under 72 characters, no ticket
reference. Body: summary of what changed and why, the key changes, how it was
tested, and anything a reviewer should look at first. If the change has a
deliberate omission or an accepted trade-off, say so in the body — that is where a
declined finding gets justified in step 5.

Pushing a branch runs nothing. `ci.yml` triggers on `pull_request` only, so the
pull request is what starts CI.

## 4. Wait on all three signals

Do not stop at CI. All three, every time.

### 4a. CI checks

```bash
gh pr checks --watch
```

**Blocking checks** — these must be green:

- `Backend Build & Test`
- `Frontend Build & Test`
- `Software Factory Build & Test`

**Advisory checks** — failure here does **not** block:

| Check | Why advisory |
| --- | --- |
| `evaluate` (Promptfoo Evals) | `continue-on-error: true` |
| `sonar` (Static Analysis) | `continue-on-error: true`, and `sonar.qualitygate.wait` is unset |

Two traps:

- **`evaluate` is `paths:`-filtered.** Its normal state on an unrelated pull
  request is **absent**, not green. Waiting for it to appear waits forever. When
  grepping, match on `evaluate`, not `Promptfoo Evals`.
- **`sonar` skips its analysis step when `SONAR_TOKEN` is unset**, and still
  reports success. A green `sonar` job does **not** prove an analysis ran — check
  whether the SonarQube check itself appeared (4c).

On a failure, read the log rather than guessing:

```bash
gh run view <run-id> --log-failed
```

If the `sonar` job is red, read its **Verify analysis inputs** step first. That
step exists to make a broken coverage-artifact hand-off visible, and it prints
`ok` / `MISS` per input.

### 4b. Reviewer verdict

```bash
gh api repos/simonjamesrowe/simonrowe-dev-monorepo/issues/<pr>/comments \
  --jq '.[] | select(.user.login=="simonrowe-code-reviewer[bot]") | {created_at, body}'
```

**Do not read `/pulls/<pr>/reviews`.** The reviewer posts an *issue comment*, not a
formal review, so the reviews list is **empty even on a successfully reviewed pull
request**. Reading it produces a false "not reviewed yet" that never resolves.

**Silence means failure, not approval.** Per the `code-review-triage` skill: a
failed review frequently posts nothing at all, and silence is the *normal*
presentation of failure. Never conclude from a quiet pull request that it passed.

| Observation | Meaning | Action |
| --- | --- | --- |
| Comment, no blocking findings | reviewed, clean | proceed |
| Comment with findings | reviewed, findings | triage (step 5) |
| Comment says "did not complete" | reviewer failed | → `code-review-triage` |
| No comment after a reasonable wait | reviewer failed | → `code-review-triage` |

**Cardinality trap.** Since PR #103 the reviewer posts **one comment per pull
request**, but it **re-reviews per pushed commit** (the Temporal workflow id embeds
the head SHA). So a second push does not produce a second comment to wait for, and
you cannot infer how many reviews have happened from how many comments exist.

### 4c. Analysis findings and gate

The project is public, so try these **unauthenticated first**. Only if you get a
`401` ask the operator to export a token — and never ask for the value in chat,
never echo it, never write it to a file.

```bash
# New, unresolved findings on this pull request
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=simonjamesrowe_simonrowe-dev-monorepo&pullRequest=<pr>&resolved=false"

# Quality gate status for this pull request
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=simonjamesrowe_simonrowe-dev-monorepo&pullRequest=<pr>"
```

A `404` from either means the project or this pull request's analysis does not
exist — check the operator checklist in `docs/runbooks/static-analysis.md` rather
than retrying. The most common cause is that the setup was never completed, in
which case the `sonar` job is skipping its analysis step and there is simply
nothing to read; that is expected, not a fault.

A gate status of `ERROR` is **advisory** — it does not block the merge. Triage the
findings anyway.

## 5. Triage

Three rules, applied to both the reviewer's findings and Sonar's.

**New code only.** Read Sonar's **New Code** view, not Overall. An unrelated pull
request does not get dragged into whatever pre-existing debt the first analysis of
`main` surfaced — that is separate work with its own plan. Same principle for the
reviewer: address what this change introduced.

**Fix it, or decline it with a stated reason in the pull request.** Never silence a
finding by marking it "won't fix" or "false positive" in the SonarQube UI. That
hides the decision from the diff and from review, and the repository's constitution
prohibits manual overrides of quality gates. A declined finding goes in the pull
request body or a comment, with the reason.

**Verify before obeying.** Use `superpowers:receiving-code-review`. A finding from
a bot is a claim, not an instruction — some are wrong, some are right for reasons
other than the one stated. Check it against the actual code before changing
anything, and if you disagree, decline it explicitly per the rule above rather
than implementing something you believe is wrong.

## 6. Fix, push, re-wait — bounded

```bash
git add <files> && git commit -m "fix: <what>" && git push
gh pr checks --watch
```

Then re-read all three signals. Remember the reviewer will re-review this commit
but will not post a second comment.

**Bound this at roughly three fix-and-push iterations.** After that, stop and hand
it back with what you tried and what is still failing. Looping on something that
will not go green wastes tokens and buries the signal — the same bound
`dependency-cve-fix` applies.

## 7. Report

State all five:

- **Pull request URL.**
- **CI state** — which checks are green, which are red, and which advisory checks
  are red or absent (and that this is fine).
- **Findings addressed** — what the reviewer and Sonar raised, and what changed.
- **Findings declined** — each one with the reason, and confirmation the reason is
  recorded in the pull request rather than only in this report.
- **Gate status** — pass, fail, or unknown. `unknown` is the correct answer while
  the SonarQube Cloud setup is incomplete; say so rather than implying the analysis
  ran.

If you hit the iteration bound, say that plainly and say what is still failing.

## Related

- `backend-test` — the backend Gradle incantations this skill defers to
- `code-review-triage` — when the reviewer posts nothing, or says it did not complete
- `superpowers:receiving-code-review` — verifying a finding before implementing it
- `dependency-cve-fix` — the same loop, scoped to Dependency-Track findings
- `docs/runbooks/static-analysis.md` (monorepo) — what the `sonar` job does, the
  operator setup it needs, and its six failure modes
- `docs/runbooks/software-factory.md` (monorepo) — the reviewer bot's architecture
