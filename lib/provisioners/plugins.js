'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Matches a `claude plugin list` line like: "superpowers@claude-plugins-official  v1.2.0  enabled"
const PLUGIN_LINE_RE = /^(\S+)@(\S+)\s+.*\b(enabled|disabled)\b/;

function findPluginLine(listOutput, name) {
  for (const line of (listOutput || '').split('\n')) {
    const m = PLUGIN_LINE_RE.exec(line.trim());
    if (m && m[1] === name) return { marketplace: m[2], enabled: m[3] === 'enabled' };
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
  const list = exec('claude', ['plugin', 'list']);
  const found = findPluginLine(list.stdout, item);
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

function checkUiSh(home) {
  const skillsDir = path.join(home, '.claude', 'skills');
  try {
    const entries = fs.readdirSync(skillsDir);
    return entries.some((e) => e === 'ui.sh' || /^ui-/.test(e));
  } catch {
    return false;
  }
}

function provisionUiSh({ home }) {
  if (checkUiSh(home)) return { status: 'unchanged' };
  // Never automated: installing ui.sh requires a personal account token.
  return { status: 'skipped', note: 'get your personal install command from https://ui.sh (account token required)' };
}

async function provisionPlugins({ exec, check, yes, prompt, home }) {
  const results = [];
  const push = (item, tool, r) => results.push({ provisioner: 'plugins', item, tool, status: r.status, ...(r.note ? { note: r.note } : {}) });

  push('superpowers', 'claude', await provisionClaudePlugin({
    exec, check, yes, prompt,
    item: 'superpowers',
    installSteps: [['plugin', 'install', 'superpowers@claude-plugins-official']],
  }));

  push('speckit', '-', await provisionSpeckit({ exec, check, yes, prompt }));

  push('ui.sh', '-', provisionUiSh({ home }));

  // Verified against https://github.com/spring-projects/spring-tools/blob/master/claude-plugins/spring-tools/README.md
  // (2026-07-25): the plugin's marketplace.json is published to a CDN, not the GitHub repo
  // itself, and the marketplace name is `spring-tools-marketplace` (stable) — not `spring-tools`.
  push('spring-tools', 'claude', await provisionClaudePlugin({
    exec, check, yes, prompt,
    item: 'spring-tools',
    installSteps: [
      ['plugin', 'marketplace', 'add', 'https://cdn.spring.io/spring-tools/release/claude-plugins/marketplace.json'],
      ['plugin', 'install', 'spring-tools@spring-tools-marketplace'],
    ],
  }));

  return results;
}

module.exports = { provisionPlugins, findPluginLine };
