const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'components', 'skills', 'demo-record', 'scripts');
const RUNNER = path.join(SCRIPTS, 'demo.mjs');
const load = (name) => import(path.join(SCRIPTS, name));

function demoDir(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-native-'));
  fs.writeFileSync(path.join(dir, 'script.mjs'), script);
  return dir;
}

function runner(...args) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DEMO_ENV_FILE: path.join(os.tmpdir(), 'no-such-env-file') },
  });
}

const frame = (name, t) => ({ file: `${name}.jpg`, t });

test('mergeSurfaces cuts between the two streams at each switch', async () => {
  const { mergeSurfaces } = await load('surfaces.mjs');
  const browser = [frame('b0', 0), frame('b1', 4), frame('b2', 8)];
  const app = [frame('a0', 1), frame('a1', 2), frame('a2', 6), frame('a3', 9)];
  const switches = [{ t: -Infinity, surface: 'app' }, { t: 5, surface: 'browser' }, { t: 7, surface: 'app' }];
  const { frames, gaps } = mergeSurfaces({ browser, app }, switches, 10);
  assert.deepStrictEqual(frames.map((f) => [f.file, f.t]), [
    ['a0.jpg', 1], ['a1.jpg', 2],
    // At the cut to the browser, its last frame painted (b1 at 4s) is restamped to the switch.
    ['b1.jpg', 5],
    // Back to the app: a2 (6s) was painted while the browser was showing, so it holds from 7s.
    ['a2.jpg', 7], ['a3.jpg', 9],
  ]);
  assert.deepStrictEqual(gaps, []);
});

test('mergeSurfaces keeps the opening frame unclamped so the mixer can find t0', async () => {
  const { mergeSurfaces } = await load('surfaces.mjs');
  const { frames } = mergeSurfaces({ app: [frame('a0', 1), frame('a1', 3)] }, [{ t: -Infinity, surface: 'app' }], 10);
  assert.deepStrictEqual(frames.map((f) => f.t), [1, 3]);
});

test('mergeSurfaces reports a segment with no frames instead of inventing one', async () => {
  const { mergeSurfaces } = await load('surfaces.mjs');
  const { frames, gaps } = mergeSurfaces(
    { browser: [frame('b0', 0)], app: [frame('a0', 8)] },
    [{ t: -Infinity, surface: 'browser' }, { t: 2, surface: 'app' }, { t: 5, surface: 'browser' }],
    10,
  );
  assert.deepStrictEqual(frames.map((f) => f.file), ['b0.jpg', 'b0.jpg']);
  assert.deepStrictEqual(gaps, [{ surface: 'app', from: 2, to: 5 }]);
});

test('mergeSurfaces skips a zero-length segment from two switches at once', async () => {
  const { mergeSurfaces } = await load('surfaces.mjs');
  const { frames } = mergeSurfaces(
    { browser: [frame('b0', 0)], app: [frame('a0', 0)] },
    [{ t: -Infinity, surface: 'browser' }, { t: 3, surface: 'app' }, { t: 3, surface: 'browser' }],
    6,
  );
  assert.deepStrictEqual(frames.map((f) => f.file), ['b0.jpg', 'b0.jpg']);
});

test('toQuery maps Playwright roles and carries regex names', async () => {
  const { toQuery } = await load('native.mjs');
  assert.deepStrictEqual(toQuery({ role: 'textbox', name: 'Source text' }), { roles: ['AXTextField', 'AXTextArea'], name: 'Source text' });
  assert.deepStrictEqual(toQuery({ role: 'button', name: /^Save/i, index: 1 }), { roles: ['AXButton'], index: 1, pattern: { source: '^Save', flags: 'i' } });
  assert.deepStrictEqual(toQuery({ role: 'AXSheet' }), { roles: ['AXSheet'] });
  assert.deepStrictEqual(toQuery({ id: 'review-panel' }), { id: 'review-panel', roles: [] });
  assert.throws(() => toQuery({ role: 'widget' }), /unknown role 'widget'/);
  assert.throws(() => toQuery('button'), /must be an object/);
});

const NATIVE = `export default {
  title: 'Veil', url: 'native', link: 'example.com',
  native: { app: 'Example' },
  scenes: [{ id: 'one', show: 'The app', say: 'Hello.', do: async ({ app }) => { await app.show(); } }],
  outro: 'That was it. It matters.',
};
`;

test('a native demo plans without starting the app', () => {
  const res = runner('plan', demoDir(NATIVE));
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /\| 1 \| `one` \| The app \| Hello\. \|/);
});

test('native script problems are reported together', () => {
  const dir = demoDir(`export default {
    title: 'Veil', url: 'native', native: {},
    scenes: [{ id: 'one', show: 'x' }],
    outro: 'One. Two.',
  };
  `);
  const res = runner('plan', dir);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /native needs an app/);
  assert.match(res.stderr, /url 'native' has no host for the end card, so set link/);
});

test("url 'native' without a native block is refused", () => {
  const res = runner('plan', demoDir(NATIVE.replace("native: { app: 'Example' },", '')));
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /url 'native' needs a native: \{ app \} block/);
});

test('a wrong native aspect ratio is reported with the other script problems', () => {
  const script = NATIVE.replace("{ app: 'Example' }", "{ app: 'Example', window: { width: 1200, height: 900 } }")
    .replace("'That was it. It matters.'", "'Only one sentence.'");
  const res = runner('plan', demoDir(script));
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /native\.window 1200x900 does not have the viewport's 1920x1080 aspect ratio/);
  assert.match(res.stderr, /outro must be exactly two sentences/);
});

test('sounds are validated with the other script problems', () => {
  const res = runner('plan', demoDir(NATIVE.replace("native: { app: 'Example' },", "native: { app: 'Example' }, sounds: { 'Bad Name': { say: 'x' }, empty: {} },")));
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /sounds\.Bad Name: name must be lower-kebab-case/);
  assert.match(res.stderr, /sounds\.empty: 'say' \(the words to voice\) is required/);
});

test('a script with sounds still plans', () => {
  const res = runner('plan', demoDir(NATIVE.replace("native: { app: 'Example' },", "native: { app: 'Example' }, sounds: { note: { say: 'Hello there.' } },")));
  assert.strictEqual(res.status, 0, res.stderr);
});

test('smooth keeps the stroke ends and adds points between them', async () => {
  const { smooth } = await load('native.mjs');
  const points = [[0, 0], [0.5, 1], [1, 0]];
  const out = smooth(points, 4);
  assert.deepStrictEqual(out[0], [0, 0]);
  assert.deepStrictEqual(out[out.length - 1], [1, 0]);
  assert.strictEqual(out.length, 9);
  assert.ok(out.every(([x, y]) => x >= 0 && x <= 1 && y >= -0.2 && y <= 1.2));
  assert.deepStrictEqual(smooth([[0, 0], [1, 1]]), [[0, 0], [1, 1]]);
});
