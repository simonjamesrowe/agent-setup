# Linear MCP server — Design

**Date:** 2026-08-25
**Status:** Approved (pending final spec review)
**Repo:** `github.com/simonjamesrowe/agent-setup`
**Package:** `@simonjamesrowe/agent-setup` — target version **0.4.0**

## Goal

Register Linear's official remote MCP server for every detected agent, so
agents can find, create and update Linear issues, projects and comments
without a local process or a token in an env file.

Adding the server is a one-line change to `MCP_SERVERS`. The design work is
in the second deliverable: Linear is the catalog's **first OAuth server**, and
a server that is registered but unauthorized is a state `agent-setup` can
create but can never resolve — the OAuth flow needs an interactive browser
sign-in. `doctor` must say so instead of reporting `unchanged`.

## Research findings that shaped this

| Question | Finding | Source |
|---|---|---|
| Is there an official Linear MCP? | Yes — a first-party hosted remote server. Read/write endpoint `https://mcp.linear.app/mcp` (streamable HTTP); read-only variant `https://mcp.linear.app/mcp/readonly`; legacy SSE `https://mcp.linear.app/sse` for clients without streamable HTTP. **Correction, 2026-08-25:** the legacy SSE row is stale — probed directly, `/sse` returns **404** on both `GET` and `POST`, while `/mcp` and `/mcp/readonly` both return **401** (i.e. present, awaiting OAuth). Nothing in the implementation depends on `/sse`; it is recorded here only so the row is not read as a live fallback. | [linear.app/docs/mcp](https://linear.app/docs/mcp) |
| Auth | OAuth 2.1 with dynamic client registration (interactive browser flow), or a Linear API key / bearer token in the `Authorization` header. Enterprise SAML via Okta. | [linear.app/docs/mcp](https://linear.app/docs/mcp) |
| Tools | Find, create and update issues, projects and comments. Initiatives, initiative updates, project milestones, project updates and project labels added Feb 2026. | [linear.app/docs/mcp](https://linear.app/docs/mcp), [linear.app/changelog/2025-05-01-mcp](https://linear.app/changelog/2025-05-01-mcp) |
| Client commands | `claude mcp add --transport http linear https://mcp.linear.app/mcp`; `codex mcp add linear --url https://mcp.linear.app/mcp`; Gemini takes `--transport http`. All three match the existing `type: 'http'` `mcpAddArgs` in our adapters — **no adapter changes needed**. | [linear.app/docs/mcp](https://linear.app/docs/mcp) |
| Community alternatives | e.g. `tacticlaunch/mcp-linear` — an npx stdio server requiring `LINEAR_API_KEY` in the environment. Rejected: the official hosted server needs no token in an env file and no local process. | [mcpservers.org/servers/tacticlaunch/mcp-linear](https://mcpservers.org/servers/tacticlaunch/mcp-linear) |

### Verified locally, 2026-08-25 (this machine)

These findings are the basis of the auth-honesty design and were confirmed by
running the real CLIs, not read from docs:

| Probe | Result |
|---|---|
| `claude mcp get atlassian` (an OAuth server, unauthorized) | Prints `Status: ! Needs authentication`, **exit 0** |
| `claude mcp get javadocs` (open server) | Prints `Status: ✔ Connected`, exit 0 |
| `claude mcp list` | Third state exists: `✘ Failed to connect` (seen on `github`) |
| `codex mcp list` | Has an `Auth` column; shows `Unsupported` for stdio and open-HTTP servers. **No OAuth server is registered with Codex here, so the unauthorized string is unverified.** |
| `codex mcp get <missing>` | Exit **1**, message on **stderr** — so `execBasedCheck`'s `stdout.includes(name)` cannot be fooled by the `No MCP server named 'linear' found.` text. No change needed. |
| `~/.gemini/settings.json` | Carries `mcpServers` keys only. **No auth state at all.** |
| `lib/report.js:22` | Renders a `note` on any row regardless of status, so an `optional` row with a note renders correctly. |
| `lib/report.js:32` + `lib/run.js:70` (`strictMissing: check`) | `failed` always exits 1; `missing` exits 1 **on the doctor path**; `optional` never affects the exit code. |
| `curl` against the three Linear endpoints | `/mcp` → 401, `/mcp/readonly` → 401, `/sse` → **404**. See the corrected research row above. |
| `codex mcp --help` + `codex mcp login --help` (codex-cli 0.133.0) | **Supersedes the "Codex and Gemini auth rows" non-goal below, in part.** Codex does have a documented sign-in command: `codex mcp login <NAME>`, "Name of the MCP server to authenticate with oauth". The original probe used `codex mcp add --help`, the wrong `--help`. What remains unverified is only codex's *unauthorized output string*, not the command. |
| gemini-cli 0.49.0 bundle (`gemini mcp --help`, `docs/tools/mcp-server.md`) | Gemini has no `mcp login` subcommand, but it does have a slash command: the bundle's own user-facing string is `Use /mcp auth <server-name> to authenticate.` and its docs document `/mcp auth serverName` under "Managing OAuth authentication". |

## Decisions

1. **Always-on, not opt-in.** Unlike `embabel-guide` (opt-in because it needs a
   local Docker/Neo4j app running), Linear is a hosted endpoint that costs
   nothing to have registered. It joins `playwright` / `excalidraw` /
   `javadocs` as an unconditional catalog entry.
2. **Read/write endpoint** (`https://mcp.linear.app/mcp`), not
   `/mcp/readonly`. Read-only would block the actual wins — opening an issue
   from a failing CI run, posting a project update after a deploy — and this
   repo's other tooling (`playwright` driving the admin UI, `moderne`
   rewriting source) already trusts the operator to review agent actions. The
   readonly URL is documented in the README as an escape hatch.

   > **Amended 2026-08-25:** "documented as an escape hatch" was too vague to
   > act on — the URL lives inside an npm package that the next global install
   > overwrites. The README now documents the durable mechanism instead:
   > `claude mcp remove linear -s user` then `claude mcp add --scope user
   > --transport http linear https://mcp.linear.app/mcp/readonly`. It sticks
   > because `execBasedCheck` matches on the server **name** only, never the
   > URL, so a readonly-swapped `linear` reports `unchanged` forever after.
   > `--scope user` is required: `claude mcp add` defaults to `local`, which
   > the scope-shadowing check would report as `failed`.
3. **Per-server `needsAuth` flag, Claude only.** Auth state is reported only
   where it has been verified: Claude. Gemini and Codex report plain
   registration exactly as today.
4. **`optional`, not `missing`, for registered-but-unauthorized.** This is the
   precedent `moderneAuthRow` sets in `plugins.js`, whose comment records that
   `missing` made `doctor` exit 1 on a correctly-configured machine. `doctor`
   must not exit non-zero for a condition it has no power to fix — but it must
   not claim `unchanged` either, because the tools genuinely do not work.

## Non-goals

- **Parsing `Status:` for the whole catalog.** Tempting, but `✘ Failed to
  connect` is transient for the open HTTP servers, so a network blip would
  flip `javadocs` from `unchanged` to a failure and break `install`'s exit
  code for reasons unrelated to provisioning. Worth doing one day,
  deliberately, not as a side effect of adding Linear.
- **Codex and Gemini auth rows.** Codex exposes an `Auth` column in
  `mcp list` but not in `mcp get`, and the unauthorized string is unverified
  (see above). Guessing it would be exactly the "trusting the exit code" bug
  the Moderne comments exist to prevent. A code comment records the gap.

  > **Partly superseded 2026-08-25.** Still a non-goal for *detection*: neither
  > adapter's unauthorized output is parsed. But the *sign-in commands* are now
  > verified and named — `codex mcp login <name>` and `/mcp auth <name>` — so
  > each adapter's `authHint(serverName)` states its real command instead of
  > telling the operator to go read the vendor's docs. See the two new rows in
  > the verified-locally table above.
- **Automating the OAuth flow.** Impossible non-interactively, by design.
- **A `linear` skill.** No org workflow to encode yet. If issue triage or
  release-notes flows settle into a routine, that's a separate spec.

## Design

### 1. Catalog entry

In `lib/provisioners/mcp.js`, appended to `MCP_SERVERS`:

```js
// Linear's official hosted MCP server (streamable HTTP). OAuth 2.1 with dynamic client
// registration: `mcp add` succeeds with no credential, but every tool call fails until someone
// completes the browser sign-in via `/mcp` in Claude Code — hence needsAuth. A read-only variant
// exists at https://mcp.linear.app/mcp/readonly if write access is ever unwanted.
{ name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', needsAuth: true },
```

### 2. Auth-aware status, Claude only

`execBasedCheck` already runs `claude mcp get <name>` and parses a `Scope:`
line out of stdout. It gains a sibling parse for the `Status:` line, extracted
as a named helper alongside `scopeOf`:

```js
// `claude mcp get` prints `Status: ! Needs authentication` for a registered-but-unauthorized
// OAuth server and exits 0 — verified 2026-08-25 against the `atlassian` server on this machine.
// The exit code is NOT proof the server is usable. Only the explicit needs-authentication state
// is recognised: `✘ Failed to connect` is transient for open HTTP servers and must not be
// reported as an auth problem.
function needsAuthOf(getOutput) { ... }
```

`provisionMcp`'s per-server flow becomes:

1. Opt-in gate (unchanged).
2. Registration + scope check (unchanged) — a project/local-scope
   registration still reports `failed`, and still takes precedence over any
   auth consideration.
3. **New:** if registered *and* `server.needsAuth` *and* the check reported
   the needs-authentication state → `optional`, note: `registered but not
   authorized — run /mcp in Claude Code to sign in`.
4. Registered otherwise → `unchanged` (unchanged behaviour).
5. **New:** a successful `mcp add` of a `needsAuth` server → `installed` with
   the note `authorize with /mcp in Claude Code`, since the very next thing
   the operator must do is sign in.

> **Superseded 2026-08-25 (steps 3 and 5).** Both notes were designed as
> hardcoded Claude Code strings, but both `push` calls sit in the shared
> per-adapter loop, so a codex or gemini run printed a Claude slash command.
> The shipped code takes the wording from `adapter.authHint(serverName)`
> instead — a function, because two of the three real commands need the server
> name. The `optional` note reads `registered but not authorized — <hint>`, and
> the `installed` note is the hint alone.

The needs-auth signal travels as a third field on the object returned by
`execBasedCheck` / `adapter.mcpCheckRegistered`. Adapters that don't report it
(Gemini's `mcpCheckRegistered`, which reads `settings.json`) simply return it
absent, and step 3 doesn't fire — so Gemini and Codex keep today's rows with
no special-casing in `provisionMcp`.

### 3. Docs

- README's MCP table gains a `linear` row: transport `HTTP`, auth
  **`OAuth (interactive)`**, purpose "Linear issues, projects and comments".
  The auth column currently reads `none` for every catalog server, so this is
  the first row that breaks that pattern.
- The prose listing the catalog (`playwright`, `excalidraw`, `javadocs` and
  `embabel-guide` are `agent-setup`'s own catalog) is updated to include
  `linear`.
- A short note that first use needs `/mcp` in Claude Code, and that
  `/mcp/readonly` is available for a read-only setup.

## Testing

Extending `test/provisioner-mcp.test.js`, which fakes `exec` and asserts on
rows and on the exact argv passed to `mcp add`:

| Test | Asserts |
|---|---|
| `server catalog` (existing, line 19) | Updated to include `linear` in the sorted name list; `linear` must **not** appear in the `optional` (opt-in) filter |
| Registers with the right argv | `mcp add --scope user --transport http linear https://mcp.linear.app/mcp` for Claude; `mcp add linear --url ...` for Codex |
| Fresh install note | A successful add of a `needsAuth` server → `installed` with a note matching `/\/mcp/` |
| Unauthorized on the doctor path | `mcp get` stdout containing `Status: ! Needs authentication` → status `optional`, note matching `/not authorized/` |
| Authorized | `Status: ✔ Connected` → `unchanged`, no note |
| `Failed to connect` is not an auth error | `Status: ✘ Failed to connect` → `unchanged`, proving the transient state is not misreported |
| Scope beats auth | A needs-authentication server registered at project scope → `failed` with the project-scope note, not `optional` |
| Exit code | A run whose only non-`unchanged` row is an unauthorized `linear` exits **0** on both the install and doctor paths |
| Non-`needsAuth` servers unaffected | `javadocs` with `Status: ! Needs authentication` in stdout → still `unchanged` (the flag gates the behaviour, not the string) |

Run with `npm test` (`node --test test/*.test.js`).

## Risks

| Risk | Mitigation |
|---|---|
| Linear changes the `Status:` string, or Claude Code reformats `mcp get` | The parse is one named helper with the verification date in its comment; failure mode is degrading to `unchanged`, i.e. today's behaviour, not a crash or a false `failed` |
| Operators read `optional` as "you don't need this" | The note is explicit about the required action, and adapter-specific: `run /mcp in Claude Code to sign in`, `run: codex mcp login linear`, `run /mcp auth linear in an interactive gemini session` |
| Write access lets an agent mutate a real tracker | Deliberate (decision 2); the README documents the durable escape hatch — remove and re-add `linear` at **user** scope against `/mcp/readonly`, which survives package upgrades because the check matches on server name only (see the amendment under decision 2) |
