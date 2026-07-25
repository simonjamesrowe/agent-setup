const { test } = require('node:test');
const assert = require('node:assert');
const { mergeMarkerBlock, hasMarkerBlock, START, END } = require('../lib/markers.js');

test('creates block in empty/missing file', () => {
  const out = mergeMarkerBlock(null, 'personal rules');
  assert.strictEqual(out, `${START}\npersonal rules\n${END}\n`);
  assert.ok(hasMarkerBlock(out));
});

test('appends below existing content, preserving it byte-for-byte', () => {
  const existing = '# Work config\n\nJira rules here.\n';
  const out = mergeMarkerBlock(existing, 'personal rules');
  assert.ok(out.startsWith('# Work config\n\nJira rules here.\n\n'));
  assert.ok(out.endsWith(`${START}\npersonal rules\n${END}\n`));
});

test('replaces existing block in place, idempotent', () => {
  const v1 = mergeMarkerBlock('# Work\n', 'old body');
  const v2 = mergeMarkerBlock(v1, 'new body');
  assert.ok(v2.includes('new body'));
  assert.ok(!v2.includes('old body'));
  assert.strictEqual(mergeMarkerBlock(v2, 'new body'), v2); // second run byte-identical
});

test('preserves content AFTER the block too', () => {
  const withTail = mergeMarkerBlock('# Work\n', 'body') + '\n# User added this after\n';
  const out = mergeMarkerBlock(withTail, 'body2');
  assert.ok(out.includes('# User added this after'));
  assert.ok(out.indexOf(END) < out.indexOf('# User added this after'));
});
