'use strict';
const fs = require('node:fs');
const path = require('node:path');

function settingsPath(home) {
  return path.join(home, '.gemini', 'settings.json');
}

// `gemini mcp list` is unreliable as a check source (verified against gemini-cli, 2026-07-25):
// - Run non-interactively (as this tool always does via spawnSync), gemini writes its ENTIRE
//   report — including the "Configured MCP servers:" list — to stderr, leaving stdout empty.
// - In an untrusted folder it also prints every server (even ones registered at user scope) as
//   "Disabled" and warns that user-level servers are suppressed there, so even parsing stderr
//   would misreport real, working, user-scoped servers as absent/disabled.
// The one artifact that reliably reflects true user-scope registration is the settings file
// gemini itself reads from: ~/.gemini/settings.json `mcpServers` keys. Read that directly
// instead of shelling out for the check.
function checkRegistered(name, home) {
  try {
    const raw = fs.readFileSync(settingsPath(home), 'utf8');
    const json = JSON.parse(raw);
    const registered = Boolean(json && json.mcpServers && Object.prototype.hasOwnProperty.call(json.mcpServers, name));
    return { registered, scope: registered ? 'user' : null };
  } catch {
    return { registered: false, scope: null };
  }
}

module.exports = {
  key: 'gemini',
  binary: 'gemini',
  skillsDir: (home) => path.join(home, '.gemini', 'skills'),
  instructionsFile: (home) => path.join(home, '.gemini', 'GEMINI.md'),
  // Verified against `gemini mcp add --help` (gemini-cli 0.49.0):
  // Usage: gemini mcp add [options] <name> <commandOrUrl> [args...]
  //   -s, --scope              user|project (default: project)
  //   -t, --transport, --type  stdio|sse|http (default: stdio)
  // No `--` separator: the stdio command's first token is the positional
  // <commandOrUrl>, remaining tokens are trailing [args...].
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', s.name, s.url]
    : ['mcp', 'add', '--scope', 'user', s.name, ...s.command],
  mcpGetArgs: (name) => ['mcp', 'list'],
  // Used by the mcp provisioner's check step in place of exec()-based detection — see
  // checkRegistered() above for why.
  mcpCheckRegistered: checkRegistered,
};
