'use strict';
const path = require('node:path');
module.exports = {
  key: 'codex',
  binary: 'codex',
  skillsDir: (home) => path.join(home, '.codex', 'skills'),
  instructionsFile: (home) => path.join(home, '.codex', 'AGENTS.md'),
  // Verified against `codex mcp add --help` (codex-cli 0.133.0):
  // Usage: codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)
  // Codex CLI does support HTTP servers directly via --url, so no fallback
  // to null is needed here.
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', s.name, '--url', s.url]
    : ['mcp', 'add', s.name, '--', ...s.command],
  mcpGetArgs: (name) => ['mcp', 'get', name],
};
