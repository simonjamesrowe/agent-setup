---
name: spring-boot-upgrade
description: Upgrade the simonrowe.dev backend across Spring Boot versions with OpenRewrite, via the Moderne MCP server or the OpenRewrite Gradle plugin. Use when bumping Spring Boot to a new major or minor line, running an OpenRewrite recipe, or a framework upgrade breaks the build.
---

# Upgrade Spring Boot

Work in the target monorepo checkout. Read its version catalogue, module list,
Gradle wrapper and toolchain before selecting a migration recipe.

The Boot 4 upgrade has already shipped: `main` at `e21e22c3` (2026-09-19) uses
Boot 4.1.1, Java 25, Spring AI 2.0.1, Embabel 1.5.1 and Mongock 5.5.1.
`docs/runbooks/spring-boot-4-upgrade.md` records the completed migration and
runtime evidence. The bundled [Boot 4 research](references/spring-boot-4-playbook.md)
is historical, from before that migration; use it only for the old investigation,
not as today's blocker list.

## Workflow

1. Preserve existing work. Use a clean, isolated checkout for a broad rewrite;
   keep an existing task branch and never reset it with `checkout -B`.
2. Read `settings.gradle.kts`, `gradle/libs.versions.toml`, root and module build
   files, and `gradle/wrapper/gradle-wrapper.properties`. The modules are currently
   `backend` and `software-factory`, not `reviewer`.
3. Check the requested target against current official release/migration docs.
   Verify each declared artifact, including renamed starters. Distinguish a
   declared compatibility range from application tests proving compatibility.
   Mongock's old published ranges alone are not proof this application cannot
   run on Boot 4; the completed-upgrade runbook records that it does.
4. Prefer OpenRewrite for transformations it covers. With Moderne MCP, check
   build/LST readiness, discover the recipe with `edit_code`, inspect options
   with `learn_recipe`, then run it. Use the OpenRewrite Gradle plugin's
   `rewriteDryRun` when previewing; verify current plugin and recipe versions
   before adding temporary build scaffolding. Credentials, if required, come
   from `CODE_GENOME_USERNAME` / `CODE_GENOME_TOKEN` in the env file.
5. Review build/config changes, production code and tests separately. Remove
   only temporary scaffolding; keep genuine recipe changes to the same files.
   A recipe can affect both JVM modules. Use `SourcesFileResults` when available
   to see which recipes actually changed files.
6. Run the affected modules' checkstyle, tests and coverage (`backend-test`),
   including `:software-factory:check` when touched. Run a Mongock-enabled test
   and a real application startup: ordinary tests disable Mongock. Check the
   resolved runtime dependency graph, not just catalogue version strings.
7. Verify affected UI/chat/tracing with `local-env`, `chat-e2e-verify` and
   `langfuse-verify`, then use `pr-review-loop` when opening a PR.

Report the source/target versions, recipe/version, manual follow-ups and actual
verification results. A successful rewrite or compile is not runtime proof.
