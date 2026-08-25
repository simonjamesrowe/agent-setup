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
  // Codex signs an MCP server in with `codex mcp login <NAME>`. Verified 2026-08-25 by running
  // both `codex mcp --help` and `codex mcp login --help` on this machine (codex-cli 0.133.0):
  // `codex mcp` lists the subcommands `list get add remove login logout`, and
  //   Usage: codex mcp login [OPTIONS] <NAME>
  //   Arguments: <NAME>  Name of the MCP server to authenticate with oauth
  // An earlier version of this hint refused to name a command and told the operator to go read
  // Codex's docs. That hedge was drawn from `codex mcp add --help` — the wrong --help; it covers
  // adding a server only. `codex mcp --help` was the one to run, and it names `login` outright.
  //
  // Takes the server name because `login` requires the positional <NAME>.
  authHint: (serverName) => `run: codex mcp login ${serverName}`,
};
