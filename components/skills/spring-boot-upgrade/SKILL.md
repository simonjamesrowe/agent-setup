---
name: spring-boot-upgrade
description: Upgrade the simonrowe.dev backend across Spring Boot versions with OpenRewrite, via the Moderne MCP server or the OpenRewrite Gradle plugin. Use when bumping Spring Boot to a new major or minor line, running an OpenRewrite recipe, or a framework upgrade breaks the build.
---

# Spring Boot Upgrades With OpenRewrite

The code transformation here is **deterministic**: OpenRewrite recipes parse the
project into a typed model and apply declarative edits. No model writes the
migration, so do not hand-edit what a recipe covers. Your job is the four things
the recipe cannot do: preflight the tree, settle the dependency blockers, pick
and run the right recipe, and read the test output honestly afterwards.

Work from `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` or a Conductor
workspace clone. Gradle includes **two** Spring Boot modules — `:backend:` and
`:reviewer:` — and a recipe run rewrites build files repo-wide, so expect both
in the diff even when only the backend is in scope.

Heavy detail lives in
[`references/spring-boot-4-playbook.md`](references/spring-boot-4-playbook.md):
the full chained-recipe list, the manual checklist with sources, the blocker
matrix, credential setup and rollback. Read it before running anything.

## When to use

- Bumping Spring Boot to a new major or minor line (3.5 → 4.0 is the live one).
- Running any OpenRewrite recipe against the monorepo.
- A framework upgrade has broken compilation, context startup or the test suite.
- Deciding whether an upgrade is even possible yet — the blocker check below is
  worth running on its own, before committing to the work.

## Recipe artifacts — no credential needed today

OpenRewrite recipes are **moving** off Maven Central to the Code Genome Project.
They have not moved. As of 2026-08-21 Maven Central serves
`rewrite-spring:6.37.1` — the same latest release the OpenRewrite version table
lists — so **both paths below work with no credential at all.** Path B pins that
version and lists `mavenCentral()`; it resolves as written.

Skip this section until you need a release newer than Central carries. The
credential comes **from Moderne**, not from an account you create, so it may
simply be unavailable to you — another reason not to gate an upgrade on it. When
you do have one, store the username and download token in
`~/workspace/simonjamesrowe/env` as **`CODE_GENOME_USERNAME`** and
**`CODE_GENOME_TOKEN`** — never inline a value, never echo one — and then:

```bash
mod config recipes artifacts maven add https://artifacts.codegenomeproject.org/maven \
  --user "$CODE_GENOME_USERNAME" --password "$CODE_GENOME_TOKEN"
mod config recipes jar install org.openrewrite.recipe:rewrite-spring:LATEST
mod config recipes artifacts show   # read-only: confirms the URL took
mod config recipes list             # read-only: confirms the recipes landed
```

`mod config recipes --help` says `mod config moderne` must be configured first,
and on this machine `mod config moderne show` reports no tenant. The
`recipes artifacts` subtree answers anyway; `mod config recipes moderne
install|sync` will not until `mod config moderne login`. Full detail, including
the Gradle-side credentialed repository block, is in the reference file.

If Moderne agent tools are not yet registered, install them **per agent** —
`mod config agent-tools claude install`. Do not run the blanket
`mod config agent-tools install`: it provisions all eight agents it supports and
writes `.github/instructions/` and `.vscode/mcp.json` into the current working
directory.

## Preflight — do all of this before touching a recipe

### 1. Clean working tree

```bash
git status --porcelain      # must print nothing
git switch -c chore/spring-boot-4
```

This is not hygiene, it is the rollback plan. `git checkout -- .` cannot tell
your edits from the recipe's, so a dirty tree means a bad run destroys both. If
the tree cannot be made clean, `git stash -u` first.

### 2. Establish the real versions

Read them, do not recall them: `gradle/libs.versions.toml`,
`backend/build.gradle.kts`, `reviewer/build.gradle.kts`, the root
`build.gradle.kts` toolchain block and `gradle/wrapper/gradle-wrapper.properties`.

The spring-tools MCP server answers the rest: `getProjectList` for the project
names, then `getSpringBootVersion` and `getJavaVersion` per project, and
`getReleases` (project slug `spring-boot`) for what is GA upstream.
**`getLatestBootVersionsFromMavenRepo` returns null for Gradle projects** — it
only works for Maven — so use `getReleases` / `getUpcomingReleases` instead.

### 3. Settle the blockers — **stop here if any is unresolved**

Work the blocker matrix in the reference file. As of 2026-08-21, against Boot
4.0:

| Dependency | Monorepo | Boot 4 floor | Verdict |
| --- | --- | --- | --- |
| Java | 21 | 17 | fine |
| Gradle wrapper | 8.13 | 8.14 | recipe bumps it |
| Spring AI | 1.1.8 | **2.0.1** | available — **but check per artifact** |
| Embabel | 0.3.5 | **1.5.0** | available, but a 0.x → 1.x jump |
| Mongock | 5.5.1 | **nothing published** | **unresolved — the real risk** |
| CycloneDX plugin | 2.1.0 | 3.0.0 | manual bump, no recipe |

**Spring AI needs artifact-level checking.** Three of the five modules the
backend declares have a clean `2.0.1`; two do not.
`spring-ai-advisors-vector-store` was **renamed** to
`spring-ai-vector-store-advisor`, and `spring-ai-starter-model-openai-sdk` has
**no 2.0 GA under any name** (its 2.0 line stopped at `2.0.0-M4`). Bumping
`springAi` blind fails resolution on both. Per-artifact table in the reference.

Mongock 5.5.1 is its latest release; its POMs upper-bound Boot at
`[3.0.0-RC1, 4.0.0)` and Spring Framework at `[6.0.0-RC2, 7.0.0)`, and no
`mongock-springboot-v4` exists. Every class it references *does* still exist in
Boot 4.0.8 and Spring Data MongoDB 5.0.7, so it may well run — but "may well
run" is not good enough for the mechanism every production data change ships
through. The reference file has the evidence, the test that settles it, and the
fallbacks.

**If a blocker is unresolved, stop and report it. Do not run the recipe.** A
30-second version check beats discovering it in a 40-file diff.

## Path A — Moderne MCP server (default)

**Treat the first run as exploratory.** This procedure comes from the recipe's
published definition and artifact, not from a completed run on this repo — the
recipe ID, chain and empty option list are verified, its behaviour *here* is not.
Prefer Path B's `rewriteDryRun` for the first pass, and report what you saw
rather than what should have happened.

1. **Wait for the model to be built.** Check `lst_status` and `build_status`
   first. The MCP server builds LSTs in the background and must be started from
   inside a git repository; a recipe run against a partially built LST silently
   under-applies rather than failing.
2. **Find the recipe through the catalogue**, do not type a name from memory:
   `edit_code` with a natural-language outcome ("migrate to Spring Boot 4"). It
   returns ranked recipe names with a `recipeCount`.
3. **Read its options**: `learn_recipe` on
   `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`. It currently takes
   none — confirm that rather than assuming it, and read the sub-recipe count:
   this composite chains roughly thirty.
4. **Run it**: `run_recipe` with
   `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`. The result's
   `filesChanged` is your first signal; a result with `searchResults` and a
   `matchCount` instead means you picked a search-only variant.
5. **See which sub-recipes actually fired**, rather than inferring it from the
   diff — `query_datatable` against `SourcesFileResults`.
6. **Size the change before reading it**:

   ```bash
   git diff --stat
   ```

   Then review by area — build files, then config, then JUnit and Jackson churn
   (the two biggest), then production Java.


## Path B — OpenRewrite Gradle plugin (fallback)

For a machine without the `mod` CLI. This edits build files temporarily; the
edit must not reach a commit.

Add to the root `build.gradle.kts` — `mavenCentral()` is sufficient for 6.37.1;
the reference file has the credentialed Code Genome variant:

```kotlin
plugins { id("org.openrewrite.rewrite") version "7.39.0" }
dependencies { rewrite("org.openrewrite.recipe:rewrite-spring:6.37.1") }
rewrite { activeRecipe("org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0") }
```

Then:

```bash
./gradlew rewriteDryRun     # writes build/reports/rewrite/rewrite.patch
./gradlew rewriteRun
```

The scaffolding must not land in a commit — but **do not blanket-revert the root
build file.** The recipe edits it too: it declares
`id("org.springframework.boot") … apply false`, `io.spring.dependency-management`
and the cyclonedx/sonarqube aliases, all reachable by the chain's
`UpgradePluginVersion` steps. The diff will hold your scaffolding *and* a real
plugin bump, and `git checkout --` throws the bump away. Either:

```bash
git diff -- build.gradle.kts      # expect scaffolding AND a plugin bump
# Option 1: delete the plugin block / rewrite dependency / rewrite {} block by hand.
# Option 2: stage the recipe's hunks, then discard the rest:
git add -p build.gradle.kts
git checkout -- build.gradle.kts  # only drops what you did not stage
```

Never write a username or token into a build file, a `gradle.properties`, or a
comment.

## Manual checklist after the recipe

Each of these is in the reference file with a source link:

- **Jackson 3 — the recipe already did your source. Review it, do not redo it.**
  `UpgradeSpringBoot_4_0` → `UpgradeSpringFramework_7_0` chains
  `org.openrewrite.java.jackson.UpgradeJackson_2_3`, and `rewrite-spring`
  declares `rewrite-jackson:1.29.0` at **`runtime`** scope, so it is on the
  classpath by default — including under Path B, which only names
  `rewrite-spring`. Expect `com.fasterxml.jackson` → `tools.jackson` imports and
  `IOException` → `JacksonException` catch rewrites in the diff; that is the
  recipe working, not over-applying. **Running `UpgradeJackson_2_3` again is a
  double migration.** What to check: the three annotation-only imports
  (`JsonProperty`, `JsonInclude`, `JsonIgnoreProperties`) must **not** have
  moved — `jackson-annotations` keeps the `com.fasterxml.jackson.core` groupId.
- **JUnit 5 → 6, Spring Kafka 4.0 and JSpecify annotations** also come in through
  `UpgradeSpringFramework_7_0`. Boot 4.0.8 manages `junit-jupiter` 6.0.3, so
  across ~74 test classes JUnit is one of the largest parts of the diff. Nothing
  to do — but know it is coming before you read the diff.
- **Modular starters.** `spring-boot-starter-web` → `spring-boot-starter-webmvc`,
  `spring-boot-starter-oauth2-resource-server` →
  `spring-boot-starter-security-oauth2-resource-server`, `spring-kafka` →
  `spring-boot-starter-kafka`, `spring-security-test` →
  `spring-boot-starter-security-test`. Confirm they landed without version
  literals.
- **`@MockBean`/`@SpyBean` are removed, not deprecated** → `@MockitoBean` /
  `@MockitoSpyBean`. The backend already migrated, so expect a no-op.
- **Gradle wrapper** must end up at 8.14+ or 9.x; **CycloneDX plugin** at 3.0.0+,
  which no recipe does for you.
- **Boot 4.0.x or 4.1.1 is an open decision.** The recipe pins `4.0.x`; Spring
  AI 2.0.1 and Embabel 1.5.0 *declare* `4.1.x` deps, which a consuming BOM
  manages back down — they do not pull Boot 4.1 in. There is no 4.1 recipe, so
  4.1.1 means a separate hand-bump after the run. The reference file has the
  trade-off table and the `./gradlew :backend:dependencies` check that settles
  what actually resolved.
- **`repo.embabel.com`** in `backend/build.gradle.kts` is no longer needed —
  Embabel publishes to Maven Central.
- Runtime config the recipe cannot see: `logback-spring.xml`, our own
  `application*.yml` keys, the OTLP/Micrometer tracing wiring.

## Verification — in this order

```bash
./gradlew :backend:checkstyleMain :backend:checkstyleTest
./gradlew :backend:test
./gradlew :backend:jacocoTestCoverageVerification
```

Delegate the detail to `backend-test` — it covers the shared Mongo
Testcontainer, the `--tests` patterns, the checkstyle modules that actually trip
people and the 0.78 coverage floor. Then:

- Spring-specific validation from the spring-tools MCP server:
  `getProjectDiagnostics` per project (call `refreshWorkspace` first if the
  language server has not re-indexed since the recipe run).
- **A Mongock-enabled test.** The suite sets `mongock.enabled: false`, so a green
  run proves nothing about migrations. Run the class that opts back in
  (`@TestPropertySource(properties = "mongock.enabled=true")`) specifically.
- **A runtime smoke test** via `local-env`. A Boot major upgrade breaks things at
  context startup that compile and unit-test perfectly: missing
  autoconfiguration, a bean that no longer exists, a property that was renamed.

**Do not claim the upgrade works before test output has been seen.** Not "should
pass", not "the recipe handled it" — the actual output. The same standard applies
to the recipe run itself: nobody has completed one on this repo yet.

## Gotchas

- **A dirty tree defeats rollback.** `git checkout -- .` and `git clean -fd`
  cannot separate your work from the recipe's, and `git clean -fd` also deletes
  untracked scratch files. Clean tree, or `git stash -u`, before the run.
- **Recipes are per-repository, not per-module.** The recipe rewrites
  `reviewer/build.gradle.kts` alongside `backend/`. The frontend is untouched —
  it is not on the JVM LST at all.
- **Review a large `rewriteRun` in chunks.** Reviewed as one blob is not
  reviewed. Build files, then config, then the JUnit 5→6 and Jackson 2→3 churn,
  then production Java; `git add -p` helps hold the line.
- **`UP-TO-DATE` is a lie after a recipe run.** Gradle caches aggressively and
  the recipe changed inputs it does not track well: add `--rerun-tasks`, or
  `cleanTest` for the test task, when a task is skipped.
- **The recipe will happily bump a dependency whose Boot 4 release does not
  exist.** It surfaces as a Gradle *resolution* failure, not a recipe error, so
  the message points at the artifact and not at the recipe. Check the blocker
  matrix first rather than debugging resolution backwards.
- **`Testcontainers2Migration` moves you to Testcontainers 2.x** — a major jump
  from the pinned 1.20.4. Delete the catalogue pin so the Boot BOM manages it.
- **A version-level "it's available" is not a check.** Spring AI 2.0.1 exists and
  still breaks resolution: one module was renamed, one has no 2.0 GA. Check
  artifacts, not version lines.
- **The `:reviewer:` module's Temporal starter** still references a Boot class
  removed in 4.0. Upgrading `:backend:` alone first is a legitimate strategy.

## Related skills

- `backend-test` — the three quality gates in detail, and the test infrastructure
  a Boot upgrade is most likely to disturb.
- `local-env` — the runtime smoke test; compile-clean is not startup-clean.
- `dependency-cve-fix` — the version-catalogue conventions and how to pick a
  target version for a single dependency.
- `mongock-migration` — the change-unit patterns and the Mongock-enabled test
  that decides the Mongock blocker.
- `prod-deploy` — shipping the upgrade once CI is green.
