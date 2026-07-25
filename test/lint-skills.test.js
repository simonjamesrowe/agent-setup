const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { lintSkills } = require('../scripts/lint-skills.js');

test('valid skills pass', () => {
  assert.deepStrictEqual(lintSkills(path.join(__dirname, 'fixtures', 'skills-valid')), []);
});

test('invalid skill reports name mismatch and missing trigger', () => {
  const errors = lintSkills(path.join(__dirname, 'fixtures', 'skills-invalid'));
  assert.strictEqual(errors.length, 2);
  assert.ok(errors.some((e) => e.includes("name 'wrong-name'") && e.includes('bad-skill')));
  assert.ok(errors.some((e) => e.includes('Use when')));
});
