const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { provisionInstructions } = require('../lib/provisioners/instructions.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const { hasMarkerBlock } = require('../lib/markers.js');

const componentsDir = path.join(__dirname, '..', 'components');

test('creates instruction files with block; preserves pre-existing work content; idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const claudeMd = path.join(home, '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
  fs.writeFileSync(claudeMd, '# Work-managed config\n');

  const r1 = provisionInstructions({ home, adapters: ADAPTERS, componentsDir, check: false });
  assert.ok(r1.every((r) => r.status === 'installed'));
  const merged = fs.readFileSync(claudeMd, 'utf8');
  assert.ok(merged.startsWith('# Work-managed config\n'));
  assert.ok(hasMarkerBlock(merged));
  assert.ok(hasMarkerBlock(fs.readFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'utf8')));
  assert.ok(hasMarkerBlock(fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8')));

  const r2 = provisionInstructions({ home, adapters: ADAPTERS, componentsDir, check: false });
  assert.ok(r2.every((r) => r.status === 'unchanged'));

  fs.writeFileSync(claudeMd, '# Work config rewrote this\n'); // simulate work-installer clobber
  const check = provisionInstructions({ home, adapters: ADAPTERS, componentsDir, check: true });
  assert.strictEqual(check.find((r) => r.tool === 'claude').status, 'missing');
  assert.strictEqual(check.find((r) => r.tool === 'gemini').status, 'unchanged');
});
