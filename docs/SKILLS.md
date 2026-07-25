# Skill conventions

This repo owns the org-wide skill library for `simonjamesrowe` and fans it out
to Claude Code, Gemini CLI and Codex. The conventions below are a solo-org
adaptation of the `ct-engineering-skills` naming scheme — same shape, fewer
categories, one repo instead of a shared monorepo skills package.

## Naming

- **lower-kebab-case** throughout: `prod-deploy`, not `ProdDeploy` or `prod_deploy`.
- **Category prefix first.** The prefixes in use today:
  - `prod-` — production operations (deploy, logs, triage, backups, restore)
  - `backend-` — backend build/test tooling
  - `content-` — content-aggregation pipeline
  - `chat-` — the chatbot surface
  - `langfuse-` — LLM observability
  - `local-` — local development environment
  - `mongock-` — data migrations
  - A skill that doesn't fit an existing category may introduce a new prefix,
    but check first whether it actually belongs in one of the above.
- **Prefer a verb at the leaf**, after the category: `prod-deploy`,
  `content-source-add`, `chat-e2e-verify` — the last segment should usually
  name the action, not just repeat the noun. This isn't absolute: `local-env`
  and `mongock-migration` end in a noun because the skill covers a whole area
  (the local stack, the migration format) rather than one verb-shaped action —
  that's fine. What to avoid is restating the whole sentence in the name; pick
  the shortest segment (verb or noun) that distinguishes this skill from
  others in its category.
- **Folder name must equal the frontmatter `name`.** This is enforced by
  `npm run lint:skills` (`scripts/lint-skills.js`) — a mismatch is a lint
  failure, not a style suggestion.

## Placement: this repo vs. the target repo

Two valid homes for a skill, chosen by reusability:

- **Org-wide / reusable across repos → `components/skills/` in this repo.**
  Anything that describes how `simonjamesrowe` repos work in general (prod
  topology, backup/restore flow, the content pipeline, the chat transport)
  belongs here so every tool and every repo gets it via `agent-setup`.
- **Repo-specific / not reusable → that repo's own `.claude/skills/`
  (or the equivalent skills directory for the tool in question).**
  If a skill only makes sense inside one repo's checkout — a one-off script
  location, a repo-local test fixture — it doesn't belong in the shared
  package. Don't pull repo-local trivia into `agent-setup` just because it's
  convenient; it will drift the moment that repo changes.

When in doubt: would a second repo in this org ever want this skill verbatim?
If yes, it's org-wide. If it only makes sense with knowledge of one repo's
internals, it's repo-specific.

## Format contract

Every skill is a directory containing a `SKILL.md` with:

- **Frontmatter: exactly `name` and `description`, nothing else.**
  `lint:skills` rejects any other frontmatter key. `name` must match the
  directory name exactly.
- **`description` must contain the literal phrase `Use when`** — it is a
  trigger clause, not a summary. Write it so an agent deciding whether to load
  the skill can tell from the description alone: what the skill does, and the
  situation that should make it reach for this skill.
- **Body length: roughly 100–300 lines.** Short enough to load cheaply, long
  enough to actually carry the runbook/procedure. If it's growing past that,
  split heavy reference material out (see below) rather than inlining it.
- **`references/` subdirectory for heavy material.** Long command output
  samples, exhaustive option tables, or anything that's "look this up when
  needed" rather than "read every time" goes in `references/`, linked from the
  body — it doesn't count against the body's line budget and isn't loaded
  unless the agent actually opens it.
- **Agent-agnostic phrasing.** Skills are installed into Claude Code, Gemini
  CLI and Codex alike. Don't write "use the Read tool" or other
  Claude-Code-specific tool names — describe the action, not the tool that
  performs it, so the same body reads correctly no matter which agent loaded
  it.
- **Secrets as env var names, never values.** If a skill needs a credential,
  name the environment variable that holds it (and where it's sourced from)
  and never inline the actual secret, sample or otherwise.

## Fan-out destinations

`agent-setup install` copies every directory under `components/skills/`
verbatim into each detected tool's skills directory:

| Tool        | Skills directory     | Instructions file  |
| ----------- | --------------------- | ------------------ |
| Claude Code | `~/.claude/skills/`    | `~/.claude/CLAUDE.md`   |
| Gemini CLI  | `~/.gemini/skills/`    | `~/.gemini/GEMINI.md`   |
| Codex       | `~/.codex/skills/`     | `~/.codex/AGENTS.md`    |

A skill is written once, in one format, and reaches all three tools with no
per-tool translation — the contract above exists precisely so that a single
`SKILL.md` is valid input for all of them.

## Adding a new skill: 5-step checklist

1. **Name it.** Pick the category prefix and a verb-at-leaf name
   (`<prefix>-<verb-or-noun>`). Check the table above for an existing prefix
   before inventing one.
2. **Author it.** Create `components/skills/<name>/SKILL.md` with the
   frontmatter contract above, a body in the 100–300 line range, and a
   `references/` subdirectory if there's heavy material to offload.
3. **Lint it.** `npm run lint:skills` — must report `skills lint: OK`.
4. **Test-install it.** Run the smoke-test install into a throwaway target
   and confirm the new skill directory lands for all three tools:
   ```bash
   node bin/agent-setup.js install --yes --target "$(mktemp -d)" --tools claude,gemini,codex --skip mcp,plugins
   ```
5. **Version bump.** A new skill is a **minor** version bump (new capability,
   backward compatible). Update `package.json`'s `version` accordingly before
   publishing — see the README's version policy for the full patch/minor/major
   rules.
