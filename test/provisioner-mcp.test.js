const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { provisionMcp, MCP_SERVERS } = require('../lib/provisioners/mcp.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const claude = ADAPTERS.filter((a) => a.key === 'claude');
const gemini = ADAPTERS.filter((a) => a.key === 'gemini');

function makeHomeWithGeminiSettings(mcpServers) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-mcp-'));
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ mcpServers }));
  return home;
}

test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['embabel-guide', 'excalidraw', 'javadocs', 'playwright']);
  assert.deepStrictEqual(MCP_SERVERS.filter((s) => s.optional).map((s) => s.name), ['embabel-guide']);
});

test('optional servers are reported optional and never registered unless named in --with', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const embabel = results.find((r) => r.item === 'embabel-guide');
  assert.strictEqual(embabel.status, 'optional');
  assert.match(embabel.note, /--with embabel-guide/);
  assert.ok(!calls.some((c) => c.includes('embabel-guide')), 'must not even check an opted-out server');
});

test('optional servers register when named in --with', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false, with: ['embabel-guide'] });
  assert.strictEqual(results.find((r) => r.item === 'embabel-guide').status, 'installed');
  assert.ok(calls.some((c) => c.includes('mcp add --scope user embabel-guide -- npx mcp-remote http://localhost:1337/sse --transport sse-only')));
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
  assert.ok(results.every((r) => r.status === 'missing' || r.status === 'optional'));
  assert.ok(!calls.includes('add'));
});

// gemini: `gemini mcp list` is unreliable as a check source. Verified against gemini-cli
// (2026-07-25): run non-interactively (as spawnSync always does), the entire "Configured MCP
// servers:" report lands on stderr with stdout empty; and in an untrusted folder every server
// (even ones truly registered at user scope) is reported "Disabled". Either way, exec-based
// detection would misreport real, working, user-scoped servers as missing. So the gemini adapter
// checks ~/.gemini/settings.json `mcpServers` keys directly instead of shelling out — these tests
// prove the check reads that file and ignores exec()/`gemini mcp list` output entirely.
test('gemini: servers present in ~/.gemini/settings.json -> unchanged, never shells out to check', () => {
  const home = makeHomeWithGeminiSettings({
    playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    excalidraw: { url: 'https://mcp.excalidraw.com/mcp', type: 'http' },
  });
  const exec = () => { throw new Error('must not exec to check gemini registration'); };
  const results = provisionMcp({ adapters: gemini, exec, check: false, home });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'unchanged');
  assert.strictEqual(byName.excalidraw.status, 'unchanged');
});

test('gemini: even when `gemini mcp list` output looks like servers are missing/disabled (real broken-CLI shape), settings.json still reports unchanged', () => {
  const home = makeHomeWithGeminiSettings({
    playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    excalidraw: { url: 'https://mcp.excalidraw.com/mcp', type: 'http' },
  });
  // Real observed shape: non-interactive `gemini mcp list` puts everything on stderr and
  // leaves stdout empty; in an untrusted folder it also marks registered servers "Disabled".
  const exec = () => ({
    status: 0,
    stdout: '',
    stderr: 'Warning: MCP servers are configured but disabled because this folder is untrusted.\n\nConfigured MCP servers:\n\n○ playwright: npx -y @playwright/mcp@latest (stdio) - Disabled\n○ excalidraw: https://mcp.excalidraw.com/mcp (http) - Disabled\n',
  });
  const results = provisionMcp({ adapters: gemini, exec, check: true, home });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'unchanged');
  assert.strictEqual(byName.excalidraw.status, 'unchanged');
});

test('gemini: settings.json missing servers -> check mode reports missing, no exec calls', () => {
  const home = makeHomeWithGeminiSettings({});
  const exec = () => { throw new Error('must not exec to check gemini registration'); };
  const results = provisionMcp({ adapters: gemini, exec, check: true, home });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'missing');
  assert.strictEqual(byName.excalidraw.status, 'missing');
});

test('gemini: no ~/.gemini/settings.json at all -> treated as not registered, not a crash', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-mcp-'));
  const results = provisionMcp({ adapters: gemini, exec: () => ({ status: 1, stdout: '', stderr: '' }), check: true, home });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'missing');
  assert.strictEqual(byName.excalidraw.status, 'missing');
});

const codex = ADAPTERS.filter((a) => a.key === 'codex');

test('javadocs registers as an HTTP server with per-adapter argv', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const claudeResults = provisionMcp({ adapters: claude, exec, check: false });
  assert.strictEqual(claudeResults.find((r) => r.item === 'javadocs').status, 'installed');
  assert.ok(calls.includes('claude mcp add --scope user --transport http javadocs https://www.javadocs.dev/mcp'));

  calls.length = 0;
  const codexResults = provisionMcp({ adapters: codex, exec, check: false });
  assert.strictEqual(codexResults.find((r) => r.item === 'javadocs').status, 'installed');
  assert.ok(calls.includes('codex mcp add javadocs --url https://www.javadocs.dev/mcp'));
});
