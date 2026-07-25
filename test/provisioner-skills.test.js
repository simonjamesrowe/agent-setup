const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { provisionSkills } = require('../lib/provisioners/skills.js');
const { ADAPTERS } = require('../lib/adapters/index.js');

test('installs every component skill to every tool dir; check mode reports without writing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const componentsDir = path.join(__dirname, '..', 'components');
  const skillNames = fs.readdirSync(path.join(componentsDir, 'skills'));

  const checkFirst = provisionSkills({ home, adapters: ADAPTERS, componentsDir, check: true });
  assert.ok(checkFirst.every((r) => r.status === 'missing'));
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills')));

  const results = provisionSkills({ home, adapters: ADAPTERS, componentsDir, check: false });
  assert.strictEqual(results.length, skillNames.length * ADAPTERS.length);
  assert.ok(results.every((r) => r.status === 'installed'));
  for (const a of ADAPTERS) {
    for (const s of skillNames) {
      assert.ok(fs.existsSync(path.join(a.skillsDir(home), s, 'SKILL.md')), `${a.key}/${s}`);
    }
  }

  const again = provisionSkills({ home, adapters: ADAPTERS, componentsDir, check: false });
  assert.ok(again.every((r) => r.status === 'unchanged'));
});
