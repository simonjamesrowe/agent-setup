const { test } = require('node:test');
const assert = require('node:assert');
const { provisionPlugins, findPlugin } = require('../lib/provisioners/plugins.js');

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
