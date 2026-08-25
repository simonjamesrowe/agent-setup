const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { provisionMcp, MCP_SERVERS } = require('../lib/provisioners/mcp.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const claude = ADAPTERS.filter((a) => a.key === 'claude');
const gemini = ADAPTERS.filter((a) => a.key === 'gemini');
const { exitCode } = require('../lib/report.js');

// Real shape of `claude mcp get <name>` stdout, captured on 2026-08-25. `status` is 0 for all
// three Status values — that is the whole reason these tests exist.
function claudeGetStdout(name, status, scope = 'User config (available in all your projects)') {
  return `${name}:\n  Scope: ${scope}\n  Status: ${status}\n  Type: http\n  URL: https://example.invalid/mcp\n`;
}

// A faked `claude` exec where `linear`'s `mcp get` returns the given Status line (exit 0, as the
// real CLI does) and every other server is unregistered.
function claudeExecWithLinearStatus(status, scope) {
  return (bin, args) => {
    if (args[1] === 'get' && args[2] === 'linear') {
      return { status: 0, stdout: claudeGetStdout('linear', status, scope), stderr: '' };
    }
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

function makeHomeWithGeminiSettings(mcpServers) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-mcp-'));
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ mcpServers }));
  return home;
}

test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['embabel-guide', 'excalidraw', 'javadocs', 'linear', 'playwright']);
  assert.deepStrictEqual(MCP_SERVERS.filter((s) => s.optional).map((s) => s.name), ['embabel-guide']);
  // linear is always-on: it is a hosted endpoint that costs nothing to have registered, unlike
  // embabel-guide which needs a local Docker/Neo4j app running to be anything but a dead server.
  assert.ok(!MCP_SERVERS.find((s) => s.name === 'linear').optional);
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
  assert.ok(calls.some((c) => c.includes('mcp add --scope user embabel-guide -- npx -y mcp-remote http://localhost:1337/sse --transport sse-only')));
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

test('linear registers as an HTTP server with per-adapter argv', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const claudeResults = provisionMcp({ adapters: claude, exec, check: false });
  assert.strictEqual(claudeResults.find((r) => r.item === 'linear').status, 'installed');
  assert.ok(calls.includes('claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp'));

  calls.length = 0;
  const codexResults = provisionMcp({ adapters: codex, exec, check: false });
  assert.strictEqual(codexResults.find((r) => r.item === 'linear').status, 'installed');
  assert.ok(calls.includes('codex mcp add linear --url https://mcp.linear.app/mcp'));
});

// `claude mcp get` exits 0 whether the server is connected, unauthorized, or failing to connect
// (verified 2026-08-25 against the real `atlassian` server, registered at user scope but never
// authorized: `Status: ! Needs authentication`, exit 0). Reporting that as `unchanged` would be
// doctor lying about exactly the condition it exists to surface.
test('needsAuth server registered but unauthorized -> optional with a sign-in note', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication');
  const results = provisionMcp({ adapters: claude, exec, check: true });
  const linear = results.find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'optional');
  assert.match(linear.note, /not authorized/);
  assert.match(linear.note, /\/mcp/);
});

// `optional` rather than `missing`/`failed` is the point: doctor must not exit non-zero for a
// browser sign-in the installer cannot perform. Same precedent as moderneAuthRow in plugins.js.
// The row is isolated here because the other catalog servers are unregistered in this fake and
// would exit 1 on their own under strictMissing.
test('an unauthorized needsAuth row never affects the exit code', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(exitCode([linear], { strictMissing: true }), 0);
  assert.strictEqual(exitCode([linear]), 0);
});

test('needsAuth server that is authorized -> plain unchanged, no note', () => {
  const exec = claudeExecWithLinearStatus('✔ Connected');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'unchanged');
  assert.strictEqual(linear.note, undefined);
});

// `✘ Failed to connect` is transient for a hosted HTTP endpoint (a network blip). Treating it as
// an auth problem would make doctor flaky, so it must fall through to today's behaviour.
test('failed-to-connect is not an auth problem', () => {
  const exec = claudeExecWithLinearStatus('✘ Failed to connect');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'unchanged');
});

// A shadowing project/local-scope registration is a real misconfiguration the operator must fix,
// and it outranks any auth consideration.
test('project-scope shadowing beats the auth check', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication', 'Project config');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'failed');
  assert.match(linear.note, /project scope/i);
});

// The catalog flag gates the behaviour, not the presence of the string — an open server has no
// OAuth flow to complete, so there is nothing to tell the operator to do.
test('servers without needsAuth are unaffected by a needs-authentication status', () => {
  const exec = (bin, args) => {
    if (args[1] === 'get' && args[2] === 'javadocs') {
      return { status: 0, stdout: claudeGetStdout('javadocs', '! Needs authentication'), stderr: '' };
    }
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const javadocs = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'javadocs');
  assert.strictEqual(javadocs.status, 'unchanged');
});

// A fresh install cannot authorize the server, so the row must say what the operator does next.
test('installing a needsAuth server tells the operator to sign in', () => {
  const exec = (bin, args) => {
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const linear = results.find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'installed');
  assert.match(linear.note, /\/mcp/);
  // An open server's install row stays note-free.
  assert.strictEqual(results.find((r) => r.item === 'javadocs').note, undefined);
});
