const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('../bin/agent-setup.js');

test('parseArgs defaults to install', () => {
  assert.deepStrictEqual(parseArgs([]), { command: 'install', yes: false, tools: null, skip: [], target: null, with: [] });
});

test('parseArgs reads flags', () => {
  const a = parseArgs(['doctor', '--yes', '--tools', 'claude,gemini', '--skip', 'mcp,plugins', '--target', '/tmp/x', '--with', 'embabel-guide']);
  assert.strictEqual(a.command, 'doctor');
  assert.strictEqual(a.yes, true);
  assert.deepStrictEqual(a.tools, ['claude', 'gemini']);
  assert.deepStrictEqual(a.skip, ['mcp', 'plugins']);
  assert.strictEqual(a.target, '/tmp/x');
  assert.deepStrictEqual(a.with, ['embabel-guide']);
});

test('parseArgs --with accepts a comma list and defaults to empty', () => {
  assert.deepStrictEqual(parseArgs(['--with', 'embabel-guide,something-else']).with, ['embabel-guide', 'something-else']);
  assert.deepStrictEqual(parseArgs(['--with', '']).with, []);
});

test('help prints usage and exits 0', () => {
  const out = execFileSync(process.execPath, ['bin/agent-setup.js', 'help'], { encoding: 'utf8' });
  assert.match(out, /agent-setup/);
  assert.match(out, /install/);
  assert.match(out, /doctor/);
});
