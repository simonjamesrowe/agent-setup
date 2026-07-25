# agent-setup

AI agent setup for the `simonjamesrowe` org: skills, instructions, MCP servers
and plugins for Claude Code, Gemini CLI and Codex. One command provisions all
three tools with the same skill library, the same org-specific instructions,
and the same set of MCP servers and CLI plugins — so switching tools doesn't
mean starting from a blank slate.

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
| `--target <dir>` | override home directory (testing/CI)                        |

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
- **MCP servers** are registered at user scope for every detected tool:
  `playwright` (stdio, `npx @playwright/mcp@latest`) and `excalidraw` (HTTP).
  Skipped with a note if a tool's CLI can't register HTTP servers, and flagged
  as `failed` if a server is already registered at a non-user scope that would
  shadow the user-scope one.
- **Plugins** (Claude Code only, except `speckit`): `superpowers` and
  `spring-tools` (Claude Code plugin marketplaces), `speckit` (installed via
  `uv tool install`, tool-agnostic), and `ui.sh` (never automated — installing
  it requires a personal account token, so `doctor`/`install` just point you at
  https://ui.sh).

### Skills

| Skill                 | What it's for |
| ---------------------- | -------------- |
| `backend-test`         | Run and interpret simonrowe.dev backend tests, checkstyle and coverage. |
| `chat-e2e-verify`      | Browser-driven quality check of the simonrowe.dev chatbot against a local environment. |
| `content-source-add`   | Add a new content-aggregation source (blog/news/events scraper) to simonrowe.dev. |
| `langfuse-verify`      | Verify Langfuse LLM trace plumbing for simonrowe.dev end to end. |
| `local-env`            | Start, stop and verify the simonrowe.dev local development environment. |
| `mongock-migration`    | Create a Mongock change unit for simonrowe.dev data changes with the repo's idempotency and test patterns. |
| `prod-backup-ops`      | Trigger, verify and manage simonrowe.dev production backups to Google Drive. |
| `prod-data-restore`    | Restore the latest simonrowe.dev production backup (Google Drive) into a local environment via the admin Data Ops UI. |
| `prod-deploy`          | Deploy simonrowe.dev to production: merge, watch the Publish workflow, restart on the Pi, smoke-test. |
| `prod-logs`            | Fetch simonrowe.dev production logs from Grafana Cloud Loki, Portainer, or docker compose. |
| `prod-triage`          | Runbook for simonrowe.dev being down or misbehaving in production. |

See [`docs/SKILLS.md`](docs/SKILLS.md) for naming conventions, where a new
skill should live, the `SKILL.md` format contract, and the checklist for
adding one.

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
