# Java toolchain additions: Moderne/OpenRewrite, javadocs, Embabel — Design

**Date:** 2026-08-21
**Status:** Approved (pending final spec review)
**Repo:** `github.com/simonjamesrowe/agent-setup`
**Package:** `@simonjamesrowe/agent-setup` — target version **0.3.0**

## Goal

Give the three supported agents real Java-modernisation tooling, driven by an
immediate need: upgrading the simonrowe.dev backend from Spring Boot 3.5 to
Spring Boot 4. Four deliverables:

1. **`javadocs` MCP server** — Java/Kotlin/Scala API docs from Maven Central,
   registered for all three agents.
2. **Moderne CLI + its MCP server and skills** — deterministic OpenRewrite
   recipe search and execution, provisioned like `speckit`/`spring-tools`.
3. **`spring-boot-upgrade` skill** — the org's playbook for a Boot major
   upgrade, built on the Moderne MCP with an OpenRewrite-Gradle fallback.
4. **`embabel-guide`** — opt-in MCP registration plus an always-installed
   skill for running Rod Johnson's Embabel docs server locally.

Plus a **README rework** so the skill/tool inventory is scannable and the
three-agent support story is explicit, and a new **`--with`** flag giving the
installer a notion of opt-in components.

## Research findings that shaped this

| Question | Finding | Source |
|---|---|---|
| Is there an OpenRewrite MCP? | Yes — the Moderne CLI (`mod`) ships a **local** MCP server: ~20 tools over OpenRewrite LSTs and a trigram index (`search_recipes`, `learn_recipe`, `run_recipe`, `find_types`, `find_methods`, `change_type`, `pattern_replace`, …). Must be started inside a git repo. | [docs.moderne.io/…/mcp/overview](https://docs.moderne.io/user-documentation/agent-tools/mcp/overview/) |
| How is it installed? | `brew install moderneinc/moderne/mod`, then `mod config agent-tools install` — one command registers the MCP server *and* installs 10 Moderne skills per agent (it shells out to `claude mcp add` itself). | [docs.moderne.io/…/mcp/getting-started](https://docs.moderne.io/user-documentation/agent-tools/mcp/getting-started), [docs.moderne.io/…/skills](https://docs.moderne.io/user-documentation/agent-tools/skills/) |
| Which agents does it support? | Per-agent subcommands: `claude`, `codex`, `cursor`, `copilot`, `amp`, `windsurf`. **No Gemini.** | [docs.moderne.io/…/skills](https://docs.moderne.io/user-documentation/agent-tools/skills/) |
| Licensing | OpenRewrite's Apache-licensed recipes and the Moderne CLI are free to **any authenticated** Code Genome Project user; source-available/proprietary recipes need a Moderne subscription. | [docs.moderne.io/licensing/overview](https://docs.moderne.io/licensing/overview/), [docs.moderne.io/…/accessing-the-code-genome-project](https://docs.moderne.io/administrator-documentation/moderne-platform/how-to-guides/accessing-the-code-genome-project/) |
| Recipe distribution | Recipes have **moved off Maven Central** to `https://artifacts.codegenomeproject.org/maven`, which requires a username + download token. | [docs.openrewrite.org/reference/latest-versions-of-every-openrewrite-module](https://docs.openrewrite.org/reference/latest-versions-of-every-openrewrite-module) |
| The Boot 4 recipe | `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0` (rewrite-spring), which chains Spring Framework 7, Security 7, Cloud 2025.1, modular starters, config-property renames and test-annotation replacements. | [docs.openrewrite.org/…/upgradespringboot_4_0-community-edition](https://docs.openrewrite.org/recipes/java/spring/boot4/upgradespringboot_4_0-community-edition) |
| Javadoc MCP | `javadocs.dev` — remote HTTP MCP at `https://www.javadocs.dev/mcp`, open (no auth): latest artifact version, browse javadoc jar contents, fetch symbol docs. Not currently registered on this machine. | [remote-mcp.com/servers/javadocs](https://www.remote-mcp.com/servers/javadocs) |
| Embabel MCP | No hosted option. Only [`embabel/guide`](https://github.com/embabel/guide): a self-hosted Spring Boot app serving docs-RAG MCP tools on `http://localhost:1337/sse`, needing Docker + Neo4j + an LLM API key. Embabel *itself* natively exposes MCP, but that's for agents you build, not for authoring help. | [github.com/embabel/guide](https://github.com/embabel/guide) |

## Non-goals

- Managing Moderne/Code Genome secrets in this package. The provisioner never
  reads or writes credentials; they live in `~/workspace/simonjamesrowe/env`
  and are configured once by the operator, as with every other org secret.
- Running the Spring Boot 4 upgrade itself. This package ships the skill; the
  upgrade happens in the monorepo.
- Provisioning the Embabel guide server (Docker, Neo4j, LLM key). Opt-in MCP
  registration only; bringing the server up is the skill's job.
- Gemini parity for Moderne. Upstream doesn't support it; we report the gap
  rather than paper over it.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Javadoc server | `javadocs.dev` over HTTP | Open, no auth, no local runtime; all three adapters already register HTTP servers |
| Moderne install path | Homebrew + `mod config agent-tools install` | Upstream's own one-command path; it registers the MCP *and* the skills, so we don't reimplement either |
| Moderne provisioner home | `lib/provisioners/plugins.js` | It's a CLI-tool install with a confirm prompt — same shape as `speckit`, not a static MCP registry entry |
| Missing Homebrew | `skipped` with an actionable note | Precedent: `provisionSpeckit` does exactly this for `uv` |
| Credentials | Out of scope for install; `doctor` reports status only | Keeps the package secret-free and safe to publish |
| Upgrade skill primary path | Moderne MCP `run_recipe` | Deterministic — no LLM in the transformation — and no build-file edits needed |
| Upgrade skill fallback | OpenRewrite Gradle plugin + Code Genome repo | Works without the `mod` CLI; the only option on a machine without Homebrew |
| Embabel | Opt-in MCP + always-installed skill | The skill is markdown and costs nothing; the MCP would break `doctor` on machines where the server isn't running |
| Opt-in mechanism | `--with <a,b>` + `optional: true` registry marker | One generic mechanism; nothing bespoke to Embabel |
| Optional component status | Reported `optional`, never `missing` | Must not affect `doctor`'s exit code (`exitCode(..., {strictMissing:true})`) |
| Version | 0.3.0 (minor) | New skills and a new flag; backward-compatible per the repo's version policy |

## Component 1 — `javadocs` MCP server

Single registry addition in `lib/provisioners/mcp.js`:

```js
{ name: 'javadocs', type: 'http', url: 'https://www.javadocs.dev/mcp' }
```

No adapter work: `claude` and `gemini` take `--transport http`, `codex` takes
`--url`. Existing scope-shadowing and check logic applies unchanged.

## Component 2 — Moderne CLI provisioner

New `provisionModerne({ exec, check, yes, prompt, adapters })` in
`lib/provisioners/plugins.js`, wired into `provisionPlugins`.

**Detection** (in order):
1. `mod --version` exit non-zero → not installed.
2. Installed, but the Moderne MCP server isn't registered for an agent →
   needs `mod config agent-tools install`.
3. Both present → `unchanged`.

The exact registered server name and the exact `mod config` credential
subcommands are **determined during implementation by running the real
install**, not guessed from documentation — the published docs don't spell
either out. Implementation records the verified commands in a code comment,
matching the existing `plugins.js` convention of citing what was verified and
when.

**Install steps**
1. `brew --version` → if absent, `skipped` with note
   `install Homebrew first: https://brew.sh`.
2. `brew install moderneinc/moderne/mod`.
3. `mod config agent-tools install`.

**Per-agent reporting**: one row per selected agent. Gemini always reports
`skipped` with note `not supported by mod config agent-tools`. Claude and
Codex report the real outcome.

**Doctor-only credential check**: a row reporting whether Moderne/Code Genome
auth is configured on this machine, alongside the existing env-file check.
Only emitted when `mod` is actually installed — otherwise the Moderne rows
already say what to do, and an extra `missing` row would fail `doctor` on
machines that deliberately don't have the CLI. When `mod` is present and auth
is absent the row is `missing` (recipes cannot resolve without it) with a note
pointing at the `spring-boot-upgrade` skill's setup section. The credential
value is never printed or logged.

## Component 3 — `spring-boot-upgrade` skill

`components/skills/spring-boot-upgrade/SKILL.md` plus
`references/spring-boot-4-playbook.md`. Agent-agnostic, installed for all
three agents like every other skill.

**Frontmatter description** must trigger on: upgrading Spring Boot, a major
framework bump, running an OpenRewrite recipe, or a dependency-wide migration
of the backend.

**Structure**
1. **One-time setup** — sign in to the Code Genome Project, create a download
   token, store it in `~/workspace/simonjamesrowe/env`, configure `mod`. Exact
   commands verified during implementation.
2. **Preflight** — clean working tree; branch `chore/spring-boot-4`; read the
   current version and available targets via the spring-tools MCP
   (`getSpringBootVersion`, `getLatestBootVersionsFromMavenRepo`,
   `getJavaVersion`).
3. **Path A (default)** — Moderne MCP: `search_recipes` → `learn_recipe` →
   `run_recipe` on `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`,
   with `lst_status`/`build_status` checks first (LSTs build in the
   background; running a recipe too early gives partial results).
4. **Path B (fallback)** — OpenRewrite Gradle plugin, `rewrite-spring`
   dependency, Code Genome repo with credentials read from env, then
   `./gradlew rewriteRun`. Includes reverting the temporary build-file edit.
5. **Manual checklist the recipe won't cover** — modular starters, Jackson 3,
   config-property renames, `@MockBean` → `@MockitoBean`, Spring Security 7
   changes, and Mongock's Boot 4 compatibility (org-specific: every data
   change ships as a Mongock change unit, so a Mongock break blocks the
   upgrade).
6. **Verification** — delegate to `backend-test` (gradle test + checkstyle),
   then the spring-tools `validate` skill, then `local-env` for a smoke test.
   No "upgrade complete" claim before test output is seen.
7. **Reference file** — the chained recipe list and known breakages, each with
   a source link, so the skill body stays short.

## Component 4 — Embabel, opt-in

**New flag**: `--with <a,b>` in `bin/agent-setup.js` (parsed like `--skip`),
threaded through `run()` to the provisioners, documented in `USAGE`.

**Registry marker**: `optional: true` on an MCP entry. The mcp provisioner
skips optional entries not named in `--with`, reporting status `optional` with
a note naming the flag that enables it. `report.js` needs no change —
`optional` is not `failed` or `missing`, so it can't affect exit code.

**Optional entry**:

```js
{ name: 'embabel-guide', type: 'stdio', optional: true,
  command: ['npx', 'mcp-remote', 'http://localhost:1337/sse', '--transport', 'sse-only'] }
```

**Skill** `components/skills/embabel-guide/SKILL.md` (always installed):
clone or update `embabel/guide`, the `docker compose --profile java up -d`
invocation, the Neo4j and LLM-API-key prerequisites, a health check on
`localhost:1337`, how to register the MCP server
(`npx @simonjamesrowe/agent-setup --with embabel-guide`), and how to shut it
all down. States plainly that the server is a local RAG app over Embabel docs
and costs LLM tokens per query.

## Component 5 — README rework

Rewrite `README.md` around a scannable inventory:

1. **Intro** names all three agents with their vendors —
   **Claude Code (Anthropic)**, **Gemini CLI (Google)**, **Codex (OpenAI)** —
   removing any ambiguity about which is which.
2. **Supported agents matrix**: rows = agents; columns = skills,
   instructions, MCP servers, plugins, Moderne. Gaps marked honestly (plugins
   are Claude-only; Moderne skips Gemini).
3. **Skills table** — name + purpose, one row per skill, including the two new
   ones.
4. **MCP servers table** — name, transport, auth, purpose (playwright,
   excalidraw, javadocs, moderne, and embabel-guide flagged optional).
5. **CLI tools & plugins table** — superpowers, spring-tools, speckit,
   moderne, with agent coverage per row.
6. **Flags table** gains `--with`.

Existing Quick start, Updating, Version policy, Development and License
sections are preserved.

## Testing

| Test file | New coverage |
|---|---|
| `test/provisioner-mcp.test.js` | `javadocs` is registered for all three adapters with the right per-adapter argv; optional entries are skipped without `--with`, registered with it, and reported `optional` not `missing` |
| `test/provisioner-plugins.test.js` | Moderne: not-installed → installs; installed + registered → `unchanged`; no Homebrew → `skipped` with note; Gemini → `skipped` with the unsupported note; declined prompt → `skipped: declined`; failing step → `failed` with stderr |
| `test/cli.test.js` | `--with a,b` parses into `args.with`; empty and absent cases default to `[]` |
| `test/report.test.js` | `optional` rows don't set a non-zero exit code under `strictMissing` |
| `npm run lint:skills` | Both new skills satisfy the SKILL.md format contract |

Existing smoke test (`--target` with `--skip mcp,plugins`) continues to pass
unchanged; `--target` still force-skips the provisioners that mutate real
tool config, including Moderne.

## Implementation order

Sequenced so the urgent work lands first:

1. Moderne provisioner + `spring-boot-upgrade` skill + `javadocs` MCP — this
   unblocks the Boot 4 upgrade.
2. README rework.
3. `--with` flag + Embabel opt-in MCP + `embabel-guide` skill.
4. Version bump to 0.3.0, full test run, `lint:skills`.

## Open item

The operator's note "should be logged in now" is unresolved: no `mod` binary,
no `~/.moderne`, no Code Genome credentials in `~/.gradle`, `~/.m2` or the org
env file, and the Atlassian MCP still reports needing authentication. If a
Code Genome / Moderne account already exists, the `spring-boot-upgrade` skill
should reference those stored credentials directly instead of walking through
signup. Implementation asks before writing the setup section.
