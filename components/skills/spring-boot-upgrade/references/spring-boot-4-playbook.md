# Spring Boot 4.0 playbook

Reference material for the `spring-boot-upgrade` skill. Everything here was
verified on **2026-08-21** against the sources linked inline. Re-verify the
version numbers before relying on them — Spring Boot 4.1.x is already GA and
the recipe pins the 4.0 line.

Baselines read out of `~/workspace/simonjamesrowe/simonrowe-dev-monorepo`
(`gradle/libs.versions.toml`, `backend/build.gradle.kts`, `build.gradle.kts`,
`gradle/wrapper/gradle-wrapper.properties`, `settings.gradle.kts`):

| Thing | Monorepo today |
| --- | --- |
| Spring Boot | `3.5.16` |
| `io.spring.dependency-management` | `1.1.7` |
| Spring AI | `1.1.8` |
| Embabel | `0.3.5` (pinned inline in `backend/build.gradle.kts`, not the catalogue) |
| Mongock | `5.5.1` |
| Testcontainers | `1.20.4` |
| CycloneDX Gradle plugin | `2.1.0` |
| Java toolchain | `JavaLanguageVersion.of(21)` |
| Gradle wrapper | `8.13` |
| Modules | **two** Boot apps — `:backend:` and `:reviewer:` |

The two-module detail matters: `settings.gradle.kts` includes `backend` *and*
`reviewer`, and the recipe rewrites build files repo-wide. Expect
`reviewer/build.gradle.kts` in the diff.

Live release status from the Spring IO API (`getReleases` for `spring-boot`):
`3.5.16` GA, `4.0.8` GA, **`4.1.1` GA and flagged current**, `4.2.0-M1`
prerelease.

---

## 1. What `UpgradeSpringBoot_4_0` does for you

Recipe ID: `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`, shipped in
`org.openrewrite.recipe:rewrite-spring:6.37.1` under the Moderne Source
Available License.

- Docs: <https://docs.openrewrite.org/recipes/java/spring/boot4/upgradespringboot_4_0-community-edition>
- Source of truth for the chain (read this, not the docs summary):
  <https://github.com/openrewrite/rewrite-spring/blob/main/src/main/resources/META-INF/rewrite/spring-boot-40.yml>

It takes **no options** and has one precondition, `org.openrewrite.Singleton`.
The chain, in declaration order:

| Chained recipe | What it covers |
| --- | --- |
| `org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_5` | gets you onto the 3.5 line first |
| `org.openrewrite.java.spring.cloud2025.UpgradeSpringCloud_2025_1` | Spring Cloud 2025.1 |
| `org.openrewrite.java.spring.framework.UpgradeSpringFramework_7_0` | **much more than the name suggests** — see below |
| `org.openrewrite.java.spring.security7.UpgradeSpringSecurity_7_0` | Spring Security 7.0 |
| `org.openrewrite.java.spring.batch.SpringBatch5To6Migration` | Spring Batch 6 (no-op here) |
| `org.openrewrite.java.spring.boot4.SpringBootProperties_4_0` | `application*.yml` property renames |
| `org.openrewrite.java.spring.boot4.ReplaceMockBeanAndSpyBean` | `@MockBean`/`@SpyBean` → `@MockitoBean`/`@MockitoSpyBean` |
| `org.openrewrite.java.spring.boot4.RelocateWebServerClasses` | moved embedded-web-server types |
| `org.openrewrite.hibernate.MigrateToHibernate71` | Hibernate 7.1 (no-op here — no JPA) |
| `org.openrewrite.java.testing.testcontainers.Testcontainers2Migration` | Testcontainers 1.x → 2.x |
| `org.openrewrite.java.springdoc.UpgradeSpringDoc_3_0` | springdoc 3 (no-op here) |
| `org.openrewrite.java.dependencies.UpgradeDependencyVersion` ×3 | all `org.springframework.boot:*` and `spring-boot-dependencies` → `4.0.x` |
| `org.openrewrite.maven.UpgradePluginVersion` / `UpgradeParentVersion` | Maven-only, no-op for Gradle |
| `org.openrewrite.java.spring.boot4.MigrateJacksonBomProperty` | renames a Maven `jackson-bom.version` override to `jackson-2-bom.version` |
| `org.openrewrite.maven.RemoveRedundantDependencyVersions` ×2 | drops explicit versions the Boot 4 BOM now manages (`GTE` keeps deliberate forward pins) |
| `org.openrewrite.gradle.plugins.UpgradePluginVersion` (`org.springframework.boot`) | bumps the Gradle plugin to `4.0.x` |
| `org.openrewrite.gradle.UpdateGradleWrapper` `version: ^8.14`, `addIfMissing: false` | **bumps the wrapper to satisfy Boot 4's Gradle floor** |
| `org.openrewrite.gradle.plugins.UpgradePluginVersion` (`org.jetbrains.kotlin.*`) + Kotlin dependency bump to `2.2.x` | Boot 4.0 manages Kotlin `2.2.21` |
| `org.openrewrite.java.spring.boot4.MigrateToModularStarters` | the modular-starter split, below |
| `org.openrewrite.java.spring.boot4.RenameDeprecatedStartersManagedVersions` + `ChangeDependency` fallbacks | the starter renames, below |
| `RemoveDependency` / `ChangeDependency` for `spring-boot-starter-aop` | dropped if AspectJ is unused, else → `spring-boot-starter-aspectj` |
| `UpgradeDependencyVersion` for neo4j-migrations, error-handling-spring-boot-starter, JobRunr 8.x | third-party starters that must move in lockstep |
| `AddAutoConfigureTestRestTemplate`, `AddAutoConfigureWebTestClient`, `AddAutoConfigureMockMvc` | Boot 4 no longer auto-configures these implicitly in slice tests |
| `MigrateOpenApiGeneratorToSpringBoot4`, `MigrateJsonschema2PojoToSpringBoot4` | codegen plugin config |

### `UpgradeSpringFramework_7_0` is the biggest row in that table

Read its own definition — `META-INF/rewrite/spring-framework-70.yml` in the same
`rewrite-spring:6.37.1` jar, identical to `main`. Its `recipeList` is:

```yaml
- org.openrewrite.java.spring.framework.UpgradeSpringFramework_6_2
- org.openrewrite.java.dependencies.UpgradeDependencyVersion:
    groupId: org.springframework
    artifactId: "*"
    newVersion: 7.0.x
- org.openrewrite.java.testing.junit6.JUnit5to6Migration
- org.openrewrite.java.jackson.UpgradeJackson_2_3
- org.openrewrite.java.spring.kafka.UpgradeSpringKafka_4_0
- org.openrewrite.java.jspecify.MigrateFromSpringFrameworkAnnotations
```

So `UpgradeSpringBoot_4_0` transitively performs, with no extra step from you:

- **JUnit 5 → JUnit 6.** Boot 4.0.8 manages `junit-jupiter` 6.0.3. Across ~74
  backend test classes this is one of the largest parts of the diff.
- **Jackson 2 → Jackson 3 in Java source** — see the next section.
- **Spring Kafka 4.0** API migration on top of the managed `spring-kafka` 4.0.7.
- **JSpecify nullability annotations** replacing Spring's own
  (`@Nullable`/`@NonNull` moves).

Budget review time for JUnit and Jackson churn specifically; they are the bulk
of the file count.

### Jackson 2 → 3, including your Java source

Boot 4.0.8's BOM manages `jackson-bom.version = 3.1.5` (Jackson 3) and keeps a
Jackson 2 line at `jackson-2-bom.version = 2.21.5`
(verified in <https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-dependencies/4.0.8/spring-boot-dependencies-4.0.8.pom>).

Jackson 3 renames the group IDs and packages: `com.fasterxml.jackson` →
`tools.jackson`, **except `jackson-annotations`, which keeps groupId
`com.fasterxml.jackson.core`** and package `com.fasterxml.jackson.annotation`
(verified in <https://repo1.maven.org/maven2/tools/jackson/jackson-bom/3.1.5/jackson-bom-3.1.5.pom>
and by listing `tools/jackson/databind/…` in the 3.1.5 databind jar). Class
renames per the [migration guide](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide):
`Jackson2ObjectMapperBuilderCustomizer` → `JsonMapperBuilderCustomizer`,
`@JsonComponent` → `@JacksonComponent`, `@JsonMixin` → `@JacksonMixin`,
`JsonObjectSerializer` → `ObjectValueSerializer`, `JsonValueDeserializer` →
`ObjectValueDeserializer`. A deprecated `spring-boot-jackson2` module is the
temporary bridge for libraries stuck on Jackson 2.

**The recipe already does this to your Java source. Do not run it again.**
`UpgradeSpringBoot_4_0` → `UpgradeSpringFramework_7_0` chains
`org.openrewrite.java.jackson.UpgradeJackson_2_3`
(<https://docs.openrewrite.org/recipes/java/jackson/upgradejackson_2_3>), and
`rewrite-spring-6.37.1.pom` declares `org.openrewrite.recipe:rewrite-jackson:1.29.0`
at **`runtime`** scope — so the Jackson recipes are on the classpath by default,
including for the Path B snippet below, which only names `rewrite-spring`.

`MigrateJacksonBomProperty` (the Boot-4 step that renames a *Maven*
`jackson-bom.version` property) is therefore **not** the whole Jackson story; it
is a small Maven-only footnote next to the source migration.

Expect all of this in the diff: `com.fasterxml.jackson` → `tools.jackson`
imports, `IOException` → `JacksonException` in catches and `throws` clauses of
serde overrides, `ObjectMapper` setter chains rewritten to builder form, and
redundant feature flags removed (`UpgradeJackson_2_3`'s own sub-chain includes
`IOExceptionToJacksonException`, `ReplaceIOExceptionThrowInJacksonOverrides`,
`MigrateMapperSettersToBuilder`, `UpdateSerializationInclusionConfiguration`
and more).

What to **verify** rather than redo:

- Seven backend files import `com.fasterxml.jackson.*` today. Three are
  annotation-only (`JsonProperty`, `JsonInclude`, `JsonIgnoreProperties`) and
  **must not move** — `jackson-annotations` keeps the `com.fasterxml.jackson.core`
  groupId. Confirm those three are untouched.
- Running `UpgradeJackson_2_3` a second time over already-migrated source is a
  double migration, not a safety net. If the diff looks incomplete, work out why
  before re-running anything.

### Starter renames the recipe performs

Verified from the recipe YAML above and cross-checked against the migration
guide's [deprecated starters](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide#deprecated-starters)
and [AOP starter](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide#aop-starter-pom)
sections.

| Old | New | In the monorepo? |
| --- | --- | --- |
| `spring-boot-starter-web` | `spring-boot-starter-webmvc` | **yes** — `:backend:` and `:reviewer:` |
| `spring-boot-starter-oauth2-resource-server` | `spring-boot-starter-security-oauth2-resource-server` | **yes** — `:backend:` |
| `spring-boot-starter-oauth2-client` | `spring-boot-starter-security-oauth2-client` | no |
| `spring-boot-starter-oauth2-authorization-server` | `spring-boot-starter-security-oauth2-authorization-server` | no |
| `spring-boot-starter-web-services` | `spring-boot-starter-webservices` | no |
| `spring-boot-starter-aop` | `spring-boot-starter-aspectj`, or removed | no |

The modular-split recipe (<https://docs.openrewrite.org/recipes/java/spring/boot4/migratetomodularstarters-community-edition>)
additionally moves plain libraries onto dedicated starters — the two that hit
this repo are `org.springframework.kafka:spring-kafka` →
`spring-boot-starter-kafka` and `spring-security-test` →
`spring-boot-starter-security-test`. It also adds slice-test starters based on
imports (`spring-boot-starter-data-mongodb-test`,
`spring-boot-starter-webmvc-test`, …). Because every test starter now brings
`spring-boot-starter-test` transitively, the migration guide says you no longer
declare `spring-boot-starter-test` yourself.

`RenameDeprecatedStartersManagedVersions` is preconditioned on
`org.openrewrite.gradle.search.ModuleHasPlugin: io.spring.dependency-management`
— which both monorepo modules apply, so the renames land **without** explicit
version literals. Good: the version catalogue entries stay version-less.

---

## 2. What it does not do

Jackson, JUnit and Spring Kafka are **not** in this list — see section 1; the
recipe handles all three. What follows genuinely is left to you.

### Java, Gradle and build-plugin floors

From <https://docs.spring.io/spring-boot/system-requirements.html> (Boot 4.0.8):
**Java 17+**, **Maven 3.6.3+**, **Gradle 8.x from 8.14, or 9.x**. Servlet 6.1+
(Tomcat 11.0.x, Jetty 12.1.x). The
[4.0 announcement](https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/)
adds first-class Java 25 support while retaining Java 17.

- Java 21 toolchain: **satisfies the floor.** No change needed.
- Gradle 8.13 wrapper: **below the floor.** The recipe's `UpdateGradleWrapper`
  step handles it (`^8.14`), but confirm it fired.
- CycloneDX Gradle plugin: the migration guide raises the minimum supported
  version to **3.0.0**; the monorepo pins `2.1.0` and **no recipe step covers
  it**. Bump `cyclonedx` in the catalogue by hand.

### `@MockBean` / `@SpyBean`

**Removed, not deprecated.** The migration guide states Boot's `@MockBean` and
`@SpyBean` support "has been removed in this release, in favor of
`@MockitoBean` and `@MockitoSpyBean` support". The monorepo already migrated:
zero occurrences of the old annotations, six files on `@MockitoBean`, so
`ReplaceMockBeanAndSpyBean` is a no-op here.

### Other manual items

- Boot 4.0 manages `spring-kafka` **4.0.7** (from 3.x) and Testcontainers
  **2.0.5** (from 1.20.4). `Testcontainers2Migration` covers the API moves; the
  `testcontainers` catalogue pin should be deleted so the BOM manages it.
- Spring Data MongoDB goes **4.5.x → 5.0.7** (`spring-data-bom` 2025.1.7).
- `backend/build.gradle.kts` declares a `repo.embabel.com` Maven repository.
  Embabel now publishes to Maven Central, so that block can go.
- Runtime-only config the recipe cannot see: `logback-spring.xml`,
  `application*.yml` keys that are ours rather than Spring's, and the OTLP /
  Micrometer tracing wiring.

---

## 3. Blocker matrix

Every row verified by reading the published POM of the artifact named, on
2026-08-21.

| Dependency | Monorepo | Boot 4-capable floor | Blocked? |
| --- | --- | --- | --- |
| **Java** | 21 | 17 | No |
| **Gradle** | 8.13 | 8.14 (or 9.x) | No — recipe bumps the wrapper |
| **Spring AI** | `1.1.8` | **`2.0.1`** (2.0.0 GA 2026-06-12) | Not a version blocker — **but 2 of 5 declared modules need per-artifact work: see below** |
| **Embabel** | `0.3.5` | **`1.5.0`** | No — but a 0.x → 1.x jump |
| **Mongock** | `5.5.1` | **none published** | **Primary risk** |
| **Testcontainers** | `1.20.4` | `2.0.5` (Boot 4.0 BOM) | No — recipe migrates |
| **CycloneDX plugin** | `2.1.0` | `3.0.0` | No — manual bump |
| **Temporal starter** (`:reviewer:`) | `1.36.0` | unresolved, see below | Watch |

### Spring AI — a version bump plus one rename and one gap

Spring AI 2.0.0 went GA on 2026-06-12 with a Spring Boot 4.0/4.1 and Spring
Framework 7.0 baseline
(<https://spring.io/blog/2026/06/12/spring-ai-2-0-0-GA-available-now/>).
Verified directly:
`org.springframework.ai:spring-ai-starter-model-openai:2.0.1` declares
`org.springframework.boot:spring-boot-starter-restclient:4.1.1` and
`spring-boot-starter-webclient:4.1.1`.

**"Spring AI 2.0.1 exists" is not enough — check each artifact.** The backend
declares five Spring AI modules and two of them have no 2.0.x GA under their
current name. Every cell below is a Maven Central `maven-metadata.xml` read plus
a `2.0.1` POM `HEAD`, on 2026-08-21:

| Declared in the repo | Latest on Central | 2.0.1? | Action |
| --- | --- | --- | --- |
| `spring-ai-starter-model-openai` | `2.0.1` | 200 | bump |
| `spring-ai-starter-mcp-server-webmvc` | `2.0.1` | 200 | bump |
| `spring-ai-starter-vector-store-elasticsearch` | `2.0.1` | 200 | bump |
| `spring-ai-advisors-vector-store` | **`2.0.0-M8`** | **404** | **renamed** → `spring-ai-vector-store-advisor:2.0.1` (200) |
| `spring-ai-starter-model-openai-sdk` | **`2.0.0-M4`** | **404** | **no 2.0 GA under any name** — `spring-ai-openai-sdk` is also 404 at 2.0.1 |

So the Spring AI move is: bump three, **rename one** catalogue entry, and make a
decision about `spring-ai-starter-model-openai-sdk`, whose 2.0 line stopped at
`M4`. Check whether its capability folded into
`spring-ai-starter-model-openai:2.0.1` before assuming the dependency can simply
be dropped. Bumping `springAi` to `2.0.1` without doing this fails Gradle
resolution on two catalogue entries.

Spring AI 2.0 also moves from Jackson 2 to Jackson 3, which the recipe's Jackson
chain handles on our side.

### Boot 4.0 or 4.1 — an open decision, not a settled one

The recipe pins Boot to `4.0.x`. Spring AI 2.0.1 and Embabel 1.5.0 both *declare*
Boot `4.1.x` dependencies. `4.1.1` is the current GA. What that does and does not
mean:

- <https://github.com/spring-projects/spring-ai/issues/6465> was closed as
  **completed**, and the maintainer's conclusion was that Maven consumers are
  fine: `dependency:tree`, `help:effective-pom` and the packaged uber-jar all
  showed Boot `4.0.7` being used, and the report was a Maven **Enforcer
  upper-bound visibility** artifact. Quote: *"People wanting to use boot 4.0.x
  just have to inherit/use a 4.0.x boot starter… Expect that Spring AI will
  publish poms referencing the latest compatible boot version, while still
  allowing a lower major version at runtime."* So a declared `4.1.1` is a
  ceiling-ish hint, **not** a resolved version — do not claim these libraries
  "pull Boot 4.1.x".
- A later comment on the same issue (2026-07-24, unaddressed and the issue not
  reopened) reports the **Gradle** case is less tidy: with `spring-ai-bom:2.0.0`
  and `spring-boot-dependencies:4.0.7` as *platforms*, Gradle's
  highest-version-wins gave a mixed tree — `4.1.0` for `spring-boot` and
  `spring-boot-autoconfigure`, `4.0.7` for `spring-boot-health`.
- **This repo does not use Gradle platforms for Boot.** Both modules apply
  `io.spring.dependency-management`, which imposes Maven-style managed versions,
  so the managed Boot version should win. That is a *prediction*, not a
  measurement — verify it rather than trusting it:

  ```bash
  ./gradlew :backend:dependencies --configuration runtimeClasspath | grep -i "spring-boot"
  ```

Neither target is obviously right. Trade-off:

| | Boot 4.0.x | Boot 4.1.1 |
| --- | --- | --- |
| Recipe support | pinned by the recipe, nothing to do | **no 4.1 recipe exists** — hand-bump after the run |
| Alignment with Spring AI / Embabel | libraries declare 4.1.x above your 4.0.x | matches what they were built against |
| Risk | a mixed tree if dependency-management does not hold | one more version of delta on top of an already large diff |

If you choose 4.1.1, the procedure is: run the recipe as-is (it lands 4.0.x),
**then** bump the `springBoot` catalogue entry to `4.1.1` in a separate commit,
re-run the dependency check above, and re-run the full gate. Do not try to
retarget the recipe — there is no 4.1 variant, and hand-editing the recipe's
output mid-run is how you lose track of what changed.

### Embabel — clear, but a major jump

`com.embabel.agent:embabel-agent-starter` releases on Maven Central:
`0.2.0, 0.3.0–0.3.5, 0.4.0, 0.5.0, 1.0.0-RC1, 1.0.0, 1.5.0`
(<https://repo1.maven.org/maven2/com/embabel/agent/embabel-agent-starter/maven-metadata.xml>).

`embabel-agent-autoconfigure` compiles against
`spring-boot-autoconfigure-processor`:

| Embabel | Boot |
| --- | --- |
| `0.3.5` | `3.5.12` |
| `0.4.0`, `0.5.0`, `1.0.0` | `3.5.14` |
| **`1.5.0`** | **`4.1.0`** |

`embabel-agent-test:1.5.0` depends on `spring-boot-starter-test:4.1.0`. So
**1.5.0 is the first Boot 4 Embabel release** and there is no Boot 4 release on
the 0.x or 1.0.x lines. Going `0.3.5 → 1.5.0` crosses a 0.x → 1.x boundary with
no OpenRewrite recipe: budget for hand-fixing the agent code and
`AbstractIntegrationTest`'s mock of Embabel's `Ai`. Check the project's own
release notes: <https://github.com/embabel/embabel-agent/releases>.

Note 1.5.0 also targets Boot **4.1.0**, reinforcing the "land on 4.1.x" call.

### Mongock — the one to settle before anything else

Mongock's latest release is **5.5.1** (same as the monorepo pin) and there is
**no `mongock-springboot-v4` artifact** on Maven Central. Worse, the POMs
declare explicit exclusive upper bounds
(<https://repo1.maven.org/maven2/io/mongock/spring-jdk17/5.5.1/spring-jdk17-5.5.1.pom>):

```xml
<springframework-6.version>[6.0.0-RC2, 7.0.0)</springframework-6.version>
<spring-boot-3.version>[3.0.0-RC1, 4.0.0)</spring-boot-3.version>
```

Spring Framework 7 and Spring Boot 4 are deliberately outside the declared
range, so **Mongock does not claim Boot 4 support.** That is the honest status.

It is not *proven* broken, though, and the evidence says it may well run. The
API surface it actually touches is tiny and all of it still exists in Boot 4:

- `mongock-springboot-v3:5.5.1` references only
  `org.springframework.boot.ApplicationRunner`,
  `org.springframework.boot.ApplicationArguments`,
  `org.springframework.boot.autoconfigure.condition.ConditionalOnExpression`,
  `org.springframework.boot.context.properties.ConfigurationProperties` and
  `EnableConfigurationProperties` — all four present in `spring-boot:4.0.8` /
  `spring-boot-autoconfigure:4.0.8`.
- `mongodb-springdata-v4-driver:5.5.1` references 46
  `org.springframework.data.*` types (`MongoTemplate`, `MongoOperations`,
  `Criteria`, `Query`, `Update`, `IndexOperations`, `BulkOperations`,
  `Aggregation`, …). All 46 still exist in `spring-data-mongodb:5.0.7` /
  `spring-data-commons:4.0.7`.

So: **treat Mongock as unproven, not impossible.** The decisive experiment is
cheap and already written — `V011SeedAndBackfillDanVegaBlogIntegrationTest` runs
with `@TestPropertySource(properties = "mongock.enabled=true")` while the rest
of the suite has `mongock.enabled: false`. Run that class specifically after the
recipe and read the result; a green suite that never started Mongock proves
nothing.

Fallbacks, in order of preference:

1. Wait for a Mongock release that declares Boot 4 / Framework 7. Watch
   <https://github.com/flamingock/mongock/releases>.
2. Migrate to **Flamingock**, Mongock's successor from the same maintainers
   (<https://github.com/flamingock/flamingock-java>, `io.flamingock`, latest
   `1.4.5`). It is a rewrite with a different API, not a drop-in — a project of
   its own, not a step in this upgrade.
3. Hold the backend on Boot 3.5 until one of the above lands.

Because every org data change ships as a Mongock change unit, "migrations
silently stop running" is the worst possible failure mode here. Do not accept a
Boot 4 build until a Mongock-enabled test has been seen to pass.

### Temporal starter (`:reviewer:`) — watch

`io.temporal:temporal-spring-boot-autoconfigure` up to and including the latest
release (`1.38.0`) references
`org.springframework.boot.context.properties.ConstructorBinding`, which **does
not exist in Boot 4.0.8** — it lives at
`org.springframework.boot.context.properties.bind.ConstructorBinding` there. It
is an annotation, so an absent class is skipped rather than fatal at class-load,
but constructor binding of Temporal's own config properties may behave
differently. This only affects `:reviewer:`, so consider upgrading `:backend:`
alone first, and check <https://github.com/temporalio/sdk-java/releases>.

---

## 4. Recipe artifact resolution — no credential needed today

**Both paths in the skill body work right now with no credential at all.** Read
this section only when you need a recipe release newer than Maven Central
carries.

OpenRewrite recipe artifacts are *moving* off Maven Central to the Code Genome
Project — "Recipes are moving from Maven Central to the Code Genome Project" —
while Maven Central stays necessary regardless because "OpenRewrite's transitive
dependencies still resolve from there"
(<https://docs.openrewrite.org/reference/latest-versions-of-every-openrewrite-module>).
They have not moved yet.

As checked on 2026-08-21: `org.openrewrite.recipe:rewrite-spring:6.37.1` resolves
from Maven Central, and that is the **same latest release** the OpenRewrite
version table lists — Central is not serving a stale version. Its jar does
contain `org/openrewrite/java/spring/boot4/…`, the Boot 4 recipes, verified by
downloading and listing it. Meanwhile
`https://artifacts.codegenomeproject.org/maven` returns `401` unauthenticated.

So the Code Genome path is the **durable** one, not the *required* one. Configure
it when Central falls behind, or when your organisation mirrors Code Genome
through its own Artifactory/Nexus (the preferred enterprise route in Moderne's
docs). Do not treat it as a prerequisite for a Boot upgrade — and note that the
credential is issued **by Moderne**, not self-service, so it may be unobtainable
for a solo developer. That is a reason to stay on Central, not a blocker.

### If and when you do need it

- Repository: `https://artifacts.codegenomeproject.org/maven`
- Credentials come **from Moderne**, not from an account you create — the
  entitlement is attached to the Moderne-provided identity
  (<https://docs.moderne.io/administrator-documentation/moderne-platform/how-to-guides/accessing-the-code-genome-project/>).
  Authentication is HTTP Basic with the **download token as the password**.
- Store them in `~/workspace/simonjamesrowe/env` as
  **`CODE_GENOME_USERNAME`** and **`CODE_GENOME_TOKEN`**. Never inline a value,
  never echo one, never let one reach a build file that gets committed.

CLI form, verbatim from
<https://docs.moderne.io/user-documentation/moderne-cli/getting-started/cli-internal-tools>
and matching `mod config recipes artifacts maven add --help` on `mod` 4.6.3:

```bash
mod config recipes artifacts maven add https://artifacts.codegenomeproject.org/maven \
  --user "$CODE_GENOME_USERNAME" --password "$CODE_GENOME_TOKEN"
mod config recipes jar install org.openrewrite.recipe:rewrite-spring:LATEST
mod config recipes artifacts show   # read-only; confirms the URL took
mod config recipes list             # read-only; confirms the recipes landed
```

`mod config recipes --help` says "You must run the `mod config moderne` command
before running this command". `mod config moderne show` currently reports *"There
is no currently configured Moderne tenant"*, so expect
`mod config recipes moderne install|sync` to fail until a tenant exists
(`mod config moderne login` or `mod config moderne edit`). The
`recipes artifacts` subtree does answer without a tenant —
`mod config recipes artifacts show` succeeds today and reports the default
`https://central.sonatype.com/repository/maven-snapshots/`.

### Gradle form for the plugin path

The default — what the skill body tells you to add, and what resolves today:

```kotlin
plugins { id("org.openrewrite.rewrite") version "7.39.0" }

repositories {
  mavenCentral()          // serves rewrite-spring:6.37.1, the current latest
}

dependencies {
  rewrite("org.openrewrite.recipe:rewrite-spring:6.37.1")
}

rewrite {
  activeRecipe("org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0")
}
```

The credentialed alternative, **only** if you need a release Central does not
carry. Credentials are read from the environment and never written into the file:

```kotlin
repositories {
  mavenCentral()          // still required — transitive deps resolve from here
  // Uncomment when Central falls behind and you hold Moderne-issued credentials.
  // maven {
  //   url = uri("https://artifacts.codegenomeproject.org/maven")
  //   credentials {
  //     username = System.getenv("CODE_GENOME_USERNAME")
  //     password = System.getenv("CODE_GENOME_TOKEN")
  //   }
  // }
}
```

Remember that either form is temporary scaffolding in this repo — see §5 for why
reverting it needs care.

Plugin configuration reference:
<https://docs.openrewrite.org/reference/gradle-plugin-configuration>.

---

## 5. Rollback

The recipe rewrites tens of files in one pass. Your rollback is git, and git can
only help if the tree was clean when you started.

```bash
git status --porcelain      # MUST be empty before running the recipe
```

After a bad run:

```bash
git checkout -- .   # revert every tracked modification
git clean -fd       # delete files the recipe added
```

`git checkout -- .` cannot distinguish your edits from the recipe's, so a dirty
tree means the recipe's changes and your work are the same change and this
rollback destroys both. `git clean -fd` deletes untracked files
indiscriminately, including any scratch file you were keeping. Neither is
recoverable.

If the tree cannot be made clean, `git stash -u` first, run the recipe, and
review the two changes separately. Do not run the recipe "just to see" on top of
uncommitted work.

Also revert the temporary build-file edit from the Gradle-plugin path before
committing — the `org.openrewrite.rewrite` plugin block, the `rewrite`
dependency and the Code Genome repository are scaffolding for the run, not part
of the project:

**In this repo the recipe also edits the root build file, so a blanket
`git checkout -- build.gradle.kts` destroys recipe output.** The root
`build.gradle.kts` declares `id("org.springframework.boot") … apply false`,
`io.spring.dependency-management`, and the cyclonedx/sonarqube plugin aliases —
all reachable by the chain's `UpgradePluginVersion` steps (pluginIdPattern
`org.springframework.boot`, and the Kotlin one).

So do **not** revert the whole file. Either:

```bash
# Option 1 — keep the recipe's change, drop only the scaffolding, by hand.
git diff -- build.gradle.kts     # expect BOTH your scaffolding and a plugin bump
# then delete the plugin block / rewrite dependency / rewrite {} block manually
```

```bash
# Option 2 — stage the recipe's change first, then revert the rest.
git add -p build.gradle.kts      # stage only the recipe's hunks
git checkout -- build.gradle.kts # safely discards the unstaged scaffolding
```

The recipe's other output — `gradle/libs.versions.toml`,
`backend/build.gradle.kts`, `reviewer/build.gradle.kts`, the wrapper properties
and the Java/YAML sources — is untouched by either option.

---

## Sources

- <https://docs.openrewrite.org/recipes/java/spring/boot4/upgradespringboot_4_0-community-edition>
- <https://github.com/openrewrite/rewrite-spring/blob/main/src/main/resources/META-INF/rewrite/spring-boot-40.yml>
- <https://github.com/openrewrite/rewrite-spring/blob/main/src/main/resources/META-INF/rewrite/spring-framework-70.yml>
- <https://github.com/openrewrite/rewrite-jackson/blob/main/src/main/resources/META-INF/rewrite/jackson-2-3.yml>
- <https://docs.openrewrite.org/recipes/java/spring/boot4/migratetomodularstarters-community-edition>
- <https://docs.openrewrite.org/recipes/java/jackson/upgradejackson_2_3>
- <https://docs.openrewrite.org/reference/latest-versions-of-every-openrewrite-module>
- <https://docs.openrewrite.org/reference/gradle-plugin-configuration>
- <https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide>
- <https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes>
- <https://docs.spring.io/spring-boot/system-requirements.html>
- <https://spring.io/blog/2025/11/20/spring-boot-4-0-0-available-now/>
- <https://spring.io/blog/2026/06/12/spring-ai-2-0-0-GA-available-now/>
- <https://github.com/spring-projects/spring-ai/issues/6465>
- <https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-dependencies/4.0.8/spring-boot-dependencies-4.0.8.pom>
- <https://repo1.maven.org/maven2/tools/jackson/jackson-bom/3.1.5/jackson-bom-3.1.5.pom>
- <https://repo1.maven.org/maven2/com/embabel/agent/embabel-agent-starter/maven-metadata.xml>
- <https://github.com/embabel/embabel-agent/releases>
- <https://repo1.maven.org/maven2/io/mongock/spring-jdk17/5.5.1/spring-jdk17-5.5.1.pom>
- <https://github.com/flamingock/mongock/releases>
- <https://github.com/flamingock/flamingock-java>
- <https://docs.moderne.io/administrator-documentation/moderne-platform/how-to-guides/accessing-the-code-genome-project/>
- <https://docs.moderne.io/user-documentation/moderne-cli/getting-started/cli-internal-tools>
- <https://github.com/temporalio/sdk-java/releases>
