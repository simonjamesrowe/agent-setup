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

async function provisionPlugins({ exec, check, yes, prompt, hasClaude = true }) {
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

  return results;
}

module.exports = { provisionPlugins, findPlugin };
