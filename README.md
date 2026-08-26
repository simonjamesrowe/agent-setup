# agent-setup

One command that sets up **three different coding agents** with the same
skills, instructions and tools for working on the `simonjamesrowe` org:

- **Claude Code** (Anthropic) — `~/.claude/`
- **Gemini CLI** (Google) — `~/.gemini/`
- **Codex** (OpenAI) — `~/.codex/`

Skills are authored once, in agent-agnostic markdown, and fanned out to each
tool's native location — so switching agents doesn't mean starting from a
blank slate. `agent-setup` also registers MCP servers and installs CLI
plugins for whichever of the three it finds on your `PATH`.

## What each agent gets

| | Claude Code | Gemini CLI | Codex |
| --- | --- | --- | --- |
| Skills (17) | ✅ `~/.claude/skills/` | ✅ `~/.gemini/skills/` | ✅ `~/.codex/skills/` |
| Instructions | ✅ `CLAUDE.md` | ✅ `GEMINI.md` | ✅ `AGENTS.md` |
| MCP servers | ✅ | ✅ | ✅ |
| Plugins (superpowers, spring-tools) | ✅ | ❌ Claude-only marketplaces | ❌ Claude-only marketplaces |
| speckit | ✅ | ✅ | ✅ (tool-agnostic, via `uv`) |
| Moderne CLI + OpenRewrite MCP | ✅ | ❌ not supported upstream | ✅ |

## Quick start

```bash
npx @simonjamesrowe/agent-setup
```

Check what's installed without changing anything:

```bash
npx @simonjamesrowe/agent-setup doctor
```

### Flags

| Flag             | Description                                              |
| ---------------- | --------------------------------------------------------- |
| `--yes`          | no prompts, accept defaults                                |
| `--tools <a,b>`  | limit to `claude,gemini,codex` (default: auto-detect)      |
| `--skip <a,b>`   | skip provisioners: `skills,instructions,mcp,plugins`        |
| `--target <dir>` | override home directory (testing/CI); force-skips `mcp` and `plugins`, which exec real CLIs that mutate actual user config regardless of `--target` |
| `--with <a,b>`   | opt in to optional components: `embabel-guide`              |

Commands: `install` (default), `doctor` (check-only), `help`.

Without `--tools`, `agent-setup` auto-detects which of `claude`, `gemini` and
`codex` are on `PATH` and only provisions those.

## What gets installed

### Destinations

| Tool        | Skills directory   | Instructions file      |
| ----------- | -------------------- | ------------------------ |
| Claude Code | `~/.claude/skills/`   | `~/.claude/CLAUDE.md`    |
| Gemini CLI  | `~/.gemini/skills/`   | `~/.gemini/GEMINI.md`    |
| Codex       | `~/.codex/skills/`    | `~/.codex/AGENTS.md`     |

- **Skills** (`components/skills/`) are copied verbatim into each detected
  tool's skills directory.
- **Instructions** (`components/instructions/global.md`) are merged into each
  tool's instructions file inside a marked block
  (`<!-- AGENT-SETUP:SIMONJAMESROWE START/END -->`), so re-running install
  updates the block in place without disturbing anything you've added outside
  it. `doctor` reports the block as `missing` if it's absent or has been
  edited/clobbered.

### Skills

| Skill                 | What it's for |
| ---------------------- | -------------- |
| `backend-test`         | Run and interpret simonrowe.dev backend tests, checkstyle and coverage. |
| `blog-publish`         | Research, draft, illustrate, publish and verify first-party simonrowe.dev blog posts. |
| `chat-e2e-verify`      | Browser-driven quality check of the simonrowe.dev chatbot against a local environment. |
| `code-review-triage`   | Diagnose why the automated code reviewer did not review a pull request on simonrowe.dev. |
| `content-source-add`   | Add a new content-aggregation source (blog/news/events scraper) to simonrowe.dev. |
| `dependency-cve-fix`   | Fix OWASP Dependency-Track CVE findings in simonrowe.dev by bumping the affected dependency, opening a PR, and driving CI to green. |
| `embabel-guide`        | Run the Embabel docs MCP server (`embabel/guide`) locally and register it, for authoring Embabel agent code on the JVM. |
| `frontend-design`      | Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. |
| `langfuse-verify`      | Verify Langfuse LLM trace plumbing for simonrowe.dev end to end. |
| `local-env`            | Start, stop and verify the simonrowe.dev local development environment. |
| `mongock-migration`    | Create a Mongock change unit for simonrowe.dev data changes with the repo's idempotency and test patterns. |
| `prod-backup-ops`      | Trigger, verify and manage simonrowe.dev production backups to Google Drive. |
| `prod-data-restore`    | Restore the latest simonrowe.dev production backup (Google Drive) into a local environment via the admin Data Ops UI. |
| `prod-deploy`          | Deploy simonrowe.dev to production: merge, watch the Publish workflow, restart on the Pi, smoke-test. |
| `prod-logs`            | Fetch simonrowe.dev production logs from Grafana Cloud Loki, Portainer, or docker compose. |
| `pr-review-loop`       | Drive a pull request from ready-to-review to all-signals-green: CI, the reviewer bot and SonarQube Cloud, triaged in a bounded loop. |
| `prod-triage`          | Runbook for simonrowe.dev being down or misbehaving in production. |
| `spring-boot-upgrade`  | Upgrade the simonrowe.dev backend across Spring Boot versions with OpenRewrite, via the Moderne MCP server or the OpenRewrite Gradle plugin. |

See [`docs/SKILLS.md`](https://github.com/simonjamesrowe/agent-setup/blob/main/docs/SKILLS.md)
for naming conventions, where a new skill should live, the `SKILL.md` format
contract, and the checklist for adding one.

### MCP servers

Registered at **user scope** for every detected agent.

| Server | Transport | Auth | What it's for |
| --- | --- | --- | --- |
| `playwright` | stdio (`npx @playwright/mcp@latest`) | none | Browser automation — admin UI flows, chat verification |
| `excalidraw` | HTTP | none | Diagrams |
| `javadocs` | HTTP (`javadocs.dev`) | none | Java/Kotlin/Scala API docs from Maven Central |
| `linear` | HTTP (`mcp.linear.app`) | OAuth (interactive, first use) | Linear issues, projects and comments |
| `embabel-guide` | stdio (`mcp-remote` → `localhost:1337`) | your own LLM key | Embabel framework docs — **opt-in**, see below |
| `moderne` | stdio (local, via the `mod` CLI) | none for today's recipes | OpenRewrite recipe search and deterministic execution |

`playwright`, `excalidraw`, `javadocs`, `linear` and `embabel-guide` are
`agent-setup`'s own catalog (`MCP_SERVERS` in `lib/provisioners/mcp.js`). `moderne` is **not**
in that array — it's registered by the `mod` CLI itself
(`mod config agent-tools <agent> install`, see CLI tools below), not by
`agent-setup`'s MCP provisioner.

A server already registered at project or local scope would shadow the
user-scope one, so that's reported as `failed` with the `mcp remove` command
to fix it rather than being silently overwritten.

`linear` is the only catalog server needing credentials, and it uses OAuth, so
registration and authorization are separate steps: `install` registers it, then
**you sign in once yourself**, with your agent's own command:

| Agent | Sign in with |
| --- | --- |
| Claude Code | `/mcp`, in an interactive session |
| Codex | `codex mcp login linear` |
| Gemini CLI | `/mcp auth linear`, in an interactive session |

(Verified 2026-08-25: `codex mcp login --help` on codex-cli 0.133.0, and
gemini-cli 0.49.0's own `docs/tools/mcp-server.md`, which documents
`/mcp auth serverName`. Gemini has no `gemini mcp login` subcommand.)

Until you do, `doctor` reports the row as `optional` — `registered but not
authorized` — rather than `unchanged`, because the server is configured but its
tools do not work. That row never affects the exit code, since the sign-in is a
browser flow `agent-setup` cannot perform for you. Auth state is only
*detected* for Claude Code: `claude mcp get` prints a `Status:` line that says
so, Gemini's check reads `~/.gemini/settings.json` (which carries no auth
metadata at all), and Codex's unauthorized output is still unverified.

#### Read-only Linear

If you would rather agents never write to your tracker, remove the server and
re-add it against Linear's read-only endpoint — same server, search and read
only:

```bash
claude mcp remove linear -s user
claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp/readonly
```

`--scope user` is not optional: `claude mcp add` defaults to `local` scope
(`claude mcp add --help`, Claude Code 2.1.220, 2026-08-25), and a local-scope
`linear` shadows the user-scope one — which `agent-setup` reports as `failed`.
Use the equivalent `remove`/`add` pair for Codex or Gemini.

The swap survives future upgrades because `agent-setup`'s registration check
matches on the server **name** only, never on the URL: `execBasedCheck` in
`lib/provisioners/mcp.js` looks for the name in `mcp get` output, and the Gemini
check looks for the `mcpServers` key. So a readonly-swapped `linear` reports
`unchanged` on every later `install` run and is never clobbered. Editing the URL
inside the installed npm package would *not* survive the next global install;
this does.

### CLI tools and plugins

| Tool | Installed via | Agents |
| --- | --- | --- |
| `superpowers` | `claude plugin install` | Claude Code |
| `spring-tools` | `claude plugin marketplace add` + `plugin install` | Claude Code |
| `speckit` | `uv tool install specify-cli` | all (tool-agnostic) |
| `moderne` | `brew install moderneinc/moderne/mod` + `mod config agent-tools <agent> install` (once per supported agent) | Claude Code, Codex |

`mod config agent-tools <agent> install` registers the Moderne MCP server
**and** installs Moderne's own OpenRewrite skills for that agent, so
`agent-setup` calls it once per supported agent (`claude`, `codex`) rather
than reimplementing either step. It deliberately never runs the blanket
`mod config agent-tools install` — that form provisions all eight agents
Moderne supports regardless of which ones `agent-setup` was asked to
provision, and it writes `.github/instructions/` and `.vscode/mcp.json` into
whatever directory it happens to be run from. Gemini CLI is not a supported
target for `mod config agent-tools` upstream and is reported as `skipped`.

Recipes resolve from Maven Central today, so `mod` needs no credential to run
the current Spring Boot upgrade recipe. A Code Genome Project token only
matters once you need a recipe release newer than Central carries — the
one-time setup for that is in the `spring-boot-upgrade` skill.

### Optional components

Not installed by default; opt in by name.

```bash
npx @simonjamesrowe/agent-setup --with embabel-guide
```

| Component | Why it's opt-in |
| --- | --- |
| `embabel-guide` | Needs a local Docker + Neo4j server on `localhost:1337` and your own LLM API key. Registering it unconditionally would leave a dead server configured on every machine. |

`doctor` reports opted-out components as `optional`, never `missing`, so they
don't affect its exit code.

> **Platform support**: macOS and Linux. Windows is untested — tool detection
> shells out to `which`.

## Updating

Re-run the same command to pick up new skills, instructions or plugin
versions — install is idempotent and only touches what's changed:

```bash
npx @simonjamesrowe/agent-setup
```

### Version policy

- **patch** — wording or fix (skill body edit, instructions tweak, bug fix)
- **minor** — new skill or new flag (backward-compatible addition)
- **major** — rename or removal (a skill, flag or destination changes shape or
  disappears)

## Development

```bash
git clone git@github.com:simonjamesrowe/agent-setup.git
cd agent-setup
npm test
npm run lint:skills
```

Smoke-test an install into a disposable target directory instead of your real
home directory:

```bash
node bin/agent-setup.js install --yes --target "$(mktemp -d)" --tools claude,gemini,codex --skip mcp,plugins
```

## License

MIT — see [LICENSE](LICENSE).
