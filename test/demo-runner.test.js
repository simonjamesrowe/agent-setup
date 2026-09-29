const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, '..', 'components', 'skills', 'demo-record', 'scripts', 'demo.mjs');

function demoDir(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  fs.writeFileSync(path.join(dir, 'script.mjs'), script);
  return dir;
}

function runner(...args) {
  // Point the env loader at nothing so a developer's real credentials are never read.
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DEMO_ENV_FILE: path.join(os.tmpdir(), 'no-such-env-file') },
  });
}

const VALID = `export default {
  title: 'Widget',
  url: 'https://example.com',
  scenes: [
    { id: 'intro', show: 'Landing page', say: 'Widgets, but faster.' },
    { id: 'click', show: 'Cursor opens a widget', order: 'do-then-say', do: async () => {} },
  ],
  outro: 'That was the widget. It saves an hour a day.',
};
`;

test('plan renders the approval table and writes plan.md', () => {
  const dir = demoDir(VALID);
  const res = runner('plan', dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /\| 1 \| `intro` \| Landing page \| Widgets, but faster\. \|/);
  assert.match(res.stdout, /\| 2 \| `click` \| Cursor opens a widget \| _\(silent\)_ \|/);
  assert.match(res.stdout, /\| 3 \| `outro` \|/);
  assert.ok(fs.existsSync(path.join(dir, 'plan.md')));
});

test('plan marks unrehearsed actions and adds measured time for do-then-say', () => {
  const dir = demoDir(VALID);
  assert.match(runner('plan', dir).stdout, /\| `click` \| .* \| ~1s\+ \|/);
  // What rehearse writes: measured action seconds, keyed to the action's source.
  const key = crypto.createHash('sha256').update('async () => {}').digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(dir, '.build'));
  fs.writeFileSync(path.join(dir, '.build', 'action-times.json'), JSON.stringify({ click: { action: 5, key } }));
  const res = runner('plan', dir);
  assert.match(res.stdout, /\| `click` \| .* \| ~6s \|/);
  assert.match(res.stdout, /action times from the last rehearsal/);
});

test('outro must be exactly two sentences', () => {
  const dir = demoDir(VALID.replace("'That was the widget. It saves an hour a day.'", "'Just one sentence.'"));
  const res = runner('plan', dir);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /outro must be exactly two sentences \(found 1\)/);
});

test('every invalid scene field is reported together', () => {
  const dir = demoDir(`export default {
    title: 'Widget', url: 'https://example.com',
    scenes: [
      { id: 'Bad Id', show: 'x' },
      { id: 'outro', show: 'x' },
      { id: 'no-show', order: 'sideways' },
    ],
    outro: 'One. Two.',
  };
  `);
  const res = runner('plan', dir);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /scenes\[0\]: id must be lower-kebab-case/);
  assert.match(res.stderr, /scenes\[1\]: duplicate or reserved id 'outro'/);
  assert.match(res.stderr, /scenes\[2\] \(no-show\): 'show'/);
  assert.match(res.stderr, /scenes\[2\] \(no-show\): unknown order 'sideways'/);
});

test('init refuses to overwrite an existing script', () => {
  const dir = demoDir(VALID);
  const res = runner('init', dir);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /already exists — not overwriting/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'script.mjs'), 'utf8'), VALID);
});
