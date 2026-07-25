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
};
