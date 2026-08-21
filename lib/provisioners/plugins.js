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
// 2026-08-21): `mod config agent-tools install` does two things in one shot: registers the local
// Moderne MCP server with each supported agent (it shells out to `claude mcp add` itself, and
// `claude mcp get moderne` / `claude mcp list` confirm the server is registered as `moderne`,
// command `/opt/homebrew/bin/mod mcp`) and installs Moderne's skills into that agent's
// marketplace directory (`mod config agent-tools install --help` lists 9 skills: edit-code,
// analyze-code, search-code, find-symbols, pattern-replace, inspect-status, change-symbols,
// query-datatable, create-recipe). So there is nothing to register by hand here — we only ensure
// `mod` exists and has been pointed at the agents.
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

async function provisionModerne({ exec, check, yes, prompt, adapters }) {
  const supported = adapters.filter((a) => MODERNE_AGENTS.includes(a.key));
  const unsupported = adapters.filter((a) => !MODERNE_AGENTS.includes(a.key));
  const rows = unsupported.map((a) => ({ tool: a.key, status: 'skipped', note: `not supported by mod config agent-tools (supports ${MODERNE_AGENTS.join(', ')})` }));
  if (!supported.length) {
    rows.push({ tool: '-', status: 'skipped', note: `no supported agent selected (needs one of ${MODERNE_AGENTS.join(', ')})` });
    return rows;
  }

  const cliPresent = exec('mod', ['--version']).status === 0;
  const registered = cliPresent && supported.every((a) => {
    const get = exec(a.binary || a.key, ['mcp', 'get', MODERNE_MCP_SERVER]);
    return get.status === 0 && get.stdout.includes(MODERNE_MCP_SERVER);
  });
  if (cliPresent && registered) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'unchanged' }))];
  }
  if (check) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'missing' }))];
  }

  const proceed = await confirmInstall(prompt, yes, 'moderne (OpenRewrite CLI, MCP server and skills)');
  if (!proceed) return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'skipped', note: 'declined' }))];

  const steps = [];
  if (!cliPresent) {
    if (exec('brew', ['--version']).status !== 0) {
      return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'skipped', note: 'install Homebrew first: https://brew.sh' }))];
    }
    steps.push(['brew', ['install', 'moderneinc/moderne/mod']]);
  }
  steps.push(['mod', ['config', 'agent-tools', 'install']]);
  for (const [bin, args] of steps) {
    const res = exec(bin, args);
    if (res.status !== 0) {
      return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'failed', note: (res.stderr || '').trim() }))];
    }
  }
  return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'installed' }))];
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
