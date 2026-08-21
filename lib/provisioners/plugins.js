'use strict';

// `claude plugin list --json` (verified against claude-cli 2026-07-25) returns an array of
// installed plugins, each shaped like:
//   { "id": "superpowers@claude-plugins-official", "enabled": true, ... }
// This is far more robust than parsing the human-readable `claude plugin list` text output,
// which renders as an indented, multi-line block per plugin (not a single
// `name@marketplace ... enabled` line as previously assumed):
//   Installed plugins:
//
//     ❯ spring-tools@spring-tools-marketplace
//       Version: 2.2.0
//       Scope: user
//       Status: ✔ enabled
function findPlugin(listOutput, name) {
  let parsed;
  try {
    parsed = JSON.parse(listOutput || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  for (const entry of parsed) {
    const id = entry && entry.id;
    if (typeof id !== 'string') continue;
    const at = id.indexOf('@');
    if (at === -1) continue;
    const entryName = id.slice(0, at);
    const marketplace = id.slice(at + 1);
    if (entryName === name) return { marketplace, enabled: Boolean(entry.enabled) };
  }
  return null;
}

async function confirmInstall(prompt, yes, item) {
  if (yes) return true;
  return prompt(`Install ${item}?`, true);
}

// Shared flow for plugins that live in a `claude plugin list` marketplace: superpowers and
// spring-tools. `installSteps` is an ordered list of `claude` CLI argv arrays run to get the
// plugin installed (spring-tools needs a `marketplace add` before `plugin install`; superpowers
// needs only the install). After a successful install, if the plugin was already present-but-
// disabled, it is enabled using the marketplace parsed from the *original* list output (plugins
// can ship in more than one marketplace, so this is never hardcoded).
async function provisionClaudePlugin({ exec, check, yes, prompt, item, installSteps }) {
  const list = exec('claude', ['plugin', 'list', '--json']);
  const found = findPlugin(list.stdout, item);
  if (found && found.enabled) return { status: 'unchanged' };
  if (check) return { status: 'missing' };

  const proceed = await confirmInstall(prompt, yes, item);
  if (!proceed) return { status: 'skipped', note: 'declined' };

  for (const args of installSteps) {
    const res = exec('claude', args);
    if (res.status !== 0) return { status: 'failed', note: (res.stderr || '').trim() };
  }

  if (found && !found.enabled) {
    const enable = exec('claude', ['plugin', 'enable', `${item}@${found.marketplace}`]);
    if (enable.status !== 0) return { status: 'failed', note: (enable.stderr || '').trim() };
    return { status: 'updated' };
  }
  return { status: 'installed' };
}

async function provisionSpeckit({ exec, check, yes, prompt }) {
  const ver = exec('specify', ['--version']);
  if (ver.status === 0) return { status: 'unchanged' };
  if (check) return { status: 'missing' };

  const proceed = await confirmInstall(prompt, yes, 'speckit');
  if (!proceed) return { status: 'skipped', note: 'declined' };

  const uv = exec('uv', ['--version']);
  if (uv.status !== 0) return { status: 'skipped', note: 'install uv first: https://docs.astral.sh/uv/' };

  const install = exec('uv', ['tool', 'install', 'specify-cli', '--from', 'git+https://github.com/github/spec-kit.git']);
  if (install.status !== 0) return { status: 'failed', note: (install.stderr || '').trim() };
  return { status: 'installed' };
}

// Verified against the real Moderne CLI (`brew install moderneinc/moderne/mod`, mod 4.6.3,
// 2026-08-21): `mod config agent-tools install` registers the local Moderne MCP server with each
// supported agent (it shells out to `claude mcp add` itself, and `claude mcp get moderne` /
// `claude mcp list` confirm the server is registered as `moderne`, command
// `/opt/homebrew/bin/mod mcp`) and installs Moderne's skills into that agent's marketplace
// directory. So there is nothing to register by hand here — we only ensure `mod` exists and has
// been pointed at the agents.
//
// Deliberately NOT using the blanket form, though. Re-verified 2026-08-21 against
// `mod config agent-tools --help` and `mod config agent-tools claude --help` on this machine
// (mod 4.6.3): the blanket `mod config agent-tools install` provisions ALL EIGHT agents Moderne
// supports (Claude Code, Windsurf, Cursor, GitHub Copilot, GitHub Copilot CLI, Sourcegraph Amp,
// OpenAI Codex, opencode) regardless of which agents agent-setup was asked to provision, and it
// writes into the *current working directory* — running it inside a project checkout created
// `.github/instructions/moderne-*.instructions.md` (10 Copilot files) and `.vscode/mcp.json`
// inside that repo. `agent-setup install` must never pollute whatever repo the user happens to be
// running it from. Per-agent subcommands exist instead (`claude`, `windsurf`, `cursor`,
// `copilot`, `amp`, `codex`, `opencode`) and are scoped to that one agent's home-directory config
// — `mod config agent-tools claude --help` documents that the `claude` form "installs skills as a
// Claude Code plugin under ~/.claude/marketplaces/moderne/ and registers the MCP server via the
// 'claude' CLI". So we run `mod config agent-tools <agent> install` once per supported agent that
// actually needs it. Do NOT "simplify" this back to the blanket call — that is the bug this
// comment exists to prevent.
const MODERNE_MCP_SERVER = 'moderne';
// Moderne's per-agent subcommands (`mod config agent-tools --help`, mod 4.6.3, 2026-08-21):
// claude, windsurf, cursor, copilot, amp, codex, opencode. Gemini CLI is NOT among them, so we
// report that gap rather than pretending to provision it.
const MODERNE_AGENTS = ['claude', 'codex'];
// Read-only credential status (`mod config moderne --help` / `mod config moderne show`, mod
// 4.6.3, 2026-08-21): with no tenant configured this exits non-zero ("No Moderne tenant has been
// configured") and never prints a token; it only ever shows the configured tenant URL.
const MODERNE_AUTH_ARGV = ['config', 'moderne', 'show'];

function moderneAuthStatus(exec) {
  const res = exec('mod', MODERNE_AUTH_ARGV);
  if (res.status !== 0 || !res.stdout.trim()) {
    return { configured: false, note: 'run the one-time setup in the spring-boot-upgrade skill — OpenRewrite recipes resolve from the Code Genome Project and need a token' };
  }
  return { configured: true };
}

// Registration is probed per agent, via that agent's OWN binary (`claude mcp get moderne`,
// `codex mcp get moderne`, ...) — never the `mod` binary. This is what surfaced finding 1 live on
// this machine: Claude Code genuinely has the `moderne` server registered but Codex doesn't, so a
// single combined `every(...)` check was reporting Claude as `missing` too. Each supported agent
// now gets its own status row reflecting its own binary's answer.
function isModerneRegistered(exec, agent) {
  const get = exec(agent.binary || agent.key, ['mcp', 'get', MODERNE_MCP_SERVER]);
  return get.status === 0 && get.stdout.includes(MODERNE_MCP_SERVER);
}

// Applied whenever the install flow stops partway (declined prompt, missing Homebrew, or a
// failed step): agents that were already registered are genuinely fine and stay `unchanged`;
// only the ones that still need work get the given not-done status/note. A failed `claude
// install` must never be papered over as success for `codex`, and a still-pending `codex` must
// never borrow `claude`'s good state — each row is decided from that agent's own registeredMap
// entry.
function settleRemaining(supported, registeredMap, notDoneStatus, note) {
  return supported.map((a) => (
    registeredMap.get(a.key)
      ? { tool: a.key, status: 'unchanged' }
      : { tool: a.key, status: notDoneStatus, ...(note ? { note } : {}) }
  ));
}

async function provisionModerne({ exec, check, yes, prompt, adapters }) {
  const supported = adapters.filter((a) => MODERNE_AGENTS.includes(a.key));
  const unsupported = adapters.filter((a) => !MODERNE_AGENTS.includes(a.key));
  const rows = unsupported.map((a) => ({ tool: a.key, status: 'skipped', note: `not supported by mod config agent-tools (supports ${MODERNE_AGENTS.join(', ')})` }));
  if (!supported.length) {
    rows.push({ tool: '-', status: 'skipped', note: `no supported agent selected (needs one of ${MODERNE_AGENTS.join(', ')})` });
    return rows;
  }

  const cliPresent = exec('mod', ['--version']).status === 0;
  const registeredMap = new Map(supported.map((a) => [a.key, isModerneRegistered(exec, a)]));
  const allRegistered = supported.every((a) => registeredMap.get(a.key));

  if (cliPresent && allRegistered) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'unchanged' }))];
  }
  if (check) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: registeredMap.get(a.key) ? 'unchanged' : 'missing' }))];
  }

  const proceed = await confirmInstall(prompt, yes, 'moderne (OpenRewrite CLI, MCP server and skills)');
  if (!proceed) return [...rows, ...settleRemaining(supported, registeredMap, 'skipped', 'declined')];

  if (!cliPresent) {
    if (exec('brew', ['--version']).status !== 0) {
      return [...rows, ...settleRemaining(supported, registeredMap, 'skipped', 'install Homebrew first: https://brew.sh')];
    }
    const brew = exec('brew', ['install', 'moderneinc/moderne/mod']);
    if (brew.status !== 0) {
      return [...rows, ...settleRemaining(supported, registeredMap, 'failed', (brew.stderr || '').trim())];
    }
  }

  // One `mod config agent-tools <agent> install` call per agent that still needs it — see the
  // verified-behaviour comment above the constants for why the blanket `install` form is never
  // used. A failed install for one agent does not affect the others: each is its own row.
  const finalRows = [];
  for (const a of supported) {
    if (registeredMap.get(a.key)) {
      finalRows.push({ tool: a.key, status: 'unchanged' });
      continue;
    }
    const res = exec('mod', ['config', 'agent-tools', a.key, 'install']);
    finalRows.push(
      res.status === 0
        ? { tool: a.key, status: 'installed' }
        : { tool: a.key, status: 'failed', note: (res.stderr || '').trim() }
    );
  }
  return [...rows, ...finalRows];
}

async function provisionPlugins({ exec, check, yes, prompt, hasClaude = true, adapters = [] }) {
  const results = [];
  const push = (item, tool, r) => results.push({ provisioner: 'plugins', item, tool, status: r.status, ...(r.note ? { note: r.note } : {}) });
  const claudeSkipped = { status: 'skipped', note: 'claude not selected' };

  push('superpowers', 'claude', hasClaude ? await provisionClaudePlugin({
    exec, check, yes, prompt,
    item: 'superpowers',
    installSteps: [['plugin', 'install', 'superpowers@claude-plugins-official']],
  }) : claudeSkipped);

  push('speckit', '-', await provisionSpeckit({ exec, check, yes, prompt }));

  // Verified against https://github.com/spring-projects/spring-tools/blob/master/claude-plugins/spring-tools/README.md
  // (2026-07-25): the plugin's marketplace.json is published to a CDN, not the GitHub repo
  // itself, and the marketplace name is `spring-tools-marketplace` (stable) — not `spring-tools`.
  push('spring-tools', 'claude', hasClaude ? await provisionClaudePlugin({
    exec, check, yes, prompt,
    item: 'spring-tools',
    installSteps: [
      ['plugin', 'marketplace', 'add', 'https://cdn.spring.io/spring-tools/release/claude-plugins/marketplace.json'],
      ['plugin', 'install', 'spring-tools@spring-tools-marketplace'],
    ],
  }) : claudeSkipped);

  for (const row of await provisionModerne({ exec, check, yes, prompt, adapters })) {
    results.push({ provisioner: 'plugins', item: 'moderne', tool: row.tool, status: row.status, ...(row.note ? { note: row.note } : {}) });
  }

  return results;
}

module.exports = { provisionPlugins, findPlugin, moderneAuthStatus };
