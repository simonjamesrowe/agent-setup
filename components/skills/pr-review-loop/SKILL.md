---
name: pr-review-loop
description: Use when work is ready for review on simonrowe.dev, a pull request needs shepherding to green, reviewer or SonarQube findings need addressing, review conversations need resolving, or a green pull request needs its merge disposition decided.
---

# Pull Request Review Loop

A simonrowe.dev pull request is judged by **four independent signals**, each with
its own read mechanism and its own way of being misread:

| Signal | What it is | How it gates |
| --- | --- | --- |
| **CI build checks** | `ci.yml` — `Backend Build & Test`, `Frontend Build & Test`, `Software Factory Build & Test` | **required** by the `main` ruleset |
| **`Code Review` check run** | published by the `software-factory` container, which appears as `simonrowe-software-factory[bot]` | **required** by the ruleset |
| **Review threads** | the reviewer's individual findings, as inline conversations on the diff | ruleset requires **every** conversation resolved |
| **Analysis findings** | SonarQube Cloud, project `simonjamesrowe_simonrowe-dev-monorepo` | **advisory** — never blocks (step 4d) |

This skill owns the sequence: pre-flight locally → open the pull request → wait on
all four → triage → fix → push → re-wait, **bounded** → decide the merge
disposition → report.

Work from `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` or a Conductor
workspace clone.

## `main` is a real gate — read this before anything else

Since `038-pr-governance` the default branch carries an **active ruleset**. That
changes what this skill is for: it is no longer a quality ritual you could skip, it is
the route to a merge.

**Repository admins can bypass every rule** (`bypass_mode: always`, added
2026-08-29). That hatch exists so a `software-factory` outage cannot wedge the
repository — it is **not yours to use**. An agent driving this skill has exactly one
job at the gate: satisfy it. If you cannot, hand the pull request back and say what is
holding it. Merging past a red or absent check because you *can* destroys the only
signal the gate produces, and every bypass is permanently recorded in the repository's
rule-insights log.

The ruleset requires four checks (the three CI builds plus **`Code Review`**), every
review conversation resolved, linear history, and squash as the only merge method. It
requires **zero approving reviews** — deliberately, because GitHub forbids approving
your own pull request and a solo maintainer requiring one approval deadlocks forever.

Two consequences worth holding onto:

- **An absent required check blocks as hard as a failing one.** The `Code Review`
  check is created after the reviewer loads the pull request, so a review that dies
  earlier creates **no check at all** and the pull request is unmergeable with
  nothing red to point at. That is not a bug to wait out — go to step 4b.
- **A `software-factory` outage stops all *unattended* merging.** An accepted cost,
  recorded in the monorepo's `docs/runbooks/pr-governance.md`. An operator can merge
  past it as an admin; you cannot, and the repository's constitution prohibits manual
  overrides of quality gates. Report the outage and let a human make that call.

> **The reads in this skill are verified against live pull request #132**
> (2026-08-29): all four required checks present and `SUCCESS`; the reviewer
> commenting as `simonrowe-software-factory[bot]`; the GraphQL `reviewThreads` read
> in step 4c returning a well-formed (empty) node list; `scripts/classify-change.sh`
> returning all four dispositions; and SonarQube's `api/measures/component`,
> `api/issues/search` and `api/qualitygates/project_status` all `200`
> unauthenticated. `api/ce/activity` returns `401` — do not reach for it.
>
> **SonarQube Cloud is now genuinely working**, which older copies of this skill
> denied. As of pull request #132 the project is on CI-based analysis: gate `OK`
> with a real `new_coverage` condition (91.5% new, 67.2% overall). The `Static
> Analysis` job is green. Treat a red one as broken, per step 4a.

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
  because the repository is public (step 4d).

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

## 4. Wait on all four signals

Do not stop at CI. All four, every time.

### 4a. CI checks

```bash
gh pr checks --watch
```

**Required checks** — the ruleset will not let a merge happen without all four:

- `Backend Build & Test`
- `Frontend Build & Test`
- `Software Factory Build & Test`
- `Code Review` — not from `ci.yml`; see step 4b

**Non-blocking checks** — a failure here does not stop a merge:

| Check | Why non-blocking |
| --- | --- |
| `evaluate` (Promptfoo Evals) | `continue-on-error: true`, and `paths:`-filtered — deliberately not required, since an absent required check blocks forever |
| `Static Analysis` (the `sonar` job) | `continue-on-error: true`, so a green one is meaningless as a gate |
| `SonarCloud Code Analysis` (from `sonarqubecloud[bot]`) | the gate is intentionally advisory; requiring it would leave no legitimate escape hatch, and the constitution bans manual overrides |

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
  fall open — but confirm against 4d rather than inferring it from the job colour.

### 4b. Reviewer verdict — the `Code Review` check run

**Read the check run, not the comment.** The check is what the merge gate reads, and
it is the only one of the two that can be *absent*:

```bash
gh pr checks <pr> --json name,state --jq '.[] | select(.name=="Code Review")'
```

| Observation | Meaning | Action |
| --- | --- | --- |
| `SUCCESS` | reviewed; no `CRITICAL`, verdict not `REQUEST_CHANGES` | on to 4c — findings may still exist and still block |
| `FAILURE` | a `CRITICAL` finding **or** a `REQUEST_CHANGES` verdict | triage (step 5); this is hard-red |
| **absent** | the review never got far enough to create it | → `code-review-triage`, then re-trigger (below) |

**Absent is the failure mode to actually worry about,** because there is nothing red
to see — `gh pr checks` simply lists one check fewer, and an absent required check
blocks the merge just as hard as a failing one. Match on the name and assert it is
there; never infer a pass from "nothing was red".

Only `success` and `failure` are ever sent — the reviewer deliberately never emits
`neutral`, because whether `neutral` satisfies a required check is version-dependent
GitHub behaviour the gate must not rest on.

The verdict comment carries the reasoning, and is worth reading once the check
resolves:

```bash
gh api repos/simonjamesrowe/simonrowe-dev-monorepo/issues/<pr>/comments \
  --jq '.[] | select(.user.login=="simonrowe-software-factory[bot]") | {created_at, body}'
```

The login is `simonrowe-software-factory[bot]`. **Not** `simonrowe-code-reviewer[bot]`
— that account does not exist, and older copies of this skill named it, which made
this read return empty on every pull request and so made every review look failed.

**Do not read `/pulls/<pr>/reviews`.** The reviewer posts an *issue comment* plus
inline comments, never a formal submitted review, so the reviews list is **empty even
on a successfully reviewed pull request**. Reading it produces a false "not reviewed
yet" that never resolves.

**Silence still means failure, not approval.** Per the `code-review-triage` skill, a
failed review frequently posts nothing at all. Never conclude from a quiet pull
request that it passed.

**Cardinality trap.** The reviewer posts **one comment per pull request** but
**re-reviews per pushed commit** (the Temporal workflow id embeds the head SHA). A
second push produces no second comment, so you cannot infer how many reviews have
happened from how many comments exist. Read the `Commit <sha>` line in the comment
body to see which commit the verdict is actually about.

**Re-triggering a review the webhook can never repeat.** The webhook builds its
workflow id from the head SHA under `REJECT_DUPLICATE`, so the same commit can never
be re-reviewed from GitHub — not after a failed review, and not after one whose
webhook never arrived. Pushing an empty commit is *not* the workaround. The manual
trigger on `/admin/software-factory` sends no `expectedHeadSha`, which makes the
service mint a UUID workflow id instead; that omission is the entire mechanism. Use
it, or ask the operator to. Note its **dry run posts nothing whatsoever** — no
findings, no verdict, no check run — so its outcome is visible only in that page's run
progress.

### 4c. Review threads — every conversation must be resolved

The ruleset requires conversation resolution, so **any** unresolved finding blocks the
merge regardless of severity. A `SUGGESTION` nobody answered is as blocking as a
`CRITICAL`. This is why far fewer pull requests merge unattended than
"backend-only ⇒ auto-merge" suggests.

Findings arrive as inline conversations on the diff (`/pulls/<pr>/comments`). Read
their resolution state with **GraphQL** — REST can neither see `isResolved` nor set
it, which is the actual reason the reviewer used to delete and repost its findings
instead of reconciling them:

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      reviewThreads(first:100){
        nodes{ id isResolved isOutdated path line
               comments(first:1){nodes{author{login} body}} }
      }
    }
  }
}' -F owner=simonjamesrowe -F repo=simonrowe-dev-monorepo -F pr=<pr> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved==false)
        | {path, line, body: .comments.nodes[0].body[0:120]}'
```

An empty result means nothing is outstanding. Anything listed is a merge blocker —
take it to step 5, which is where the two legitimate ways to clear one are.

**The reviewer never resolves a thread on your behalf while the finding still
stands.** It reconciles its own threads across re-reviews and replies *"No longer
reported as of `<sha>`"* on ones that have gone away — deliberately not "Fixed",
because a re-worded finding title produces exactly the same state as a genuine fix, so
claiming a fix would be a lie. Do not read that reply as a verdict on your change.

### 4d. Analysis findings and gate

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

**Check the coverage measure, not just the gate.** The old Automatic Analysis
published a perfectly plausible analysis that never read JaCoCo or LCOV, and the
failure presented as a **green gate with no coverage metric at all** — the `measures`
array simply omitting `coverage`, so the condition was dropped rather than failed.

The project is on CI-based analysis now, so the healthy shape is: a `coverage` measure
present, a `new_coverage` gate condition present, and backend coverage within about a
percentage point of the JaCoCo figure the `backend` job enforces. Pull request #132
measured `coverage` 67.2, `new_coverage` 91.5, gate `OK` with five conditions
including `new_coverage`. **A gate `OK` with no `coverage` measure at all is a
regression to the half-working state** — report it as such rather than as a pass.

**One legitimate exception, and it is easy to misreport:** a pull request that changes
no analysable code — docs, JSON, a ruleset — has no new lines to measure, so
`new_coverage` is absent from both the measures and the gate conditions while
`coverage` is still present. That is correct, not broken. Pull request #133 (JSON and
markdown only) returned gate `OK`, four conditions, none of them `new_coverage`, and
`coverage` 67.2. The distinction that matters is **`coverage` missing** (broken
analysis) versus **`new_coverage` missing on a change with no analysable lines**
(nothing to measure).

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

### Clearing a review thread

A blocking conversation has exactly two legitimate endings, and **both** end with the
thread resolved — resolving is what the gate reads, so a fix you never resolve still
blocks:

1. **Fixed.** Push the fix, then resolve the thread. The reviewer's own
   *"No longer reported"* reply is not resolution; you still resolve it.
2. **Declined.** Reply in the thread with *why*, then resolve it. The reply is not
   optional courtesy — it is the only place the decision is recorded, and resolving
   without it silently erases a finding a future reader would want to see.

Resolving needs GraphQL (REST cannot set `isResolved`), using the thread `id` from
step 4c:

```bash
# reply first, if declining
gh api graphql -f query='mutation($t:ID!,$b:String!){
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t, body:$b}){
    comment{ id } } }' -F t=<threadId> -F b="Declined: <reason>"

# then resolve
gh api graphql -f query='mutation($t:ID!){
  resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' -F t=<threadId>
```

**Never resolve a thread you have neither fixed nor answered.** It is mechanically
trivial and it defeats the entire gate — the one control that makes a `SUGGESTION`
matter. If you cannot fix it and cannot justify declining it, hand it back instead.

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

Then re-read all four signals. Remember the reviewer will re-review this commit but
will not post a second comment — and that a re-review reconciles its threads rather
than reposting them, so a thread you already resolved stays resolved.

**Bound this at roughly three fix-and-push iterations.** After that, stop and hand
it back with what you tried and what is still failing. Looping on something that
will not go green wastes tokens and buries the signal — the same bound
`dependency-cve-fix` applies.

## 7. Decide the merge disposition — and arm auto-merge if it earns it

**Do not decide this by judgement.** The repository ships a classifier; run it. A
default-deny path list is testable as a script and rots invisibly as prose, which is
why it is not written out here:

```bash
scripts/classify-change.sh origin/main
# or, to classify an explicit set:
printf 'backend/src/main/java/A.java\n' | scripts/classify-change.sh
```

It prints two lines — `category=auto-merge|ux-review|manual` and
`ux_affecting=true|false` — and **exits 0 for every category, `manual` included**.
"Needs a human" is an answer, not an error; a non-zero exit means the script itself
broke.

| `category` | What you do |
| --- | --- |
| `auto-merge` | `gh pr merge <pr> --auto --squash`, and say so in the pull request body |
| `ux-review` | **no auto-merge.** Capture screenshots of the affected screens, attach them, state why the merge is being left to a human |
| `manual` | **no auto-merge.** State in the body which path forced it |

Precedence is highest-first: `manual` paths (compose files, `scripts/**`, `config/**`,
`.github/**`, `gradle*`, root build files, `frontend/*.config.*`,
`frontend/package*.json`) **outrank** `auto-merge` ones. That is not an oversight — an
auto-merge to `main` triggers Publish, which triggers an **unattended production
deploy against the Pi**, and `036-auto-deploy-rollout-fixes` is a nine-item catalogue
of ways those fail that no test catches. An unrecognised path is `manual`, never
`auto-merge`, so a new top-level directory defaults to needing a human.

**`--auto` is the merge mechanism, not permission to stop watching.** GitHub merges
when the gate is satisfied; it will sit there indefinitely if it never is. Finish steps
4–6 and report the real state either way. Two traps:

- **`--auto` is rejected on a pull request that is already mergeable** ("clean
  status"). If every check is already green, either merge outright with
  `gh pr merge <pr> --squash` or accept the error — it means the gate is already
  satisfied, not that arming failed.
- **Arming auto-merge does not resolve anything.** An unresolved conversation from
  step 4c holds the merge forever with no error message. Clear those first.

**Never merge to satisfy this step.** If the classifier says `ux-review` or `manual`,
the disposition *is* the deliverable — hand it over with the classification named.

## 8. Report

State all six:

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
  `coverage` measure existed. "Gate OK, no coverage measured" is a half-working
  analysis, not a pass. If the `Static Analysis` job was red, say the analysis did not
  run rather than reporting whatever stale figure the API returns.
- **Merge disposition** — the `category` the classifier returned, and what you did
  about it: auto-merge armed, screenshots captured, or left to a human with the
  reason. Say whether the pull request is actually mergeable now or still held, and by
  what.

**Report the `Code Review` check explicitly, including when it is absent.** "The
reviewer was quiet" is not a report — an absent check is an unmergeable pull request,
and saying nothing about it is how that gets mistaken for a pass.

If you hit the iteration bound, say that plainly and say what is still failing.

## Related

- `backend-test` — the backend Gradle incantations this skill defers to
- `code-review-triage` — when the reviewer posts nothing, or says it did not complete
- `superpowers:receiving-code-review` — verifying a finding before implementing it
- `dependency-cve-fix` — the same loop, scoped to Dependency-Track findings
- `docs/runbooks/pr-governance.md` (monorepo) — the ruleset, the fingerprinted
  threads, the `Code Review` check, and the auto-merge policy this skill enacts
- `docs/runbooks/static-analysis.md` (monorepo) — what the `sonar` job does, the
  operator setup it needs, and its six failure modes
- `docs/runbooks/software-factory.md` (monorepo) — the reviewer bot's architecture
