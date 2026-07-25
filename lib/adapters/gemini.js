'use strict';
const path = require('node:path');
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
};
