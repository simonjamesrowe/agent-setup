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

test('--target alone (no --skip) force-skips mcp and plugins: no real-CLI mutation, no mcp/plugins results', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-target-only-'));
  const bin = path.join(__dirname, '..', 'bin', 'agent-setup.js');
  const skillCount = fs.readdirSync(path.join(__dirname, '..', 'components', 'skills')).length;

  // Deliberately no --skip: --target alone must be enough to keep the mcp and
  // plugins provisioners (which exec real `claude`/`gemini`/`codex`/`uv` CLIs
  // that mutate REAL user config, not the --target dir) from running at all.
  const out = execFileSync(
    process.execPath,
    [bin, 'install', '--yes', '--target', home, '--tools', 'claude,gemini,codex'],
    { encoding: 'utf8' }
  );

  assert.match(out, /--target set: skipping mcp and plugins/);
  // None of the mcp-server or plugin item names appear anywhere in the report.
  for (const name of ['playwright', 'excalidraw', 'superpowers', 'speckit', 'spring-tools', 'ui.sh']) {
    assert.ok(!out.includes(name), `did not expect "${name}" in output:\n${out}`);
  }

  // Skills/instructions still ran and wrote only inside the target.
  for (const dir of ['.claude/skills', '.gemini/skills', '.codex/skills']) {
    assert.strictEqual(fs.readdirSync(path.join(home, dir)).length, skillCount, dir);
  }
});
