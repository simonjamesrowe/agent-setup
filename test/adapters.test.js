'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ADAPTERS, detectTools } = require('../lib/adapters/index.js');

test('adapter destinations', () => {
  const byKey = Object.fromEntries(ADAPTERS.map((a) => [a.key, a]));
  assert.strictEqual(byKey.claude.skillsDir('/h'), '/h/.claude/skills');
  assert.strictEqual(byKey.claude.instructionsFile('/h'), '/h/.claude/CLAUDE.md');
  assert.strictEqual(byKey.gemini.skillsDir('/h'), '/h/.gemini/skills');
  assert.strictEqual(byKey.gemini.instructionsFile('/h'), '/h/.gemini/GEMINI.md');
  assert.strictEqual(byKey.codex.skillsDir('/h'), '/h/.codex/skills');
  assert.strictEqual(byKey.codex.instructionsFile('/h'), '/h/.codex/AGENTS.md');
});

test('claude mcp args for stdio and http', () => {
  const claude = ADAPTERS.find((a) => a.key === 'claude');
  assert.deepStrictEqual(
    claude.mcpAddArgs({ name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] }),
    ['mcp', 'add', '--scope', 'user', 'playwright', '--', 'npx', '-y', '@playwright/mcp@latest']
  );
  assert.deepStrictEqual(
    claude.mcpAddArgs({ name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' }),
    ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'excalidraw', 'https://mcp.excalidraw.com/mcp']
  );
});

test('gemini mcp args for stdio and http (verified against gemini mcp add --help)', () => {
  const gemini = ADAPTERS.find((a) => a.key === 'gemini');
  assert.deepStrictEqual(
    gemini.mcpAddArgs({ name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] }),
    ['mcp', 'add', '--scope', 'user', 'playwright', 'npx', '-y', '@playwright/mcp@latest']
  );
  assert.deepStrictEqual(
    gemini.mcpAddArgs({ name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' }),
    ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'excalidraw', 'https://mcp.excalidraw.com/mcp']
  );
  assert.deepStrictEqual(gemini.mcpGetArgs('playwright'), ['mcp', 'list']);
});

test('codex mcp args for stdio and http (verified against codex mcp add --help)', () => {
  const codex = ADAPTERS.find((a) => a.key === 'codex');
  assert.deepStrictEqual(
    codex.mcpAddArgs({ name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] }),
    ['mcp', 'add', 'playwright', '--', 'npx', '-y', '@playwright/mcp@latest']
  );
  assert.deepStrictEqual(
    codex.mcpAddArgs({ name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' }),
    ['mcp', 'add', 'excalidraw', '--url', 'https://mcp.excalidraw.com/mcp']
  );
  assert.deepStrictEqual(codex.mcpGetArgs('playwright'), ['mcp', 'get', 'playwright']);
});

test('detectTools honors --tools flag and PATH detection', () => {
  const onPath = (bin) => bin !== 'codex';
  assert.deepStrictEqual(detectTools({ toolsFlag: null, isOnPath: onPath }).map((a) => a.key), ['claude', 'gemini']);
  assert.deepStrictEqual(detectTools({ toolsFlag: ['codex'], isOnPath: onPath }).map((a) => a.key), ['codex']);
});
