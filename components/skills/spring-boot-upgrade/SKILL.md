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

## One-time setup: recipe artifacts

OpenRewrite recipes are moving off Maven Central to the **Code Genome Project**.
`rewrite-spring:6.37.1` still resolves from Maven Central today, but newer
releases will not, and `https://artifacts.codegenomeproject.org/maven` rejects
unauthenticated requests. **Both paths below need this configured**, so do it
once and stop guessing.

1. Get credentials from Moderne — not by signing up yourself; the entitlement is
   attached to the Moderne-provided identity. You need a username and a
   **download token**, used as an HTTP Basic password.
2. Store them in `~/workspace/simonjamesrowe/env` as **`CODE_GENOME_USERNAME`**
   and **`CODE_GENOME_TOKEN`**. Never inline a value, never echo one, never let
   one reach a build file.
3. Point the CLI at the repository and install the recipe artifact:

   ```bash
   mod config recipes artifacts maven add https://artifacts.codegenomeproject.org/maven \
     --user "$CODE_GENOME_USERNAME" --password "$CODE_GENOME_TOKEN"
   mod config recipes jar install org.openrewrite.recipe:rewrite-spring:LATEST
   ```

4. Verify, read-only:

   ```bash
   mod config recipes artifacts show   # should print the Code Genome URL
   mod config recipes list             # should list rewrite-spring
   mod config moderne show             # tenant status
   ```

`mod config recipes --help` states that `mod config moderne` must be configured
first. On this machine `mod config moderne show` currently reports *"There is no
currently configured Moderne tenant"* — the `recipes artifacts` subtree still
answers without one, but `mod config recipes moderne install|sync` will not.
Run `mod config moderne login` (or `mod config moderne edit`) if you need those.

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
| Spring AI | 1.1.8 | **2.0.0** | available |
| Embabel | 0.3.5 | **1.5.0** | available, but a 0.x → 1.x jump |
| Mongock | 5.5.1 | **nothing published** | **unresolved — the real risk** |
| CycloneDX plugin | 2.1.0 | 3.0.0 | manual bump, no recipe |

Mongock 5.5.1 is its latest release and its POMs upper-bound Spring Framework at
`[6.0.0-RC2, 7.0.0)` and Spring Boot at `[3.0.0-RC1, 4.0.0)` — Boot 4 is
explicitly outside the declared range and there is no `mongock-springboot-v4`
artifact. Every class it actually references does still exist in Boot 4.0.8 and
Spring Data MongoDB 5.0.7, so it may well run — but "may well run" is not good
enough for the mechanism every production data change ships through. The
reference file has the evidence, the exact test that settles it, and the
fallbacks.

**If a blocker is unresolved, stop and report it. Do not run the recipe.** A
30-second version check beats discovering it in a 40-file diff.

## Path A — Moderne MCP server (default)

1. **Wait for the model to be built.** Check `lst_status` and `build_status`
   first. The MCP server builds LSTs in the background and must be started from
   inside a git repository; a recipe run against a partially built LST silently
   under-applies rather than failing.
2. **Confirm the recipe exists**: `search_recipes` for `UpgradeSpringBoot_4_0`.
3. **Read its options**: `learn_recipe` on
   `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`. It currently takes
   none — confirm that rather than assuming it.
4. **Run it**: `run_recipe` with
   `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`.
5. **Size the change before reading it**:

   ```bash
   git diff --stat
   ```

   Then review by area — build files, then config, then test annotations, then
   production Java.

## Path B — OpenRewrite Gradle plugin (fallback)

For a machine without the `mod` CLI. This edits build files temporarily; the
edit must not reach a commit.

Add to the root `build.gradle.kts`:

```kotlin
plugins {
  id("org.openrewrite.rewrite") version "7.39.0"
}

repositories {
  mavenCentral()
  maven {
    url = uri("https://artifacts.codegenomeproject.org/maven")
    credentials {
      username = System.getenv("CODE_GENOME_USERNAME")
      password = System.getenv("CODE_GENOME_TOKEN")
    }
  }
}

dependencies {
  rewrite("org.openrewrite.recipe:rewrite-spring:6.37.1")
}

rewrite {
  activeRecipe("org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0")
}
```

Then:

```bash
./gradlew rewriteDryRun     # writes build/reports/rewrite/rewrite.patch
./gradlew rewriteRun
```

Afterwards, **revert the scaffolding** so the plugin block, the `rewrite`
dependency and the Code Genome repository never land in a commit:

```bash
git diff -- build.gradle.kts        # confirm only your scaffolding is there
git checkout -- build.gradle.kts
```

Credentials come from the environment. Do not write a username or token into a
build file, a `gradle.properties`, or a comment.

## Manual checklist after the recipe

Each of these is in the reference file with a source link:

- **Jackson 3.** Boot 4 manages Jackson `3.1.5`; `com.fasterxml.jackson` becomes
  `tools.jackson`, except `jackson-annotations`, which does not move. The Boot
  recipe does **not** migrate Jackson Java code — run
  `org.openrewrite.java.jackson.UpgradeJackson_2_3` afterwards.
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
- **Spring AI 2.0 and Embabel 1.5.0** both target Boot **4.1.x**, while the
  recipe pins Boot `4.0.x`. Reconcile deliberately; landing on 4.1.1 is likely
  the right call.
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
pass", not "the recipe handled it" — the actual output.

## Gotchas

- **A dirty tree defeats rollback.** `git checkout -- .` and `git clean -fd`
  cannot separate your work from the recipe's, and `git clean -fd` also deletes
  untracked scratch files. Clean tree, or `git stash -u`, before the run.
- **Recipes are per-repository, not per-module.** The recipe rewrites
  `reviewer/build.gradle.kts` alongside `backend/`. The frontend is untouched —
  it is not on the JVM LST at all.
- **Review a large `rewriteRun` in chunks.** Forty changed files reviewed as one
  blob is not reviewed. Read build files, then config, then test annotations,
  then production Java, and `git add -p` if that helps hold the line.
- **`UP-TO-DATE` is a lie after a recipe run.** Gradle caches aggressively and
  the recipe changed inputs it does not track well: add `--rerun-tasks`, or
  `cleanTest` for the test task, when a task is skipped.
- **The recipe will happily bump a dependency whose Boot 4 release does not
  exist.** It surfaces as a Gradle *resolution* failure, not a recipe error, so
  the message points at the artifact and not at the recipe. Check the blocker
  matrix first rather than debugging resolution backwards.
- **`Testcontainers2Migration` moves you to Testcontainers 2.x** — a major jump
  from the pinned 1.20.4. Delete the catalogue pin so the Boot BOM manages it.
- **Boot 4.0 vs 4.1.** The recipe pins `4.0.x`; the AI stack wants `4.1.x`.
  Decide before running, not after the dependency report argues with you.
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
