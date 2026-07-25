'use strict';
function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { attrs: {}, body: md };
  const attrs = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) attrs[kv[1]] = kv[2].trim();
  }
  return { attrs, body: md.slice(m[0].length) };
}
module.exports = { parseFrontmatter };
