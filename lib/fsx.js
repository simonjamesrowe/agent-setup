'use strict';
const fs = require('node:fs');
const path = require('node:path');

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

function dirsEqual(a, b) {
  const fa = listFiles(a); const fb = listFiles(b);
  if (fa.length !== fb.length || fa.some((f, i) => f !== fb[i])) return false;
  return fa.every((f) => fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
}

function copyDirAtomic(src, dest) {
  const exists = fs.existsSync(dest);
  if (exists && dirsEqual(src, dest)) return 'unchanged';
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.cpSync(src, tmp, { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return exists ? 'updated' : 'new';
}

module.exports = { copyDirAtomic, dirsEqual, listFiles };
