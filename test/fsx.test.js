const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyDirAtomic } = require('../lib/fsx.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fsx-')); }

test('copy into new dest returns new; identical re-copy returns unchanged; edit returns updated', () => {
  const src = tmp(); const destRoot = tmp();
  fs.mkdirSync(path.join(src, 'references'), { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'v1');
  fs.writeFileSync(path.join(src, 'references', 'api.md'), 'api');
  const dest = path.join(destRoot, 'my-skill');
  assert.strictEqual(copyDirAtomic(src, dest), 'new');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'references', 'api.md'), 'utf8'), 'api');
  assert.strictEqual(copyDirAtomic(src, dest), 'unchanged');
  fs.writeFileSync(path.join(src, 'SKILL.md'), 'v2');
  assert.strictEqual(copyDirAtomic(src, dest), 'updated');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'v2');
  // stale file in dest is removed by the swap
  fs.writeFileSync(path.join(dest, 'stale.md'), 'x');
  assert.strictEqual(copyDirAtomic(src, dest), 'updated');
  assert.ok(!fs.existsSync(path.join(dest, 'stale.md')));
});
