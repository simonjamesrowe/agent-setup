const { test } = require('node:test');
const assert = require('node:assert');
const { provisionPlugins, findPlugin, moderneAuthStatus } = require('../lib/provisioners/plugins.js');

function byItem(results) {
  return Object.fromEntries(results.map((r) => [r.item, r]));
}

// Fixtures below mirror the REAL `claude plugin list --json` output (verified against
// claude-cli, 2026-07-25) — an array of installed-plugin objects with an `id` field shaped
// `name@marketplace` and a boolean `enabled` field. The plain-text `claude plugin list` output
// is NOT `name@marketplace ... enabled` on one line as previously assumed; it is an indented,
// multi-line block per plugin (`  ❯ name@marketplace` / `    Status: ✔ enabled`), which is why
// the provisioner now reads --json instead.
function pluginListJson(entries) {
  return JSON.stringify(entries.map(({ id, enabled }) => ({
    id, enabled, version: '1.0.0', scope: 'user',
    installPath: `/fake/${id}`, installedAt: '2026-01-01T00:00:00.000Z', lastUpdated: '2026-01-01T00:00:00.000Z',
  })));
}

test('findPlugin parses real `claude plugin list --json` shape, matches by id prefix, reports enabled/disabled', () => {
  const real = JSON.stringify([
    {
      id: 'spring-tools@spring-tools-marketplace', version: '2.2.0', scope: 'user', enabled: true,
      installPath: '/Users/x/.claude/plugins/cache/spring-tools-marketplace/spring-tools/2.2.0',
      installedAt: '2026-07-25T18:37:38.688Z', lastUpdated: '2026-07-25T18:37:38.688Z',
      mcpServers: { 'spring-tools-mcp': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/launcher.js'] } },
    },
    {
      id: 'superpowers@claude-plugins-official', version: '6.2.0', scope: 'user', enabled: false,
      installPath: '/Users/x/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0',
      installedAt: '2026-05-02T10:18:14.862Z', lastUpdated: '2026-07-25T13:58:56.121Z',
    },
  ]);

  assert.deepStrictEqual(findPlugin(real, 'spring-tools'), { marketplace: 'spring-tools-marketplace', enabled: true });
  assert.deepStrictEqual(findPlugin(real, 'superpowers'), { marketplace: 'claude-plugins-official', enabled: false });
  assert.strictEqual(findPlugin(real, 'not-installed'), null);
  assert.strictEqual(findPlugin('[]', 'superpowers'), null);
  assert.strictEqual(findPlugin('not json', 'superpowers'), null);
  assert.strictEqual(findPlugin('', 'superpowers'), null);
});

test('all present and enabled -> unchanged', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: 'superpowers@claude-plugins-official', enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const promptCalls = [];
  const prompt = async (q, def) => { promptCalls.push(q); return def; };

  const results = await provisionPlugins({ exec, check: false, yes: false, prompt });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'unchanged');
  assert.strictEqual(r.speckit.status, 'unchanged');
  assert.strictEqual(r['spring-tools'].status, 'unchanged');
  assert.strictEqual(promptCalls.length, 0, 'must not prompt when nothing needs installing');
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add')));
});

test('superpowers installed but disabled -> enables using marketplace parsed from list, returns updated', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: pluginListJson([{ id: 'superpowers@claude-plugins-official', enabled: false }]), stderr: '' };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const prompt = async () => { throw new Error('prompt should be bypassed by yes:true'); };

  const results = await provisionPlugins({ exec, check: false, yes: true, prompt });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'updated');
  assert.ok(calls.includes('claude plugin install superpowers@claude-plugins-official'));
  assert.ok(calls.includes('claude plugin enable superpowers@claude-plugins-official'));
});

test('check mode with nothing present -> missing, zero install calls', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: pluginListJson([{ id: 'some-other-plugin@some-marketplace', enabled: true }]), stderr: '' };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 1, stdout: '', stderr: 'command not found' };
    throw new Error(`unexpected exec call in check mode: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => { throw new Error('must never prompt in check mode'); };

  const results = await provisionPlugins({ exec, check: true, yes: false, prompt });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'missing');
  assert.strictEqual(r.speckit.status, 'missing');
  assert.strictEqual(r['spring-tools'].status, 'missing');
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add') || c.includes('uv ')));
});

test('claude not selected -> superpowers/spring-tools skipped without exec("claude", ...), other plugins unaffected', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude') throw new Error(`must not exec claude when hasClaude is false: ${[bin, ...args].join(' ')}`);
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => { throw new Error('must not prompt for claude-only plugins when claude is not selected'); };

  const results = await provisionPlugins({ exec, check: false, yes: false, prompt, hasClaude: false });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'skipped');
  assert.strictEqual(r.superpowers.note, 'claude not selected');
  assert.strictEqual(r['spring-tools'].status, 'skipped');
  assert.strictEqual(r['spring-tools'].note, 'claude not selected');
  // speckit is tool-agnostic and must still be handled normally.
  assert.strictEqual(r.speckit.status, 'unchanged');
  assert.ok(!calls.some((c) => c.startsWith('claude ')));
});

test('declined install prompt -> skipped with declined note, no install calls', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') return { status: 0, stdout: pluginListJson([]), stderr: '' };
    if (bin === 'specify' && args[0] === '--version') return { status: 1, stdout: '', stderr: '' };
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => false;

  const results = await provisionPlugins({ exec, check: false, yes: false, prompt });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'skipped');
  assert.strictEqual(r.superpowers.note, 'declined');
  assert.strictEqual(r.speckit.status, 'skipped');
  assert.strictEqual(r.speckit.note, 'declined');
  assert.strictEqual(r['spring-tools'].status, 'skipped');
  assert.strictEqual(r['spring-tools'].note, 'declined');
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add') || c.includes('uv ')));
});

const claudeOnly = [{ key: 'claude' }];
const allThree = [{ key: 'claude' }, { key: 'gemini' }, { key: 'codex' }];

// Baseline fake: superpowers/spring-tools/speckit all already present, so the only rows that
// move in these tests are moderne's. `moderneInstalled` controls `mod --version`;
// `mcpRegistered` controls whether the agent already has the moderne MCP server.
function moderneExec({ moderneInstalled, mcpRegistered, hasBrew = true, calls = [], failAt = null }) {
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (failAt && line.includes(failAt)) return { status: 1, stdout: '', stderr: 'boom' };
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: 'superpowers@claude-plugins-official', enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    if (bin === 'mod' && args[0] === '--version') {
      return moderneInstalled ? { status: 0, stdout: 'mod 3.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'brew' && args[0] === '--version') {
      return hasBrew ? { status: 0, stdout: 'Homebrew 4.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (args[0] === 'mcp' && args[1] === 'get') {
      return mcpRegistered ? { status: 0, stdout: 'moderne\n  Scope: User config\n', stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
    }
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

test('moderne: cli present and mcp registered -> unchanged, no install calls', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'unchanged');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: cli absent -> brew install then per-agent agent-tools install, reports installed', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

test('moderne: cli present but mcp not registered -> only runs per-agent agent-tools install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(!calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

test('moderne: no homebrew -> skipped with actionable note, never runs brew install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, hasBrew: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /brew\.sh/);
  assert.ok(!calls.some((c) => c.includes('brew install')));
});

test('moderne: gemini is reported unsupported and never provisioned', async () => {
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: allThree });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const gemini = moderneRows.find((r) => r.tool === 'gemini');
  assert.strictEqual(gemini.status, 'skipped');
  assert.match(gemini.note, /not supported/i);
  assert.deepStrictEqual(moderneRows.filter((r) => r.tool !== 'gemini').map((r) => r.status), ['unchanged', 'unchanged']);
});

test('moderne: no adapters -> skipped, never execs mod or brew', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: [] });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /no supported agent/i);
  assert.ok(!calls.some((c) => c.startsWith('mod ') || c.startsWith('brew ')));
});

test('moderne: check mode reports missing and never installs', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: true, yes: false, prompt: async () => { throw new Error('must never prompt in check mode'); }, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'missing');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: declined prompt -> skipped with declined note', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: false, prompt: async () => false, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.strictEqual(r.moderne.note, 'declined');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: failing install step -> failed with stderr in the note', async () => {
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, failAt: 'brew install' });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'failed');
  assert.strictEqual(r.moderne.note, 'boom');
});

// Mixed-state fake: claude already has the moderne MCP server registered, codex does not. This is
// exactly the scenario that exposed finding 1 live — a single combined `every(...)` check
// reported claude as `missing` too, purely because codex wasn't registered.
function moderneMixedExec({ calls = [] } = {}) {
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: 'superpowers@claude-plugins-official', enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    if (bin === 'mod' && args[0] === '--version') return { status: 0, stdout: 'mod 4.6.3', stderr: '' };
    if (bin === 'brew' && args[0] === '--version') return { status: 0, stdout: 'Homebrew 4.0.0', stderr: '' };
    if (bin === 'claude' && args[0] === 'mcp' && args[1] === 'get') return { status: 0, stdout: 'moderne\n  Scope: User config\n', stderr: '' };
    if (bin === 'codex' && args[0] === 'mcp' && args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

test('moderne: mixed registration (claude registered, codex not) — check mode reports each agent separately', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls });
  const results = await provisionPlugins({
    exec, check: true, yes: false,
    prompt: async () => { throw new Error('must never prompt in check mode'); },
    adapters: [{ key: 'claude' }, { key: 'codex' }],
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'claude').status, 'unchanged');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'codex').status, 'missing');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools')));
});

test('moderne: mixed registration (claude registered, codex not) — install mode only installs codex', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls });
  const results = await provisionPlugins({
    exec, check: false, yes: true, prompt: async () => true,
    adapters: [{ key: 'claude' }, { key: 'codex' }],
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'claude').status, 'unchanged');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'codex').status, 'installed');
  assert.ok(calls.includes('mod config agent-tools codex install'));
  assert.ok(!calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.some((c) => c.includes('brew install')));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

// Regression guard for finding 2: the blanket `mod config agent-tools install` provisions all
// eight Moderne-supported agents and writes into the current working directory (it created
// `.github/instructions/moderne-*.instructions.md` and `.vscode/mcp.json` in a real repo when
// run for real). It must never be executed, in any scenario.
test('moderne: blanket "mod config agent-tools install" is never executed', async () => {
  const scenarios = [
    { moderneInstalled: false, mcpRegistered: false },
    { moderneInstalled: true, mcpRegistered: false },
    { moderneInstalled: true, mcpRegistered: true },
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const exec = moderneExec({ ...scenario, calls });
    await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
    assert.ok(
      !calls.includes('mod config agent-tools install'),
      `blanket install must never run (scenario: ${JSON.stringify(scenario)})`
    );
  }
});

test('moderneAuthStatus: configured when the status command succeeds with output', () => {
  const configured = moderneAuthStatus(() => ({ status: 0, stdout: 'https://app.moderne.io  user@example.com\n', stderr: '' }));
  assert.strictEqual(configured.configured, true);
  const empty = moderneAuthStatus(() => ({ status: 0, stdout: '   \n', stderr: '' }));
  assert.strictEqual(empty.configured, false);
  const failed = moderneAuthStatus(() => ({ status: 1, stdout: '', stderr: 'not configured' }));
  assert.strictEqual(failed.configured, false);
});
