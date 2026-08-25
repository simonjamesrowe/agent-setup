'use strict';
const path = require('node:path');
module.exports = {
  key: 'claude',
  binary: 'claude',
  skillsDir: (home) => path.join(home, '.claude', 'skills'),
  instructionsFile: (home) => path.join(home, '.claude', 'CLAUDE.md'),
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', s.name, s.url]
    : ['mcp', 'add', '--scope', 'user', s.name, '--', ...s.command],
  mcpGetArgs: (name) => ['mcp', 'get', name],
  // The real Claude Code slash command that completes an MCP server's OAuth sign-in. Used by
  // the mcp provisioner to word the needsAuth `optional`/`installed` notes for this adapter.
  // Takes the server name only for signature uniformity across adapters (see the
  // adapter.authHint contract in lib/provisioners/mcp.js) and ignores it: `/mcp` takes no
  // argument, it opens a picker listing every registered server.
  authHint: (_serverName) => 'run /mcp in Claude Code to sign in',
};
