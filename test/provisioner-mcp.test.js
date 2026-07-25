const { test } = require('node:test');
const assert = require('node:assert');
const { provisionMcp, MCP_SERVERS } = require('../lib/provisioners/mcp.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const claude = ADAPTERS.filter((a) => a.key === 'claude');

test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['excalidraw', 'playwright']);
});

test('adds missing servers, skips present, refuses project-scoped', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get' && args[2] === 'playwright') return { status: 0, stdout: 'playwright\n  Scope: Project config\n', stderr: '' };
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'failed');
  assert.match(byName.playwright.note, /project scope/i);
  assert.match(byName.playwright.note, /claude mcp remove/);
  assert.strictEqual(byName.excalidraw.status, 'installed');
  assert.ok(calls.some((c) => c.includes('mcp add --scope user --transport http excalidraw')));
});

test('check mode never calls add', () => {
  const calls = [];
  const exec = (bin, args) => { calls.push(args[1]); return { status: 1, stdout: '', stderr: '' }; };
  const results = provisionMcp({ adapters: claude, exec, check: true });
  assert.ok(results.every((r) => r.status === 'missing'));
  assert.ok(!calls.includes('add'));
});
