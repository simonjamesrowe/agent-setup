# agent-setup — Design

**Date:** 2026-07-25
**Status:** Approved (pending final spec review)
**Repo:** `github.com/simonjamesrowe/agent-setup` (public, MIT)
**Package:** `@simonjamesrowe/agent-setup` on npmjs.com

## Goal

A single npm package that sets up any machine for AI-assisted work on the
simonjamesrowe org (primarily the simonrowe.dev monorepo), across three
coding agents: Claude Code, Gemini CLI, and Codex. One `npx` command
installs:

1. **Skills** — 11 operational skills capturing the workflows re-explained
   in ~47 recent Claude Code sessions (prod restore, deploy, logs, triage,
   local env, migrations, etc.), authored once in agent-agnostic form and
   fanned out to each tool's native location.
2. **Instructions** — a personal base instruction block merged into
   `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, and `~/.codex/AGENTS.md`
   without disturbing existing (work-managed) content.
3. **Machine setup** — MCP server registration (playwright, excalidraw)
   and plugin installs (superpowers, speckit, ui.sh, Spring Tools).

## Non-goals

- Team/multi-user features: no team registry, lockfile, version pinning,
  scheduled auto-update, or uninstall command. Update = re-run `npx`.
- Writing into project repos. The installer only touches `~`-level config.
  Monorepo CLAUDE.md improvements are canonically stored here but applied
  via a one-time PR to the monorepo.
- Fixing the monorepo's observability gaps (no Prometheus scrape, traces
  disabled, Langfuse v2 without OTLP/SDK). Skills document the real state;
  enabling metrics/traces is monorepo work.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Registry | Public npmjs.com | GitHub Packages requires a PAT even for public packages; npmjs gives token-free `npx` everywhere |
| Scope | Full setup: content + machine | One command bootstraps a fresh machine |
| Cross-tool | Author once, fan out via adapters | One skill corpus to maintain; per-tool mechanics isolated in `lib/adapters/` |
| Base instructions home | Global `~/.claude/CLAUDE.md` (+ Gemini/Codex equivalents) | User choice; managed marker block coexists with work-managed content |
| Install mechanism | Copy with atomic swap (not symlinks) | Simpler across three tools; proven in ct-engineering-skills |
| Runtime deps | Zero (`fs`/`path`/`child_process`, Node ≥20) | Payload is markdown; keeps the package trivial to audit and install |

## Repo layout

```
agent-setup/
├── package.json               # bin: agent-setup, zero runtime deps
├── bin/agent-setup.js         # entry: install (default) | doctor | help
├── lib/
│   ├── adapters/              # claude.js, gemini.js, codex.js — per-tool mechanics
│   ├── provisioners/          # skills.js, instructions.js, mcp.js, plugins.js
│   └── util.js                # atomic copy, marker-merge, frontmatter, prompts
├── components/
│   ├── skills/<name>/SKILL.md # 11 skills + optional references/ subdirs
│   └── instructions/
│       ├── global.md          # single source for the personal base block
│       └── monorepo-additions.md  # canonical monorepo MANUAL ADDITIONS text
├── docs/
│   ├── SKILLS.md              # naming/placement conventions
│   └── superpowers/{specs,plans}/
└── .github/workflows/         # ci.yml, release.yml
```

## Skills (v1 catalog)

Naming: lower-kebab-case, category prefix, verb at leaf, folder name ==
frontmatter `name`.

| Skill | Encodes |
|---|---|
| `prod-data-restore` | Restore latest Google Drive backup locally via the admin Data Ops UI with browser automation (Playwright MCP in Claude Code); stop other Conductor envs first; rebuild-index/reembed afterwards; never raw mongorestore for prod data |
| `prod-deploy` | Merge → watch Publish workflow (`gh run watch`) → verify ghcr.io images → Pi restart block or `POST /api/admin/data-operations/redeploy` → smoke tests (health, /mcp, key pages); stale-image check |
| `prod-logs` | Grafana Cloud Loki LogQL via curl (`logs-prod-035.grafana.net`, `container` label), Portainer log streaming via browser, free-tier container exclusions, `docker compose logs` fallback |
| `prod-triage` | Site-down runbook: health endpoints → `status-prod.sh` table → stale-image check → pinggy token reclaim (`+force`) → nginx four-upstream boot fragility → Loki errors |
| `prod-backup-ops` | Data Ops backup API; full-with-media only; retain last 7; `.media-state.json` incremental-media awareness |
| `local-env` | Start/stop/verify compose stack + backend/frontend dev servers; Conductor port contention (stop other envs); env sourcing from `~/workspace/simonjamesrowe/env` |
| `backend-test` | Gradle incantations (`:backend:test`, `--tests`, checkstyle, jacoco verification), pre-commit hook behaviour, Testcontainers notes (no compose needed) |
| `mongock-migration` | Change-unit scaffold with the repo's guard/idempotency pattern + integration-test pattern; Mongock-first rule for any data change |
| `content-source-add` | Add a scraper source: strategy choice (RSS/HTML_LISTING/…), Mongock seed, trigger aggregation, verify results |
| `chat-e2e-verify` | Browser-driven chatbot quality pass against local env with restored data: on-topic guardrails, tool-usage rendering, links/images |
| `langfuse-verify` | `verify-langfuse-trace.sh` / Langfuse API check, documenting the current honest state (v2.95.1, no OTLP ingest, no backend SDK) |

Format rules:

- Frontmatter: `name` + `description` only. Description is a trigger-rich
  "Use when…" sentence. No Claude-specific keys (`allowed-tools` etc.) —
  keeps skills portable.
- Lean bodies (target 100–300 lines): workflow, gotchas, exact commands.
  Heavy reference material (full Data Ops API surface, Loki query
  cookbook) lives in `references/*.md`, loaded on demand (progressive
  disclosure per the Claude 5 context-engineering guidance).
- **Secrets convention** in every skill: credentials come from `.env` /
  `~/workspace/simonjamesrowe/env` (admin identity `admin@simonrowe.dev`,
  password from env) — never requested or pasted into chat.
- **Pi convention**: prod-touching skills emit a single copy-paste command
  block for the user to run on the Raspberry Pi and report output — never
  assume SSH access.
- Tool-conditional phrasing for capabilities that differ per agent:
  "with browser automation (Playwright MCP in Claude Code)… otherwise
  print manual steps."

## Instructions strategy

One source file, `components/instructions/global.md`, merged into three
destinations as a managed block delimited by
`<!-- AGENT-SETUP:SIMONJAMESROWE START -->` /
`<!-- AGENT-SETUP:SIMONJAMESROWE END -->`:

| Tool | Destination |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |
| Codex | `~/.codex/AGENTS.md` |

Merge semantics: content outside the markers is never modified; the block
is appended below existing content on first install and replaced in place
on updates. `doctor` flags a missing block (e.g. the work installer
rewrote `~/.claude/CLAUDE.md`); re-running `install` re-applies it.

Block content (~60 lines, gotchas-only, points to skills):

- Scoping line: applies to repos under the `simonjamesrowe` GitHub org /
  simonrowe.dev (the global file also loads in work repos).
- Environment map, one line each: simonrowe.dev (site),
  api.simonrowe.dev (backend), console.simonrowe.dev (Portainer),
  langfuse.simonrowe.dev, Grafana Cloud Loki. Prod = Raspberry Pi running
  `docker-compose.prod.yml`, no SSH — emit copy-paste blocks.
- Non-negotiables from session history: creds from env files, never
  pasted; Mongock-first for data changes; restores via Data Ops UI;
  backups full-with-media keep-7; never restart prod nginx unless all
  four upstreams (frontend, backend, portainer, langfuse) are running.
- Personal-repo git conventions: conventional commits, **no Jira ticket
  references** (overrides the work rule inside this org), CI green before
  merge, auto-delete branches.
- Installed-skills index: name + one-line "reach for it when…" per skill.

`components/instructions/monorepo-additions.md` versions the canonical
text for the monorepo CLAUDE.md `<!-- MANUAL ADDITIONS -->` section
(nginx fragility, pinggy reclaim, OrbStack docker paths, management-port
8081-in-prod/8082-default mismatch, stale-README warnings). Applied to
the monorepo via a one-time PR after this repo ships; the installer never
writes into repos.

## Adapters

Per-tool install mechanics live only in `lib/adapters/*.js`; skills and
instructions are tool-neutral.

- **claude**: skills → `~/.claude/skills/<name>/` (flat, atomic swap);
  instructions → `~/.claude/CLAUDE.md`; MCP via `claude mcp add`.
- **gemini**, **codex**: equivalents for skills, instructions, and MCP
  config. Their native mechanisms change quickly, so exact details are a
  verification task in the implementation plan (check current official
  docs), not baked into this design. Worst-case fallback for either tool:
  copy skills to `~/.agents/skills/` and index them from the tool's
  instruction file (the pattern speckit already uses in the monorepo).

## CLI behaviour

`npx @simonjamesrowe/agent-setup` (install, default command):

1. **Detect tools** — `claude`, `gemini`, `codex` on PATH; provision only
   what's present; print install hints for what's missing.
2. **Provisioners**, each check → skip-if-ok → act → verify:
   - **skills** — fan out to each detected tool. Managed content: atomic
     swap replace, no backups (customisations belong in this repo);
     New/Updated/Unchanged counts make changes visible.
   - **instructions** — marker-block merge per tool.
   - **mcp** — Claude: `claude mcp add --scope user` for `playwright`
     (`npx -y @playwright/mcp@latest`) and `excalidraw`
     (`https://mcp.excalidraw.com/mcp`), with scope-aware idempotency:
     skip if already at user scope, refuse with the exact removal command
     if registered at local/project scope. Gemini/Codex via adapters.
   - **plugins** — superpowers (install **and enable** — `claude plugin
     install` leaves plugins disabled), speckit (`uv tool install
     specify-cli`), ui.sh skills (requires the user's account token:
     prompt once, skip cleanly if declined), Spring Tools Claude Code
     plugin (experimental, installed from its GitHub repo per its README).
3. **Summary table** — Installed / Updated / Skipped / Failed per item;
   exit non-zero if anything failed.

`agent-setup doctor` — the same provisioners in check-only mode: tool
versions, skills present per tool, marker block intact in all three
instruction files, MCP servers registered at the right scope, plugins
installed *and enabled*, `~/workspace/simonjamesrowe/env` exists.
Pass/fail table, exit 0/1.

Flags: `--yes`, `--tools claude,gemini,codex`, `--skip mcp,plugins`,
`--target <dir>` (CI/testing). Prompts are TTY-gated and default sensibly
when piped.

## Testing & CI

- Unit tests (`node:test`, no dev-dep frameworks) for the sharp edges:
  marker merge (idempotent: second run yields byte-identical files;
  outside-marker content untouched), atomic-swap copy, frontmatter parse.
- **Skill lint** in CI: valid frontmatter; `name` == directory name;
  description contains a "Use when" trigger. (Both drift bugs observed in
  ct-engineering-skills.)
- **Install smoke test** in CI: run the real CLI with `HOME` pointed at a
  temp dir, `--yes --skip mcp,plugins`; assert per-tool skill counts match
  `components/skills/` and instruction files contain the marker block.
- `ci.yml` on PR: lint + tests + smoke test.
- `release.yml` on push to main: validate, then `npm publish --provenance`
  only if `package.json` version is not already on the registry
  (`npm view` probe). Manual `npm version` bumps: patch = wording/fix,
  minor = new skill/flag, major = rename/removal.

## Risks

1. **Gemini/Codex mechanics** verified at implementation time; adapter
   isolation + `~/.agents/skills/` fallback bound the blast radius.
2. **Public repo**: skills carry prod topology/URLs but must never carry
   secrets. Pre-publish checklist item; secrets always referenced as env
   var names.
3. **Prod metrics are dark** today (nothing scrapes
   `/actuator/prometheus`, Alloy traces disabled, Langfuse v2 has no OTLP
   ingest). Skills document reality rather than pretend; fixing it is
   out of scope.
4. **Work installer clobbers `~/.claude/CLAUDE.md`** on re-run: detected
   by `doctor`, repaired by re-running `install` — mitigated, not
   prevented.
