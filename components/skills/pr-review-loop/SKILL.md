---
name: pr-review-loop
description: Drive a simonrowe.dev pull request from ready-to-review to all-signals-green — pre-flight locally, open the PR, wait on CI, the code-review bot and SonarQube Cloud, triage findings, push, re-wait, bounded. Use when work is ready for review, a PR needs shepherding to green, or review/analysis findings need addressing.
---

# Pull Request Review Loop

A simonrowe.dev pull request is judged by **three independent signals**, each with
its own read mechanism and its own way of being misread:

| Signal | What it is |
| --- | --- |
| **CI checks** | `ci.yml` — backend, frontend, software-factory, and the `sonar` job (whose *gate* is advisory; a red *job* is not — step 4a) |
| **Reviewer verdict** | the `software-factory` container, commenting as `simonrowe-code-reviewer[bot]` |
| **Analysis findings** | SonarQube Cloud, project `simonjamesrowe_simonrowe-dev-monorepo` |

This skill owns the sequence: pre-flight locally → open the pull request → wait on
all three → triage → fix → push → re-wait, **bounded** → report.

Work from `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` or a Conductor
workspace clone.

> **The SonarQube reads in step 4c are verified.** Executed unauthenticated against
> the live project on 2026-08-26 (pull request #110): `api/issues/search` and
> `api/qualitygates/project_status` both return `200` with the shapes described in
> step 4c. `api/ce/activity` returns `401` — do not reach for it. See
> `docs/runbooks/static-analysis.md` in the monorepo for the setup this depends on.
>
> **What is *not* yet verified is a green `sonar` job.** As of 2026-08-26 the
> `Static Analysis` job fails on every pull request because SonarQube Cloud's
> Automatic Analysis is still enabled and refuses the CI scanner — see step 4a.
> Every analysis currently in the project came from Automatic Analysis and carries
> **no coverage data at all**. Until an operator switches the project to CI-based
> analysis, a green gate here means less than it looks like.

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

**Non-blocking checks** — a failure here does not stop a merge:

| Check | Why non-blocking |
| --- | --- |
| `evaluate` (Promptfoo Evals) | `continue-on-error: true` |
| `Static Analysis` (the `sonar` job) | `continue-on-error: true`, and `sonar.qualitygate.wait` is unset |

**Non-blocking is not the same as ignorable, and for `Static Analysis` the
distinction is the whole point.** Two different things get conflated under the word
"advisory":

- **The quality gate is advisory** — deliberately. `sonar.qualitygate.wait` is
  unset so a gate `ERROR` cannot fail the build. That is by design; triage the
  findings, do not treat the red as a build problem.
- **A red `Static Analysis` *job* is a broken scanner** — never by design. It means
  no analysis was published for this pull request at all. `continue-on-error: true`
  hides it behind a merge that still goes through, which is exactly how it stayed
  broken unnoticed from 2026-08-25 to 2026-08-26. **Diagnose it; do not shrug at
  it.**

So: check `Static Analysis` explicitly, every time, and if it is red read the log.

```bash
gh pr checks <pr> --json name,state,link | jq -r '.[] | "\(.state)\t\(.name)"'
gh run view --job <job-id> --log | grep -iE "sonar|automatic analysis|MISS|FAILED"
```

Diagnosing a red `Static Analysis` job, most likely cause first:

| In the log | Cause | What to do |
| --- | --- | --- |
| `You are running CI analysis while Automatic Analysis is enabled. Please consider disabling one or the other.` | Automatic Analysis is on in SonarQube Cloud. It wins; the Gradle scanner is refused and the job fails. | **You cannot fix this from a workspace.** It is a project setting: Administration → Analysis Method → CI-based, Automatic Analysis **off**. Runbook failure mode 1. Hand it back to the operator and say the analysis for this pull request did not run. |
| `MISS <path>` in the **Verify analysis inputs** step | A coverage artifact hand-off broke — renamed artifact, changed report path, or a skipped producing job. | Fix the path or the producing job. That step exists precisely to make this visible instead of letting coverage silently read 0%. |
| A project-not-found or authorisation error, roughly ten minutes in | `sonar.projectKey` does not match the account, or the token is wrong. | Runbook failure mode 4. The account is authoritative — change the key in `build.gradle.kts`. |

Two remaining traps:

- **`evaluate` is `paths:`-filtered.** Its normal state on an unrelated pull
  request is **absent**, not green. Waiting for it to appear waits forever. When
  grepping, match on `evaluate`, not `Promptfoo Evals`.
- **A green `Static Analysis` job does not prove an analysis was published.** The
  analysis step is guarded by `if: env.SONAR_TOKEN != ''`, and a skipped step still
  reports success. The secret has existed since 2026-08-25, so the guard should now
  fall open — but confirm against 4c rather than inferring it from the job colour.

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

```bash
# Was coverage actually measured? Read this before believing a green gate.
curl -s "https://sonarcloud.io/api/measures/component?component=simonjamesrowe_simonrowe-dev-monorepo&pullRequest=<pr>&metricKeys=coverage,new_coverage,ncloc"
```

**Check the coverage measure, not just the gate.** Automatic Analysis publishes a
perfectly plausible analysis that never reads JaCoCo or LCOV, so the failure
presents as a **green gate with no coverage metric at all** — the `measures` array
simply omits `coverage`. On 2026-08-26 that was the live state: gate `OK` on pull
request #110, four gate conditions, and **not one of them about coverage**, because
with no coverage measure the condition is dropped rather than failed. A green gate
under those conditions is a half-working analysis, not a pass.

Expect, once the project is on CI-based analysis: a `coverage` measure present, and
backend coverage within about a percentage point of the JaCoCo figure the
`backend` job enforces. A `new_coverage` gate condition will also appear, and may
report `ERROR` — still advisory, still worth triaging.

A `404` from any of these means the project or this pull request's analysis does
not exist. Check the operator checklist in `docs/runbooks/static-analysis.md`
rather than retrying — and check 4a, because a red `Static Analysis` job means
nothing was published for this pull request and there is genuinely nothing to read.

A gate status of `ERROR` is **advisory** — it does not block the merge. Triage the
findings anyway.

## 5. Triage

Three rules, applied to both the reviewer's findings and Sonar's.

**New code only.** Read Sonar's **New Code** view, not Overall. An unrelated pull
request does not get dragged into whatever pre-existing debt the first analysis of
`main` surfaced — that is separate work with its own plan. Same principle for the
reviewer: address what this change introduced.

The volume behind that rule, measured on 2026-08-26: `main` carries **149
unresolved issues** — 11 bugs, 8 vulnerabilities, 130 code smells — including at
least one `BLOCKER` (`java:S2187`, a test class with no test methods, on
`NarrationPropertiesTest`). None of it is yours unless your diff touched it. If a
pull request's issue count looks alarming, check you are not reading Overall.

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
- **CI state** — which checks are green and which are red. `evaluate` being absent
  is fine and worth saying so. A red **`Static Analysis`** job is **not** fine: report
  it as an analysis that did not run, with the cause from step 4a, rather than as an
  advisory failure to wave through. Only the quality gate is advisory.
- **Findings addressed** — what the reviewer and Sonar raised, and what changed.
- **Findings declined** — each one with the reason, and confirmation the reason is
  recorded in the pull request rather than only in this report.
- **Gate status** — pass, fail, or unknown, **and whether coverage was measured.**
  Those are two facts, not one: report the gate and say explicitly whether a
  `coverage` measure existed. "Gate OK, no coverage measured" is an honest and
  common answer; "gate OK" on its own implies an analysis that may not have
  happened. If the `Static Analysis` job was red, say the analysis did not run
  rather than reporting whatever stale figure the API returns.

If you hit the iteration bound, say that plainly and say what is still failing.

## Related

- `backend-test` — the backend Gradle incantations this skill defers to
- `code-review-triage` — when the reviewer posts nothing, or says it did not complete
- `superpowers:receiving-code-review` — verifying a finding before implementing it
- `dependency-cve-fix` — the same loop, scoped to Dependency-Track findings
- `docs/runbooks/static-analysis.md` (monorepo) — what the `sonar` job does, the
  operator setup it needs, and its six failure modes
- `docs/runbooks/software-factory.md` (monorepo) — the reviewer bot's architecture
