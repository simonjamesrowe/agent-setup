const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  provisionPlugins, findPlugin, findCodexPlugin, moderneAuthStatus, moderneAuthRow,
  MATTPOCOCK_PLUGIN, MATTPOCOCK_SKILL_NAMES,
} = require('../lib/provisioners/plugins.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const { exitCode } = require('../lib/report.js');

// Collapses to one row per item, so it is only safe for items that emit a single row in the
// scenario under test (speckit always; moderne and mattpocock-skills only in single-adapter
// runs). Multi-adapter assertions filter `results` by item AND tool instead.
function byItem(results) {
  return Object.fromEntries(results.map((r) => [r.item, r]));
}

const ok = (stdout = 'ok') => ({ status: 0, stdout, stderr: '' });
const fail = (stderr = 'boom') => ({ status: 1, stdout: '', stderr });

// Real adapters, not `{ key: 'claude' }` stubs. provisionPlugins now reaches for
// adapter.binary, adapter.skillsDir and adapter.mcpAddArgs, so a stub would either crash or
// silently exercise a different code path than production does.
const adapterFor = (key) => ADAPTERS.find((a) => a.key === key);
const claudeOnly = [adapterFor('claude')];
const codexOnly = [adapterFor('codex')];
const geminiOnly = [adapterFor('gemini')];
const claudeAndCodex = [adapterFor('claude'), adapterFor('codex')];
const allThree = ADAPTERS;

function emptyHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-plugins-'));
}

// A home whose ~/.gemini/skills already holds every mattpocock skill, so the gemini branch
// reports `unchanged` and stays out of the way of tests that are about something else.
function satisfiedHome() {
  const home = emptyHome();
  const dir = adapterFor('gemini').skillsDir(home);
  for (const name of MATTPOCOCK_SKILL_NAMES) fs.mkdirSync(path.join(dir, name), { recursive: true });
  return home;
}

const SATISFIED_HOME = satisfiedHome();
const runPlugins = (opts) => provisionPlugins({ home: SATISFIED_HOME, ...opts });

// `codex plugin list --json` shape, verified against codex-cli 0.150.1 (2026-09-06): an object
// with `installed` and `available` arrays, each entry carrying separate `name` /
// `marketplaceName` fields rather than Claude's single `name@marketplace` id string. Entries
// under `available` are NOT installed and must never be treated as present.
function codexPluginListJson(entries, available = []) {
  return JSON.stringify({
    installed: entries.map(({ name, marketplace, enabled = true }) => ({
      pluginId: `${name}@${marketplace}`, name, marketplaceName: marketplace,
      version: '1.2.3', installed: true, enabled,
      source: { source: 'git', path: `/fake/${name}` },
    })),
    available: available.map(({ name, marketplace }) => ({
      pluginId: `${name}@${marketplace}`, name, marketplaceName: marketplace, installed: false, enabled: false,
    })),
  });
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

test('findCodexPlugin parses real `codex plugin list --json` shape, ignores `available`, reports enabled/disabled', () => {
  const real = codexPluginListJson(
    [
      { name: 'browser', marketplace: 'openai-bundled' },
      { name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock', enabled: false },
    ],
    [{ name: 'linear', marketplace: 'openai-curated' }]
  );

  assert.deepStrictEqual(findCodexPlugin(real, 'browser'), { marketplace: 'openai-bundled', enabled: true });
  assert.deepStrictEqual(findCodexPlugin(real, MATTPOCOCK_PLUGIN), { marketplace: 'mattpocock', enabled: false });
  // Present in `available` but not installed: must read as absent, not as an installed plugin.
  assert.strictEqual(findCodexPlugin(real, 'linear'), null);
  assert.strictEqual(findCodexPlugin('{"installed":[]}', 'x'), null);
  assert.strictEqual(findCodexPlugin('not json', 'x'), null);
  assert.strictEqual(findCodexPlugin('', 'x'), null);
});

// One fake that answers every probe provisionPlugins makes on a fully provisioned machine:
// mattpocock-skills installed for claude and codex, superpowers absent, speckit present, mod
// present and its MCP server registered. `overrides` is consulted first and may return undefined
// to fall through, so each test moves exactly one answer off the baseline.
function fullExec({ calls = [], overrides = () => undefined } = {}) {
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    const override = overrides(bin, args, line);
    if (override) return override;
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return ok(pluginListJson([
        { id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true },
        { id: 'spring-tools@spring-tools-marketplace', enabled: true },
      ]));
    }
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') {
      return ok(codexPluginListJson([{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }]));
    }
    if (bin === 'specify' && args[0] === '--version') return ok('specify 0.1.0');
    if (bin === 'mod' && args[0] === '--version') return ok('mod 4.6.3');
    if (bin === 'which') return ok('/opt/homebrew/bin/mod\n');
    if (args[0] === 'mcp' && args[1] === 'get') return ok('moderne\n  Scope: User config\n');
    throw new Error(`unexpected exec call: ${line}`);
  };
}

test('all present and enabled -> unchanged, nothing installed, nothing prompted', async () => {
  const calls = [];
  const promptCalls = [];
  const prompt = async (q, def) => { promptCalls.push(q); return def; };

  const results = await runPlugins({ exec: fullExec({ calls }), check: false, yes: false, prompt, adapters: allThree });

  for (const row of results.filter((r) => r.item === MATTPOCOCK_PLUGIN)) {
    assert.strictEqual(row.status, 'unchanged', `${row.tool} should be unchanged`);
  }
  assert.strictEqual(byItem(results).speckit.status, 'unchanged');
  assert.strictEqual(byItem(results)['spring-tools'].status, 'unchanged');
  assert.strictEqual(promptCalls.length, 0, 'must not prompt when nothing needs installing');
  assert.ok(!calls.some((c) => /plugin (install|add|enable|uninstall|remove)\b/.test(c) || c.includes('marketplace add') || c.includes('skills install')));
});

// The whole point of the swap: superpowers must never be installed by this tool again.
test('superpowers is never installed, for any agent, in any mode', async () => {
  for (const check of [false, true]) {
    const calls = [];
    await runPlugins({ exec: fullExec({ calls }), check, yes: true, prompt: async () => true, adapters: allThree });
    assert.ok(
      !calls.some((c) => c.includes('superpowers') && /(install|add)\b/.test(c)),
      `superpowers must not be installed (check: ${check})`
    );
  }
});

test('mattpocock-skills: claude adds the marketplace then installs the plugin', async () => {
  const calls = [];
  const exec = fullExec({
    calls,
    overrides: (bin, args) => {
      if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') return ok(pluginListJson([]));
      if (bin === 'claude' && args[0] === 'plugin') return ok();
      return undefined;
    },
  });

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'claude');

  assert.strictEqual(row.status, 'installed');
  // The marketplace add is not optional: mattpocock-skills does not ship in the built-in
  // claude-plugins-official marketplace, so `plugin install` alone cannot resolve it.
  assert.ok(calls.includes('claude plugin marketplace add mattpocock/skills'));
  assert.ok(calls.includes(`claude plugin install ${MATTPOCOCK_PLUGIN}@mattpocock`));
});

test('mattpocock-skills: codex uses `plugin add` (not `plugin install`) and re-probes after it', async () => {
  const calls = [];
  let installed = false;
  const exec = fullExec({
    calls,
    overrides: (bin, args) => {
      if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') {
        return ok(codexPluginListJson(installed ? [{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }] : []));
      }
      if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'add') { installed = true; return ok(); }
      if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'marketplace') return ok();
      return undefined;
    },
  });

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: codexOnly });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'codex');

  assert.strictEqual(row.status, 'installed');
  assert.ok(calls.includes('codex plugin marketplace add mattpocock/skills'));
  assert.ok(calls.includes(`codex plugin add ${MATTPOCOCK_PLUGIN}@mattpocock`));
  // `plugin install` is Claude's verb; codex has no such subcommand.
  assert.ok(!calls.some((c) => c.startsWith('codex plugin install')));
});

// Same defensive rule the moderne rows learned the hard way: an exit code of 0 from an agent
// tooling CLI is not proof the state changed. Codex reporting success while the plugin is still
// absent must surface as `failed`, never as `installed`.
test('mattpocock-skills: codex install exits 0 but plugin still absent -> failed, not installed', async () => {
  const exec = fullExec({
    overrides: (bin, args) => {
      if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') return ok(codexPluginListJson([]));
      if (bin === 'codex' && args[0] === 'plugin') return ok();
      return undefined;
    },
  });

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: codexOnly });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'codex');

  assert.strictEqual(row.status, 'failed');
  assert.match(row.note, /reported success/);
  assert.match(row.note, /not installed/);
});

test('mattpocock-skills: gemini installs the two upstream subdirectories, never `--path skills`', async () => {
  const home = emptyHome();
  const dir = adapterFor('gemini').skillsDir(home);
  const calls = [];
  const exec = fullExec({
    calls,
    overrides: (bin, args) => {
      if (bin !== 'gemini') return undefined;
      // Model the real command: it materialises the skill directories on disk.
      for (const name of MATTPOCOCK_SKILL_NAMES) fs.mkdirSync(path.join(dir, name), { recursive: true });
      assert.ok(args.includes('--consent'), 'must pass --consent or the install blocks on a prompt no non-TTY can answer');
      return ok();
    },
  });

  const results = await provisionPlugins({ home, exec, check: false, yes: true, prompt: async () => true, adapters: geminiOnly });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'gemini');

  assert.strictEqual(row.status, 'installed');
  const geminiCalls = calls.filter((c) => c.startsWith('gemini skills install'));
  assert.strictEqual(geminiCalls.length, 2);
  assert.ok(geminiCalls.some((c) => c.includes('--path skills/engineering')));
  assert.ok(geminiCalls.some((c) => c.includes('--path skills/productivity')));
  // `--path skills` would also drag in skills/in-progress and skills/misc, which the upstream
  // plugin manifest deliberately excludes — Gemini would then have 12 skills Claude/Codex lack.
  assert.ok(!geminiCalls.some((c) => /--path skills(\s|$)/.test(c)));
});

test('mattpocock-skills: gemini reports failed when skills are still absent after a zero exit', async () => {
  const home = emptyHome();
  const exec = fullExec({ overrides: (bin) => (bin === 'gemini' ? ok() : undefined) });

  const results = await provisionPlugins({ home, exec, check: false, yes: true, prompt: async () => true, adapters: geminiOnly });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'gemini');

  assert.strictEqual(row.status, 'failed');
  assert.match(row.note, /still absent/);
  assert.match(row.note, /grill-me/);
});

test('mattpocock-skills: gemini check mode reports missing without exec-ing gemini', async () => {
  const home = emptyHome();
  const calls = [];
  const exec = fullExec({ calls });

  const results = await provisionPlugins({
    home, exec, check: true, yes: false,
    prompt: async () => { throw new Error('must never prompt in check mode'); },
    adapters: geminiOnly,
  });
  const row = results.find((r) => r.item === MATTPOCOCK_PLUGIN && r.tool === 'gemini');

  assert.strictEqual(row.status, 'missing');
  assert.match(row.note, new RegExp(`${MATTPOCOCK_SKILL_NAMES.length} of ${MATTPOCOCK_SKILL_NAMES.length} skills absent`));
  assert.ok(!calls.some((c) => c.startsWith('gemini ')));
});

test('superpowers: uninstalled from claude and codex, using each tool\'s own verb and marketplace', async () => {
  const calls = [];
  const removed = new Set();
  const exec = fullExec({
    calls,
    overrides: (bin, args) => {
      if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
        const entries = [{ id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true }, { id: 'spring-tools@spring-tools-marketplace', enabled: true }];
        if (!removed.has('claude')) entries.push({ id: 'superpowers@claude-plugins-official', enabled: true });
        return ok(pluginListJson(entries));
      }
      if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') {
        const entries = [{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }];
        if (!removed.has('codex')) entries.push({ name: 'superpowers', marketplace: 'openai-curated' });
        return ok(codexPluginListJson(entries));
      }
      if (args[0] === 'plugin' && (args[1] === 'uninstall' || args[1] === 'remove')) { removed.add(bin); return ok(); }
      return undefined;
    },
  });

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: allThree });
  const rows = results.filter((r) => r.item === 'superpowers');

  assert.deepStrictEqual(rows.map((r) => r.tool), ['claude', 'codex']);
  for (const row of rows) {
    assert.strictEqual(row.status, 'updated');
    assert.strictEqual(row.note, 'removed');
  }
  // Each tool's own verb, and the marketplace parsed from that tool's own list output — the two
  // differ (claude-plugins-official vs openai-curated), so neither may be hardcoded.
  assert.ok(calls.includes('claude plugin uninstall superpowers@claude-plugins-official'));
  assert.ok(calls.includes('codex plugin remove superpowers@openai-curated'));
});

test('superpowers: a removal that exits 0 but leaves the plugin installed -> failed', async () => {
  const exec = fullExec({
    overrides: (bin, args) => {
      if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
        return ok(pluginListJson([{ id: 'superpowers@claude-plugins-official', enabled: true }]));
      }
      if (bin === 'claude' && args[0] === 'plugin') return ok();
      return undefined;
    },
  });

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const row = results.find((r) => r.item === 'superpowers');

  assert.strictEqual(row.status, 'failed');
  assert.match(row.note, /still installed/);
});

// `missing` here means "present, and should not be" — the inverse of its usual sense. It is
// deliberate: it is the only status doctor counts towards a non-zero exit, which is the correct
// signal for "you still have superpowers installed". The note has to say so in words.
test('superpowers: doctor reports a still-installed superpowers as missing and exits 1', async () => {
  const calls = [];
  const exec = fullExec({
    calls,
    overrides: (bin, args) => (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list'
      ? ok(pluginListJson([{ id: 'superpowers@claude-plugins-official', enabled: true }, { id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true }, { id: 'spring-tools@spring-tools-marketplace', enabled: true }]))
      : undefined),
  });

  const results = await runPlugins({
    exec, check: true, yes: false,
    prompt: async () => { throw new Error('must never prompt in check mode'); },
    adapters: claudeOnly,
  });
  const row = results.find((r) => r.item === 'superpowers');

  assert.strictEqual(row.status, 'missing');
  assert.match(row.note, /still installed/);
  assert.match(row.note, /run install to remove/);
  assert.strictEqual(exitCode([row], { strictMissing: true }), 1);
  assert.ok(!calls.some((c) => /plugin (uninstall|remove)\b/.test(c)));
});

test('superpowers: already absent -> unchanged, and no removal is attempted', async () => {
  const calls = [];
  const results = await runPlugins({ exec: fullExec({ calls }), check: false, yes: true, prompt: async () => true, adapters: claudeAndCodex });
  const rows = results.filter((r) => r.item === 'superpowers');

  assert.deepStrictEqual(rows.map((r) => r.status), ['unchanged', 'unchanged']);
  assert.deepStrictEqual(rows.map((r) => r.note), ['not installed', 'not installed']);
  assert.ok(!calls.some((c) => /plugin (uninstall|remove)\b/.test(c)));
});

// Gemini has no plugin mechanism, so superpowers was never installable there. A row saying
// "not applicable" would be pure noise in the table.
test('superpowers: gemini gets no row at all', async () => {
  const results = await runPlugins({ exec: fullExec(), check: false, yes: true, prompt: async () => true, adapters: allThree });
  assert.ok(!results.some((r) => r.item === 'superpowers' && r.tool === 'gemini'));
});

test('check mode with nothing present -> missing, zero install calls', async () => {
  const home = emptyHome();
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') return ok(pluginListJson([{ id: 'some-other-plugin@some-marketplace', enabled: true }]));
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') return ok(codexPluginListJson([]));
    if (bin === 'specify' && args[0] === '--version') return fail('command not found');
    if (bin === 'mod' && args[0] === '--version') return fail('command not found');
    if (args[0] === 'mcp' && args[1] === 'get') return fail('not found');
    throw new Error(`unexpected exec call in check mode: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => { throw new Error('must never prompt in check mode'); };

  const results = await provisionPlugins({ home, exec, check: true, yes: false, prompt, adapters: allThree });
  const r = byItem(results);

  for (const row of results.filter((x) => x.item === MATTPOCOCK_PLUGIN)) {
    assert.strictEqual(row.status, 'missing', `${row.tool} should be missing`);
  }
  assert.strictEqual(r.speckit.status, 'missing');
  assert.strictEqual(r['spring-tools'].status, 'missing');
  assert.ok(!calls.some((c) => /plugin (install|add|enable|uninstall|remove)\b/.test(c) || c.includes('marketplace add') || c.includes('skills install') || c.includes('uv ')));
});

test('claude not selected -> spring-tools skipped without exec("claude", ...), other plugins unaffected', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude') throw new Error(`must not exec claude when hasClaude is false: ${[bin, ...args].join(' ')}`);
    if (bin === 'specify' && args[0] === '--version') return ok('specify 0.1.0');
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => { throw new Error('must not prompt for claude-only plugins when claude is not selected'); };

  const results = await runPlugins({ exec, check: false, yes: false, prompt, hasClaude: false, adapters: [] });
  const r = byItem(results);

  assert.strictEqual(r['spring-tools'].status, 'skipped');
  assert.strictEqual(r['spring-tools'].note, 'claude not selected');
  // speckit is tool-agnostic and must still be handled normally.
  assert.strictEqual(r.speckit.status, 'unchanged');
  assert.ok(!calls.some((c) => c.startsWith('claude ')));
});

test('declined prompt -> skipped with declined note, no install or removal calls', async () => {
  const home = emptyHome();
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') return ok(pluginListJson([{ id: 'superpowers@claude-plugins-official', enabled: true }]));
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') return ok(codexPluginListJson([]));
    if (bin === 'specify' && args[0] === '--version') return fail();
    if (bin === 'mod' && args[0] === '--version') return fail('command not found');
    if (args[0] === 'mcp' && args[1] === 'get') return fail('not found');
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => false;

  const results = await provisionPlugins({ home, exec, check: false, yes: false, prompt, adapters: allThree });
  const r = byItem(results);

  for (const row of results.filter((x) => x.item === MATTPOCOCK_PLUGIN)) {
    assert.strictEqual(row.status, 'skipped', `${row.tool} should be skipped`);
    assert.strictEqual(row.note, 'declined');
  }
  const superpowersRow = results.find((x) => x.item === 'superpowers' && x.tool === 'claude');
  assert.strictEqual(superpowersRow.status, 'skipped');
  assert.strictEqual(superpowersRow.note, 'declined');
  assert.strictEqual(r.speckit.status, 'skipped');
  assert.strictEqual(r['spring-tools'].status, 'skipped');
  assert.ok(!calls.some((c) => /plugin (install|add|enable|uninstall|remove)\b/.test(c) || c.includes('marketplace add') || c.includes('skills install') || c.includes('uv ')));
});


// Baseline fake: superpowers/spring-tools/speckit all already present, so the only rows that
// move in these tests are moderne's. `moderneInstalled` controls `mod --version`;
// `mcpRegistered` controls whether the agent already has the moderne MCP server, BEFORE any
// install step runs.
//
// Stateful by design: registration is tracked in a `registeredAgents` set, not a fixed flag, so
// this models what the real `mod` CLI does — `mod config agent-tools <agent> install` is what
// flips an agent from unregistered to registered, and the provisioner now re-probes after that
// call rather than trusting its exit code. `noOpInstall: true` simulates the live defect found on
// this machine: the install command exits 0 and prints its own "not detected" message, but never
// actually adds the agent to the registered set — exactly what happened with `mod config
// agent-tools codex install` when mod's detection didn't recognise this machine's Codex install.
function moderneExec({ moderneInstalled, mcpRegistered, hasBrew = true, calls = [], failAt = null, noOpInstall = false }) {
  const registeredAgents = new Set();
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (failAt && line.includes(failAt)) return { status: 1, stdout: '', stderr: 'boom' };
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: codexPluginListJson([{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }]), stderr: '' };
    }
    // `which mod` backs the direct-registration fallback below; mod's own registration writes an
    // absolute path, so the fallback resolves one rather than registering a bare `mod`.
    if (bin === 'which') return { status: 0, stdout: '/opt/homebrew/bin/mod\n', stderr: '' };
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    if (bin === 'mod' && args[0] === '--version') {
      return moderneInstalled ? { status: 0, stdout: 'mod 3.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'brew' && args[0] === '--version') {
      return hasBrew ? { status: 0, stdout: 'Homebrew 4.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'mod' && args[0] === 'config' && args[1] === 'agent-tools' && args[3] === 'install') {
      if (!noOpInstall) registeredAgents.add(args[2]);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'mcp' && args[1] === 'get') {
      const isRegistered = mcpRegistered || registeredAgents.has(bin);
      return isRegistered ? { status: 0, stdout: 'moderne\n  Scope: User config\n', stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
    }
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

test('moderne: cli present and mcp registered -> unchanged, no install calls', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'unchanged');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: cli absent -> brew install then per-agent agent-tools install, reports installed', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

test('moderne: cli present but mcp not registered -> only runs per-agent agent-tools install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(!calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

// The live defect this fix targets: `mod config agent-tools claude install` exited 0 (mod's own
// "MOD SUCCEEDED" behaviour even when it printed "<Agent> was not detected. Nothing to install.")
// but the agent's own binary still has no `moderne` MCP server registered afterwards. The exit
// code alone must not be trusted — the row must come from re-probing. Here the direct-registration
// fallback is also unable to register the server (this fake never flips state on `mcp add`), so
// the row stays `failed`, and the note has to say that BOTH routes were tried.
test('moderne: install step exits 0, and the direct fallback also fails -> failed, not installed', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: false, calls, noOpInstall: true });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'failed');
  assert.match(r.moderne.note, /mod config agent-tools claude install/);
  assert.match(r.moderne.note, /reported success/);
  assert.match(r.moderne.note, /did not register the server/);
  assert.match(r.moderne.note, /registering it directly also failed/);
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

// The other half of that fallback, and the row that was red on a real machine: mod exits 0 and
// registers nothing (its detection does not recognise this Codex install), but the server is an
// ordinary stdio MCP server, so registering it through the agent's own CLI closes the gap. The
// argv must be the agent's own `mcp add` form with an ABSOLUTE mod path — a bare `mod` breaks for
// any MCP client that does not inherit the user's interactive PATH.
test('moderne: mod no-ops but direct `mcp add` succeeds -> installed, with a note naming the fallback', async () => {
  const calls = [];
  const registered = new Set();
  const exec = (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return ok(pluginListJson([{ id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true }, { id: 'spring-tools@spring-tools-marketplace', enabled: true }]));
    }
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') return ok(codexPluginListJson([{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }]));
    if (bin === 'specify' && args[0] === '--version') return ok('specify 0.1.0');
    if (bin === 'mod' && args[0] === '--version') return ok('mod 4.6.3');
    if (bin === 'which') return ok('/opt/homebrew/bin/mod\n');
    // mod's silent no-op: exits 0, registers nothing.
    if (bin === 'mod' && args[0] === 'config') return ok();
    if (args[0] === 'mcp' && args[1] === 'add') { registered.add(bin); return ok(); }
    if (args[0] === 'mcp' && args[1] === 'get') {
      return registered.has(bin) ? ok('moderne\n  Scope: User config\n') : fail('not found');
    }
    throw new Error(`unexpected exec call: ${line}`);
  };

  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: codexOnly });
  const row = results.find((r) => r.item === 'moderne' && r.tool === 'codex');

  assert.strictEqual(row.status, 'installed');
  assert.match(row.note, /mod did not detect codex/);
  assert.match(row.note, /registered the MCP server directly/);
  assert.ok(calls.includes('codex mcp add moderne -- /opt/homebrew/bin/mod mcp'));
});

test('moderne: no homebrew -> skipped with actionable note, never runs brew install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, hasBrew: false, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /brew\.sh/);
  assert.ok(!calls.some((c) => c.includes('brew install')));
});

test('moderne: gemini is reported unsupported and never provisioned', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: allThree });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const gemini = moderneRows.find((r) => r.tool === 'gemini');
  assert.strictEqual(gemini.status, 'skipped');
  assert.match(gemini.note, /not supported/i);
  assert.deepStrictEqual(moderneRows.filter((r) => r.tool !== 'gemini').map((r) => r.status), ['unchanged', 'unchanged']);
  // An unsupported agent must never be probed via its own binary.
  assert.ok(!calls.some((c) => c.startsWith('gemini ')));
});

test('moderne: no adapters -> skipped, never execs mod or brew', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: [] });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /no supported agent/i);
  assert.ok(!calls.some((c) => c.startsWith('mod ') || c.startsWith('brew ')));
});

test('moderne: check mode reports missing and never installs', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: true, yes: false, prompt: async () => { throw new Error('must never prompt in check mode'); }, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'missing');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: declined prompt -> skipped with declined note', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: false, yes: false, prompt: async () => false, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.strictEqual(r.moderne.note, 'declined');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: failing install step -> failed with stderr in the note', async () => {
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, failAt: 'brew install' });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'failed');
  assert.strictEqual(r.moderne.note, 'boom');
});

// Mixed-state fake: by default claude already has the moderne MCP server registered, codex does
// not. This is exactly the scenario that exposed finding 1 live — a single combined `every(...)`
// check reported claude as `missing` too, purely because codex wasn't registered.
// `claudeRegistered`, `moderneInstalled` and `hasBrew` let individual tests move claude's
// registration state, CLI presence, and Homebrew presence off their defaults; `failAt` makes a
// specific command line fail (mirrors `moderneExec`'s `failAt`), for exercising per-agent install
// failure isolation.
//
// Stateful, like `moderneExec`: registration lives in a `registeredAgents` set seeded from
// `claudeRegistered` (codex always starts unregistered here), and a successful `mod config
// agent-tools <agent> install` call adds that agent to the set — unless the agent is listed in
// `noOpAgents`, which models the live defect: the install command exits 0 but mod's own
// detection silently fails to register the agent, so the set is never updated for it.
function moderneMixedExec({ calls = [], claudeRegistered = true, moderneInstalled = true, hasBrew = true, failAt = null, noOpAgents = [] } = {}) {
  const registeredAgents = new Set(claudeRegistered ? ['claude'] : []);
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (failAt && line.includes(failAt)) return { status: 1, stdout: '', stderr: 'boom' };
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: `${MATTPOCOCK_PLUGIN}@mattpocock`, enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'codex' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: codexPluginListJson([{ name: MATTPOCOCK_PLUGIN, marketplace: 'mattpocock' }]), stderr: '' };
    }
    // `which mod` backs the direct-registration fallback below; mod's own registration writes an
    // absolute path, so the fallback resolves one rather than registering a bare `mod`.
    if (bin === 'which') return { status: 0, stdout: '/opt/homebrew/bin/mod\n', stderr: '' };
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    if (bin === 'mod' && args[0] === '--version') {
      return moderneInstalled ? { status: 0, stdout: 'mod 4.6.3', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'brew' && args[0] === '--version') {
      return hasBrew ? { status: 0, stdout: 'Homebrew 4.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'mod' && args[0] === 'config' && args[1] === 'agent-tools' && args[3] === 'install') {
      if (!noOpAgents.includes(args[2])) registeredAgents.add(args[2]);
      return { status: 0, stdout: '', stderr: '' };
    }
    if ((bin === 'claude' || bin === 'codex') && args[0] === 'mcp' && args[1] === 'get') {
      return registeredAgents.has(bin) ? { status: 0, stdout: 'moderne\n  Scope: User config\n', stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
    }
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

test('moderne: mixed registration (claude registered, codex not) — check mode reports each agent separately', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls });
  const results = await runPlugins({
    exec, check: true, yes: false,
    prompt: async () => { throw new Error('must never prompt in check mode'); },
    adapters: claudeAndCodex,
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'claude').status, 'unchanged');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'codex').status, 'missing');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools')));
});

test('moderne: mixed registration (claude registered, codex not) — install mode only installs codex', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls });
  const results = await runPlugins({
    exec, check: false, yes: true, prompt: async () => true,
    adapters: claudeAndCodex,
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'claude').status, 'unchanged');
  assert.strictEqual(moderneRows.find((r) => r.tool === 'codex').status, 'installed');
  assert.ok(calls.includes('mod config agent-tools codex install'));
  assert.ok(!calls.includes('mod config agent-tools claude install'));
  assert.ok(!calls.some((c) => c.includes('brew install')));
  assert.ok(!calls.includes('mod config agent-tools install'));
});

// The exact regression the human escalated for finding 1's per-agent install semantics: a
// failing `mod config agent-tools claude install` must not be papered over as success for codex,
// nor must it stop the loop from attempting codex at all.
test('moderne: per-agent install failure is isolated — a failed claude install does not block codex', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls, claudeRegistered: false, failAt: 'agent-tools claude install' });
  const results = await runPlugins({
    exec, check: false, yes: true, prompt: async () => true,
    adapters: claudeAndCodex,
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const claude = moderneRows.find((r) => r.tool === 'claude');
  const codex = moderneRows.find((r) => r.tool === 'codex');
  assert.strictEqual(claude.status, 'failed');
  assert.strictEqual(claude.note, 'boom');
  assert.strictEqual(codex.status, 'installed');
  assert.ok(calls.includes('mod config agent-tools codex install'));
});

// Mixed version of the live defect: both agents need installing, claude's install genuinely
// registers the server, codex's install exits 0 but is a silent no-op (mod's detection gap). A
// no-op for one agent must not taint the other — claude must still be credited as `installed`,
// and codex's silent failure must not be reported as success just because the exit code was 0.
test('moderne: one agent registers, the other silently no-ops -> first installed, second failed, no cross-contamination', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls, claudeRegistered: false, noOpAgents: ['codex'] });
  const results = await runPlugins({
    exec, check: false, yes: true, prompt: async () => true,
    adapters: claudeAndCodex,
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const claude = moderneRows.find((r) => r.tool === 'claude');
  const codex = moderneRows.find((r) => r.tool === 'codex');
  assert.strictEqual(claude.status, 'installed');
  assert.strictEqual(codex.status, 'failed');
  assert.match(codex.note, /mod config agent-tools codex install/);
  assert.match(codex.note, /reported success/);
  assert.match(codex.note, /did not register the server/);
  assert.match(codex.note, /registering it directly also failed/);
  assert.ok(calls.includes('mod config agent-tools claude install'));
  assert.ok(calls.includes('mod config agent-tools codex install'));
});

// Exercises settleRemaining's already-registered branch: when the install flow stops partway
// (here: no Homebrew) because one agent still needs work, an agent that is already registered
// must still report `unchanged`, not be dragged into the not-done status of its sibling.
test('moderne: mixed registration, no homebrew — already-registered agent stays unchanged', async () => {
  const calls = [];
  const exec = moderneMixedExec({ calls, moderneInstalled: false, hasBrew: false });
  const results = await runPlugins({
    exec, check: false, yes: true, prompt: async () => true,
    adapters: claudeAndCodex,
  });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const claude = moderneRows.find((r) => r.tool === 'claude');
  const codex = moderneRows.find((r) => r.tool === 'codex');
  assert.strictEqual(claude.status, 'unchanged');
  assert.strictEqual(codex.status, 'skipped');
  assert.match(codex.note, /brew\.sh/);
});

// Regression guard for finding 2: the blanket `mod config agent-tools install` provisions all
// eight Moderne-supported agents and writes into the current working directory (it created
// `.github/instructions/moderne-*.instructions.md` and `.vscode/mcp.json` in a real repo when
// run for real). It must never be executed, in any scenario — matched as a line prefix (not exact
// equality) so a blanket call with extra arguments (e.g. `... install --all`) can't slip past.
test('moderne: blanket "mod config agent-tools install" is never executed', async () => {
  const scenarios = [
    { moderneInstalled: false, mcpRegistered: false },
    { moderneInstalled: true, mcpRegistered: false },
    { moderneInstalled: true, mcpRegistered: true },
  ];
  for (const scenario of scenarios) {
    const calls = [];
    const exec = moderneExec({ ...scenario, calls });
    await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
    assert.ok(
      !calls.some((c) => /^mod config agent-tools install\b/.test(c)),
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

// Guards the note text, not just the boolean. The note previously asserted that "OpenRewrite
// recipes resolve from the Code Genome Project and need a token" — a claim this project
// retracted: recipes resolve from Maven Central with no credential. That regression survived
// because the test above only ever asserted `.configured`.
test('moderneAuthStatus: unconfigured note must not claim a credential is required', () => {
  const { note } = moderneAuthStatus(() => ({ status: 1, stdout: '', stderr: 'not configured' }));
  assert.match(note, /no Moderne tenant configured/i);
  assert.match(note, /Maven Central/);
  assert.match(note, /spring-boot-upgrade/);
  assert.doesNotMatch(note, /need a token/i);
  assert.doesNotMatch(note, /recipes resolve from the Code Genome Project/i);
});

test('moderneAuthRow: unconfigured tenant is optional (never missing, so doctor still exits 0)', () => {
  const unconfigured = moderneAuthRow(() => ({ status: 1, stdout: '', stderr: 'not configured' }));
  assert.strictEqual(unconfigured.item, 'moderne auth');
  assert.strictEqual(unconfigured.status, 'optional');
  assert.notStrictEqual(unconfigured.status, 'missing');
  assert.strictEqual(exitCode([unconfigured], { strictMissing: true }), 0);

  const configured = moderneAuthRow(() => ({ status: 0, stdout: 'https://app.moderne.io\n', stderr: '' }));
  assert.strictEqual(configured.status, 'unchanged');
  assert.strictEqual(configured.note, undefined);
});

// Finding 3: `mod` gone but a stale MCP registration left behind. The registration's command is
// `/opt/homebrew/bin/mod mcp`, so both agents fail to start the server — doctor used to report
// this as a clean `unchanged` because the check path never consulted `cliPresent`.
test('moderne: check mode with mod absent but registration present must not report unchanged', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: true, calls });
  const results = await runPlugins({ exec, check: true, yes: false, prompt: async () => { throw new Error('must never prompt in check mode'); }, adapters: claudeAndCodex });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.deepStrictEqual(moderneRows.map((r) => r.tool), ['claude', 'codex']);
  for (const row of moderneRows) {
    assert.strictEqual(row.status, 'missing', `${row.tool} must not be reported unchanged when mod is absent`);
    assert.match(row.note, /mod not on PATH/);
    assert.match(row.note, /cannot start/);
  }
  assert.strictEqual(exitCode(moderneRows, { strictMissing: true }), 1);
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: check mode with mod present and registration present stays unchanged and un-noted', async () => {
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true });
  const results = await runPlugins({ exec, check: true, yes: false, prompt: async () => { throw new Error('no prompt'); }, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'unchanged');
  assert.strictEqual(r.moderne.note, undefined);
});

// M9: a gemini-only run already explains itself via the `gemini / skipped / not supported` row;
// the placeholder `-` row on top of it was redundant noise.
test('moderne: gemini-only run emits exactly one row, the explanatory one', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: false, calls });
  const results = await runPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: geminiOnly, calls });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  assert.strictEqual(moderneRows.length, 1);
  assert.strictEqual(moderneRows[0].tool, 'gemini');
  assert.strictEqual(moderneRows[0].status, 'skipped');
  assert.match(moderneRows[0].note, /not supported by mod config agent-tools/);
  assert.ok(!moderneRows.some((r) => r.tool === '-'));
  assert.ok(!calls.some((c) => c.startsWith('mod ') || c.startsWith('brew ')));
});
