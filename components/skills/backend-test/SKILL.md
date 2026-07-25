---
name: backend-test
description: Run and interpret simonrowe.dev backend tests, checkstyle and coverage. Use when running tests, fixing checkstyle violations, or the pre-commit hook fails.
---

# Backend Tests, Checkstyle And Coverage

The backend quality gate is three independent Gradle tasks — checkstyle, tests,
JaCoCo coverage verification — and they run in the same order in CI
(`.github/workflows/ci.yml`) and in the local pre-commit hook. A commit is
blocked by whichever fails first, so run them in that order when debugging.

Work from `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` (or a Conductor
workspace clone). Gradle is a single-module build: `settings.gradle.kts` includes
only `backend`, so `:backend:<task>` and root `check` reach the same tasks.

## When to use

- Running the backend suite, one test class, or one test method.
- A checkstyle violation is blocking a commit.
- The pre-commit hook failed and you need to know which of the three gates broke.
- JaCoCo coverage verification failed and you need to know whether the new code
  is even in scope for coverage.

## Prerequisites

- Java 21 (the Gradle toolchain pins `JavaLanguageVersion.of(21)`).
- **Docker running.** Tests use Testcontainers, not the local compose stack —
  see step 2. You do *not* need `docker compose up`.
- Nothing else: no `.env`, no infrastructure ports, no Auth0. `tasks.test` sets
  `systemProperty("auth0.jwt.enabled", "false")` and `AbstractIntegrationTest`
  mocks `JwtDecoder`.

## Workflow

### 1. Run the thing you actually changed

```bash
./gradlew :backend:test                                       # whole suite (~74 test classes)
./gradlew :backend:test --tests 'com.simonrowe.blog.*'        # one package
./gradlew :backend:test --tests '*V014MakeFavouritesGlobalTest'
./gradlew :backend:test --tests '*V014MakeFavouritesGlobalTest.createsGlobalIndexesEnforcingUniqueTypeAndContent'
```

`--tests` patterns match the **fully qualified class name**, so a leading `*` is
the reliable form. Add `-i` for test-level stdout, and `--rerun-tasks` (or
`cleanTest`) when Gradle reports `UP-TO-DATE` and you want a genuine re-run.

The HTML report is the fastest way to read a failure:

```bash
open backend/build/reports/tests/test/index.html
```

### 2. Understand the test infrastructure before blaming the environment

- **MongoDB is a shared Testcontainer.** `backend/src/test/java/com/simonrowe/SharedMongoContainer.java`
  holds one `static MongoDBContainer("mongo:8")` started in a static initializer
  and wires `spring.data.mongodb.uri` via `@DynamicPropertySource`. One container
  for the entire suite — **which means tests share a database**. Any test that
  writes must clean up after itself (`@BeforeEach` *and* `@AfterEach` drop /
  `deleteAll`), or it will poison an unrelated class.
- **Kafka and Elasticsearch containers exist in exactly one place**:
  `ApplicationTests` (`@Testcontainers` with `ConfluentKafkaContainer` and
  `ElasticsearchContainer`). Everywhere else `AbstractIntegrationTest` mocks
  `ElasticsearchOperations`, `VectorStore`, `BlogSearchRepository`,
  `ImageVariantGenerator`, `ContentChangePublisher` and Embabel's `Ai` with
  `@MockitoBean` — so no network, no LLM calls, no Kafka.
- **`application-test.yml`** (`@ActiveProfiles("test")`) turns off the things that
  would otherwise reach out: `mongock.enabled: false`, kafka listener
  `auto-startup: false`, kafka/elasticsearch health indicators disabled, OTLP
  tracing export disabled, dummy `spring.ai.openai.api-key`, and it excludes the
  Spring AI / Embabel autoconfigurations. `uploads.path: target/test-uploads`.
- **Parallelism**: `maxParallelForks = max(cores / 2, 1)` with
  `maxHeapSize = "1536m"` per fork. A flaky-under-parallelism failure is usually
  the shared-Mongo problem above, not a real race in production code.
- Every `@TestPropertySource` value creates a **new Spring context** (it is part
  of the context cache key). That is used deliberately by
  `V011SeedAndBackfillDanVegaBlogIntegrationTest` to re-enable Mongock, but adding
  one casually costs a whole extra context boot.

### 3. Checkstyle

```bash
./gradlew :backend:checkstyleMain :backend:checkstyleTest
open backend/build/reports/checkstyle/main.html
```

Config is `config/checkstyle/google_checks.xml` (checkstyle `10.21.4`), applied
with `maxWarnings = 0` — so a single warning fails the task, and the config does
not lower severity to `warning` the way upstream Google checks do. `checkstyleTest`
is a separate task and is checked in CI and pre-commit: **test code is held to the
same bar.**

What actually trips people, given the enabled modules:

- `LineLength` max **100** (URLs, `package` and `import` lines are exempt).
- `Indentation` — 2 spaces, 4 for continuations; `FileTabCharacter` bans tabs.
- `AvoidStarImport`, `OneTopLevelClass`, `OuterTypeFilename`.
- `EmptyLineSeparator`, `WhitespaceAround`, `OperatorWrap`, `SeparatorWrap`,
  `MethodParamPad`, `ParenPad`, `GenericWhitespace` — pure formatting.
- `NeedBraces`, `OneStatementPerLine`, `MultipleVariableDeclarations`,
  `ModifierOrder`, `OverloadMethodsDeclarationOrder`,
  `VariableDeclarationUsageDistance`.
- `AbbreviationAsWordInName` — `HTTPClient` is a violation, `HttpClient` is not.
- Javadoc modules are only positional (`InvalidJavadocPosition`, `AtclauseOrder`,
  `NonEmptyAtclauseDescription`, `JavadocTagContinuationIndentation`). Javadoc is
  **not required** by checkstyle — but the codebase writes a class-level Javadoc
  explaining *why* on every non-trivial class, and change units especially. Match
  that.
- `SuppressWarningsFilter` + `SuppressWarningsHolder` are enabled, so
  `@SuppressWarnings("checkstyle:<ModuleName>")` works — treat it as a last
  resort and justify it in a comment.

Note `final` on parameters and `MissingJavadocMethod` are **not** enforced. The
codebase uses `final` parameters pervasively anyway; keep doing it for
consistency, not because a check demands it.

### 4. Coverage

```bash
./gradlew :backend:jacocoTestReport :backend:jacocoTestCoverageVerification
open backend/build/reports/jacoco/test/html/index.html
```

`jacocoTestCoverageVerification` enforces a single rule: **minimum `0.78`**
(instruction coverage, whole-bundle, JaCoCo `0.8.12`). It is wired into
`tasks.check`, so `./gradlew check` runs it.

Both the report and the verification apply the same exclusion list from
`backend/build.gradle.kts`:

```text
com/simonrowe/migration/**            com/simonrowe/dataops/**
com/simonrowe/embedding/**            com/simonrowe/agents/scrapers/SitemapHtmlScraper*
com/simonrowe/agents/scrapers/LumaApiScraper*
com/simonrowe/media/ExternalImageDownloader*
com/simonrowe/aggregation/AdminAggregationController*
com/simonrowe/agents/ContentAggregationAgent*
com/simonrowe/agents/WeeklyDigestAgent*
```

Read that as: migrations, data-ops and the network/LLM-bound agents and scrapers
are out of scope. **New code anywhere else needs tests**, and because it is a
single global threshold rather than a per-class rule, a large untested class drags
the whole build under 0.78 — expect the failure to name the aggregate, not your
file. Compare the HTML report before and after to find what you added.

Do not add an exclusion to make a failure go away. The list is for code that is
genuinely untestable without network or an LLM.

### 5. The full gate, as CI runs it

```bash
./gradlew check
```

`check` = checkstyleMain + checkstyleTest + test + `jacocoTestCoverageVerification`.
CI (`ci.yml`, on PRs to `main`) runs them as separate steps in that order, plus
`cyclonedxBom` and a conditional `sonar`. It does **not** run the frontend in the
same job — that is a separate `frontend` job.

### 6. Frontend, when the change touched it

```bash
cd frontend && npm test          # vitest run (one-shot)
cd frontend && npm run test:watch
cd frontend && npm run lint      # eslint, not part of the pre-commit hook
cd frontend && npm run build     # tsc -b && vite build — CI runs this
```

Vitest excludes `e2e/**`; Playwright specs run via `npm run e2e` (needs the local
stack — see `local-env`).

### 7. When the pre-commit hook fails

`.git/hooks/pre-commit` mirrors CI. It looks at staged paths only: `^backend/`
triggers checkstyle then `test` + `jacocoTestReport` +
`jacocoTestCoverageVerification`; `^frontend/` triggers `npm test -- --run`. If
neither matched it exits 0 immediately.

It runs Gradle with `--quiet`, so the printed message tells you the stage but not
the detail. Re-run the failing stage without `--quiet` to see it:

```bash
./gradlew :backend:checkstyleMain :backend:checkstyleTest
./gradlew :backend:test
./gradlew :backend:jacocoTestReport :backend:jacocoTestCoverageVerification
```

**Do not commit with `--no-verify`.** The same three gates run on the PR, so
skipping the hook only moves the failure to CI and hides it from you until then.
Fix the violation, add the test, or explain why the exclusion list should change.

## Gotchas

- **Tests do not need `docker compose up`** — but they *do* need a Docker daemon.
  "Could not find a valid Docker environment" means the daemon, not the compose
  stack. Conversely, having the local stack up does not affect tests: they talk to
  Testcontainers' ephemeral ports, never `27017`.
- **Shared MongoDB across the whole suite.** A test that leaves documents behind
  causes a failure in a *different*, innocent class. Copy the
  `@BeforeEach @AfterEach` drop pattern from `V014MakeFavouritesGlobalTest`.
- `mongock.enabled: false` in the test profile means change units **do not run** in
  tests. Drive them directly, or opt in per-class with
  `@TestPropertySource(properties = "mongock.enabled=true")`. See
  `mongock-migration`.
- `checkstyleTest` is easy to forget locally — run both checkstyle tasks together.
- `jacocoTestReport` `dependsOn(tasks.test)`, so asking only for the report still
  runs the suite. There is no "report from the last run" shortcut.
- The root project also has `check`; `./gradlew check` from the root is the same
  gate as `:backend:check` plus nothing meaningful. `./gradlew test` from the root
  does **not** include checkstyle or coverage.
- Sonar needs `SONAR_TOKEN` and is skipped locally; do not treat a missing Sonar
  result as a failure.
- CI runs on `ubuntu-latest` (x86) while the publish workflow uses ARM runners. A
  test that passes locally on Apple silicon and fails in CI is usually a container
  image / architecture issue, not your code.

## Related skills

- `local-env` — running the app for manual verification; tests do not need it.
- `mongock-migration` — the test patterns for change units, including the
  Mongock-enabled integration test.
- `prod-deploy` — the publish workflow that runs after CI passes and the PR merges.
- `prod-logs` — checking whether a fix actually landed on prod.
