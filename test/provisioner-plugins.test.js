const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { provisionPlugins } = require('../lib/provisioners/plugins.js');

function makeHomeWithUiMarker() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-plugins-'));
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'ui-foo'), { recursive: true });
  return home;
}

function makeHomeWithoutUiMarker() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-plugins-'));
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  return home;
}

function byItem(results) {
  return Object.fromEntries(results.map((r) => [r.item, r]));
}

test('all present and enabled -> unchanged (ui.sh unchanged when marker dir exists)', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: 'superpowers@claude-plugins-official  v1.0.0  enabled\nspring-tools@spring-tools-marketplace  v2.3.0  enabled\n',
        stderr: '',
      };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const promptCalls = [];
  const prompt = async (q, def) => { promptCalls.push(q); return def; };
  const home = makeHomeWithUiMarker();

  const results = await provisionPlugins({ exec, check: false, yes: false, prompt, home });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'unchanged');
  assert.strictEqual(r.speckit.status, 'unchanged');
  assert.strictEqual(r['ui.sh'].status, 'unchanged');
  assert.strictEqual(r['spring-tools'].status, 'unchanged');
  assert.strictEqual(promptCalls.length, 0, 'must not prompt when nothing needs installing');
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add')));
});

test('superpowers installed but disabled -> enables using marketplace parsed from list, returns updated', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: 'superpowers@claude-plugins-official  v1.0.0  disabled\n', stderr: '' };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const prompt = async () => { throw new Error('prompt should be bypassed by yes:true'); };
  const home = makeHomeWithUiMarker();

  const results = await provisionPlugins({ exec, check: false, yes: true, prompt, home });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'updated');
  assert.ok(calls.includes('claude plugin install superpowers@claude-plugins-official'));
  assert.ok(calls.includes('claude plugin enable superpowers@claude-plugins-official'));
});

test('check mode with nothing present -> missing/skipped, zero install calls', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return { status: 0, stdout: 'some-other-plugin@some-marketplace  v1.0.0  enabled\n', stderr: '' };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 1, stdout: '', stderr: 'command not found' };
    throw new Error(`unexpected exec call in check mode: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => { throw new Error('must never prompt in check mode'); };
  const home = makeHomeWithoutUiMarker();

  const results = await provisionPlugins({ exec, check: true, yes: false, prompt, home });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'missing');
  assert.strictEqual(r.speckit.status, 'missing');
  assert.strictEqual(r['spring-tools'].status, 'missing');
  assert.strictEqual(r['ui.sh'].status, 'skipped');
  assert.match(r['ui.sh'].note, /ui\.sh/);
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add') || c.includes('uv ')));
});

test('declined install prompt -> skipped with declined note, no install calls', async () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') return { status: 0, stdout: '', stderr: '' };
    if (bin === 'specify' && args[0] === '--version') return { status: 1, stdout: '', stderr: '' };
    throw new Error(`unexpected exec call: ${[bin, ...args].join(' ')}`);
  };
  const prompt = async () => false;
  const home = makeHomeWithoutUiMarker();

  const results = await provisionPlugins({ exec, check: false, yes: false, prompt, home });
  const r = byItem(results);

  assert.strictEqual(r.superpowers.status, 'skipped');
  assert.strictEqual(r.superpowers.note, 'declined');
  assert.strictEqual(r.speckit.status, 'skipped');
  assert.strictEqual(r.speckit.note, 'declined');
  assert.strictEqual(r['spring-tools'].status, 'skipped');
  assert.strictEqual(r['spring-tools'].note, 'declined');
  assert.ok(!calls.some((c) => c.includes('plugin install') || c.includes('plugin enable') || c.includes('marketplace add') || c.includes('uv ')));
});
