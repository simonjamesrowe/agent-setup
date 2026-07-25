'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('install --target writes skills and instructions for all tools; doctor then passes; doctor detects clobber', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const bin = path.join(__dirname, '..', 'bin', 'agent-setup.js');
  const skillCount = fs.readdirSync(path.join(__dirname, '..', 'components', 'skills')).length;

  execFileSync(process.execPath, [bin, 'install', '--yes', '--target', home, '--tools', 'claude,gemini,codex', '--skip', 'mcp,plugins'], { encoding: 'utf8' });
  for (const dir of ['.claude/skills', '.gemini/skills', '.codex/skills']) {
    assert.strictEqual(fs.readdirSync(path.join(home, dir)).length, skillCount, dir);
  }
  for (const f of ['.claude/CLAUDE.md', '.gemini/GEMINI.md', '.codex/AGENTS.md']) {
    assert.match(fs.readFileSync(path.join(home, f), 'utf8'), /AGENT-SETUP:SIMONJAMESROWE START/);
  }

  execFileSync(process.execPath, [bin, 'doctor', '--target', home, '--tools', 'claude,gemini,codex', '--skip', 'mcp,plugins'], { encoding: 'utf8' });

  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# clobbered by work installer\n');
  assert.throws(() =>
    execFileSync(process.execPath, [bin, 'doctor', '--target', home, '--tools', 'claude,gemini,codex', '--skip', 'mcp,plugins'], { encoding: 'utf8' })
  );
});
