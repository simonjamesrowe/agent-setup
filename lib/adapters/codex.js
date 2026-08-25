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
  // Codex's own re-authorization command is unverified as of 2026-08-25: `codex mcp add --help`
  // (verified above) documents adding a server, not signing in to one, and `codex mcp list`'s
  // `Auth` column has no documented companion command either. Naming a specific command here
  // would be the same "trust the exit code" class of bug the needsAuth check exists to fix, so
  // this stays generic until someone verifies the real flow against a real Codex install.
  authHint: "sign in following codex's own MCP authorization flow (exact command not verified as of 2026-08-25 — check codex's own docs)",
};
