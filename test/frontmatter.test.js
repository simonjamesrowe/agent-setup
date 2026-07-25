const { test } = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter } = require('../lib/frontmatter.js');

test('parses name and description', () => {
  const md = '---\nname: prod-deploy\ndescription: Deploy simonrowe.dev. Use when deploying.\n---\n# Body\n';
  const { attrs, body } = parseFrontmatter(md);
  assert.strictEqual(attrs.name, 'prod-deploy');
  assert.match(attrs.description, /Use when/);
  assert.strictEqual(body, '# Body\n');
});

test('no frontmatter returns empty attrs and full body', () => {
  const { attrs, body } = parseFrontmatter('# Just markdown\n');
  assert.deepStrictEqual(attrs, {});
  assert.strictEqual(body, '# Just markdown\n');
});
