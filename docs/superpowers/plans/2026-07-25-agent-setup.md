# agent-setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@simonjamesrowe/agent-setup` — a public npm package whose single `npx` command installs 11 operational skills, a personal instruction block, MCP servers, and plugins across Claude Code, Gemini CLI, and Codex.

**Architecture:** Zero-dependency Node CLI (`bin/agent-setup.js`) dispatching to four provisioners (skills, instructions, mcp, plugins) that fan out through three per-tool adapters. All content lives in `components/` as markdown; utilities (marker merge, atomic dir copy, frontmatter parse) are pure functions tested with `node:test`.

**Tech Stack:** Node ≥20 (built-ins only: `fs`, `path`, `os`, `child_process`, `node:test`), GitHub Actions, npmjs.com publishing.

**Spec:** `docs/superpowers/specs/2026-07-25-agent-setup-design.md` (approved).

## Global Constraints

- Package name `@simonjamesrowe/agent-setup`, public npmjs.com, MIT license, `engines.node >= 20`.
- **Zero runtime dependencies and zero devDependencies.** Tests use `node:test` via `node --test`.
- Plain JavaScript (CommonJS). No TypeScript, no build step.
- Marker strings, exactly: `<!-- AGENT-SETUP:SIMONJAMESROWE START -->` and `<!-- AGENT-SETUP:SIMONJAMESROWE END -->`.
- Skill frontmatter: `name` and `description` keys ONLY. `name` must equal the skill's directory name. `description` must contain the phrase `Use when`.
- Skills are agent-agnostic: no `allowed-tools`, no Claude-only tool names stated as requirements (phrase as "with browser automation (Playwright MCP in Claude Code)…").
- Secrets never appear in any file: reference env var names only (source of truth `~/workspace/simonjamesrowe/env`).
- Commits: conventional commits, no Jira refs, no AI attribution lines.
- Tool destinations: Claude `~/.claude/{skills,CLAUDE.md}`, Gemini `~/.gemini/{skills,GEMINI.md}`, Codex `~/.codex/{skills,AGENTS.md}`. All code takes `home` as a parameter (never hardcode `os.homedir()` except at the CLI entry) so tests can redirect it.
- The monorepo referenced throughout: `~/workspace/simonjamesrowe/simonrowe-dev-monorepo`. Implementers should verify quoted paths/commands against it when authoring skills.

---

### Task 1: Package scaffold and CLI entry

**Files:**
- Create: `package.json`, `LICENSE`, `.gitignore`, `README.md`, `bin/agent-setup.js`, `test/cli.test.js`

**Interfaces:**
- Produces: `bin/agent-setup.js` executable; `parseArgs(argv)` exported from `bin/agent-setup.js` returning `{ command: 'install'|'doctor'|'help', yes: boolean, tools: string[]|null, skip: string[], target: string|null }`.

- [ ] **Step 1: Write package.json, LICENSE, .gitignore, README stub**

`package.json`:

```json
{
  "name": "@simonjamesrowe/agent-setup",
  "version": "0.1.0",
  "description": "AI agent setup for the simonjamesrowe org: skills, instructions, MCP servers and plugins for Claude Code, Gemini CLI and Codex",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/simonjamesrowe/agent-setup.git" },
  "engines": { "node": ">=20" },
  "bin": { "agent-setup": "bin/agent-setup.js" },
  "files": ["bin/", "lib/", "components/", "scripts/"],
  "scripts": {
    "test": "node --test test/",
    "lint:skills": "node scripts/lint-skills.js"
  },
  "publishConfig": { "access": "public" }
}
```

`.gitignore`: `node_modules/`, `*.tgz`. `LICENSE`: MIT, copyright 2026 Simon Rowe. `README.md`: title + one-paragraph description + `npx @simonjamesrowe/agent-setup` usage line (full README comes in Task 15).

- [ ] **Step 2: Write the failing test**

`test/cli.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('../bin/agent-setup.js');

test('parseArgs defaults to install', () => {
  assert.deepStrictEqual(parseArgs([]), { command: 'install', yes: false, tools: null, skip: [], target: null });
});

test('parseArgs reads flags', () => {
  const a = parseArgs(['doctor', '--yes', '--tools', 'claude,gemini', '--skip', 'mcp,plugins', '--target', '/tmp/x']);
  assert.strictEqual(a.command, 'doctor');
  assert.strictEqual(a.yes, true);
  assert.deepStrictEqual(a.tools, ['claude', 'gemini']);
  assert.deepStrictEqual(a.skip, ['mcp', 'plugins']);
  assert.strictEqual(a.target, '/tmp/x');
});

test('help prints usage and exits 0', () => {
  const out = execFileSync(process.execPath, ['bin/agent-setup.js', 'help'], { encoding: 'utf8' });
  assert.match(out, /agent-setup/);
  assert.match(out, /install/);
  assert.match(out, /doctor/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (`bin/agent-setup.js` missing).

- [ ] **Step 4: Implement bin/agent-setup.js**

```js
#!/usr/bin/env node
'use strict';

const USAGE = `agent-setup — AI agent setup for the simonjamesrowe org

Usage: npx @simonjamesrowe/agent-setup [command] [flags]

Commands:
  install   (default) install skills, instructions, MCP servers, plugins
  doctor    check-only: report state of everything install manages
  help      show this message

Flags:
  --yes                 no prompts, accept defaults
  --tools <a,b>         limit to claude,gemini,codex (default: auto-detect)
  --skip <a,b>          skip provisioners: skills,instructions,mcp,plugins
  --target <dir>        override home directory (testing/CI)
`;

function parseArgs(argv) {
  const args = { command: 'install', yes: false, tools: null, skip: [], target: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === 'install' || a === 'doctor' || a === 'help') args.command = a;
    else if (a === '--yes') args.yes = true;
    else if (a === '--tools') args.tools = (rest.shift() || '').split(',').filter(Boolean);
    else if (a === '--skip') args.skip = (rest.shift() || '').split(',').filter(Boolean);
    else if (a === '--target') args.target = rest.shift() || null;
    else if (a === '--help' || a === '-h') args.command = 'help';
    else { console.error(`Unknown argument: ${a}\n${USAGE}`); process.exit(2); }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') { console.log(USAGE); return; }
  // Wired up in Task 10:
  const { run } = require('../lib/run.js');
  process.exitCode = await run(args);
}

module.exports = { parseArgs, USAGE };
if (require.main === module) main();
```

Note: until Task 10, `lib/run.js` doesn't exist — that's fine; the tests above only exercise `parseArgs` and `help`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 tests). Also run `chmod +x bin/agent-setup.js`.

- [ ] **Step 6: Commit**

```bash
git add package.json LICENSE .gitignore README.md bin/ test/
git commit -m "feat: package scaffold and CLI argument parsing"
```

---

### Task 2: Marker-block merge (`lib/markers.js`)

**Files:**
- Create: `lib/markers.js`, `test/markers.test.js`

**Interfaces:**
- Produces: `mergeMarkerBlock(existing: string|null, blockBody: string): string`; `hasMarkerBlock(content: string): boolean`; exported consts `START`, `END`.
- Consumed by: Task 7 (instructions provisioner), Task 10 (doctor).

- [ ] **Step 1: Write the failing tests**

`test/markers.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement lib/markers.js**

```js
'use strict';
const START = '<!-- AGENT-SETUP:SIMONJAMESROWE START -->';
const END = '<!-- AGENT-SETUP:SIMONJAMESROWE END -->';
const BLOCK_RE = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\n?`);

function renderBlock(blockBody) {
  return `${START}\n${blockBody.trim()}\n${END}\n`;
}

function mergeMarkerBlock(existing, blockBody) {
  const block = renderBlock(blockBody);
  if (existing == null || existing.trim() === '') return block;
  if (BLOCK_RE.test(existing)) return existing.replace(BLOCK_RE, block);
  return existing.replace(/\s*$/, '\n\n') + block;
}

function hasMarkerBlock(content) {
  return typeof content === 'string' && content.includes(START) && content.includes(END);
}

module.exports = { mergeMarkerBlock, hasMarkerBlock, START, END };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/markers.js test/markers.test.js
git commit -m "feat: marker-block merge for instruction files"
```

---

### Task 3: Frontmatter parse and atomic dir copy (`lib/frontmatter.js`, `lib/fsx.js`)

**Files:**
- Create: `lib/frontmatter.js`, `lib/fsx.js`, `test/frontmatter.test.js`, `test/fsx.test.js`

**Interfaces:**
- Produces: `parseFrontmatter(md: string): { attrs: Record<string,string>, body: string }`; `copyDirAtomic(src: string, dest: string): 'new'|'updated'|'unchanged'`.
- Consumed by: Task 4 (lint), Task 6 (skills provisioner).

- [ ] **Step 1: Write the failing tests**

`test/frontmatter.test.js`:

```js
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
```

`test/fsx.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/frontmatter.js`:

```js
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
```

`lib/fsx.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/frontmatter.js lib/fsx.js test/frontmatter.test.js test/fsx.test.js
git commit -m "feat: frontmatter parser and atomic directory copy"
```

---

### Task 4: Skill lint (`scripts/lint-skills.js`)

**Files:**
- Create: `scripts/lint-skills.js`, `test/lint-skills.test.js`, `test/fixtures/skills-valid/good-skill/SKILL.md`, `test/fixtures/skills-invalid/bad-skill/SKILL.md`

**Interfaces:**
- Produces: `lintSkills(skillsRoot: string): string[]` (array of error strings, empty = pass); CLI exit 1 on errors when run directly against `components/skills`.

- [ ] **Step 1: Write fixtures and failing test**

`test/fixtures/skills-valid/good-skill/SKILL.md`:

```markdown
---
name: good-skill
description: Does a good thing for simonrowe.dev. Use when testing the linter.
---
# Good Skill
Body.
```

`test/fixtures/skills-invalid/bad-skill/SKILL.md` (name mismatch, no "Use when"):

```markdown
---
name: wrong-name
description: Does a bad thing.
---
# Bad
```

`test/lint-skills.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails** — `npm test`, FAIL.

- [ ] **Step 3: Implement scripts/lint-skills.js**

```js
#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('../lib/frontmatter.js');

function lintSkills(skillsRoot) {
  const errors = [];
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (dirs.length === 0) errors.push(`no skills found under ${skillsRoot}`);
  for (const d of dirs) {
    const skillFile = path.join(skillsRoot, d.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) { errors.push(`${d.name}: missing SKILL.md`); continue; }
    const { attrs } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
    if (!attrs.name) errors.push(`${d.name}: missing frontmatter 'name'`);
    else if (attrs.name !== d.name) errors.push(`${d.name}: frontmatter name '${attrs.name}' != directory 'and ${d.name}'`.replace("'and ", "'"));
    if (!attrs.description) errors.push(`${d.name}: missing frontmatter 'description'`);
    else if (!attrs.description.includes('Use when')) errors.push(`${d.name}: description must contain 'Use when'`);
    const extraKeys = Object.keys(attrs).filter((k) => k !== 'name' && k !== 'description');
    if (extraKeys.length) errors.push(`${d.name}: only name+description allowed, found: ${extraKeys.join(', ')}`);
  }
  return errors;
}

module.exports = { lintSkills };
if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..', 'components', 'skills');
  const errors = lintSkills(root);
  for (const e of errors) console.error(`LINT: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : 'skills lint: OK');
  process.exit(errors.length ? 1 : 0);
}
```

(Clean up that name-mismatch message template while implementing — assert on substrings as in the test.)

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint-skills.js test/lint-skills.test.js test/fixtures/
git commit -m "feat: skill lint enforcing frontmatter conventions"
```

---

### Task 5: Tool adapters (`lib/adapters/`)

**Files:**
- Create: `lib/adapters/claude.js`, `lib/adapters/gemini.js`, `lib/adapters/codex.js`, `lib/adapters/index.js`, `test/adapters.test.js`

**Interfaces:**
- Produces: each adapter exports `{ key, binary, skillsDir(home), instructionsFile(home), mcpAddArgs(server), mcpGetArgs(name) }`. `index.js` exports `ADAPTERS` (array of all three) and `detectTools({ toolsFlag, isOnPath })` returning the adapters to provision (`isOnPath: (binary) => boolean` injected for testability).
- MCP `server` shape: `{ name, type: 'stdio'|'http', command?: string[], url?: string }`.
- Consumed by: Tasks 6, 7, 8, 10.

- [ ] **Step 1: Write the failing tests**

`test/adapters.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { ADAPTERS, detectTools } = require('../lib/adapters/index.js');

test('adapter destinations', () => {
  const byKey = Object.fromEntries(ADAPTERS.map((a) => [a.key, a]));
  assert.strictEqual(byKey.claude.skillsDir('/h'), '/h/.claude/skills');
  assert.strictEqual(byKey.claude.instructionsFile('/h'), '/h/.claude/CLAUDE.md');
  assert.strictEqual(byKey.gemini.skillsDir('/h'), '/h/.gemini/skills');
  assert.strictEqual(byKey.gemini.instructionsFile('/h'), '/h/.gemini/GEMINI.md');
  assert.strictEqual(byKey.codex.skillsDir('/h'), '/h/.codex/skills');
  assert.strictEqual(byKey.codex.instructionsFile('/h'), '/h/.codex/AGENTS.md');
});

test('claude mcp args for stdio and http', () => {
  const claude = ADAPTERS.find((a) => a.key === 'claude');
  assert.deepStrictEqual(
    claude.mcpAddArgs({ name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] }),
    ['mcp', 'add', '--scope', 'user', 'playwright', '--', 'npx', '-y', '@playwright/mcp@latest']
  );
  assert.deepStrictEqual(
    claude.mcpAddArgs({ name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' }),
    ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'excalidraw', 'https://mcp.excalidraw.com/mcp']
  );
});

test('detectTools honors --tools flag and PATH detection', () => {
  const onPath = (bin) => bin !== 'codex';
  assert.deepStrictEqual(detectTools({ toolsFlag: null, isOnPath: onPath }).map((a) => a.key), ['claude', 'gemini']);
  assert.deepStrictEqual(detectTools({ toolsFlag: ['codex'], isOnPath: onPath }).map((a) => a.key), ['codex']);
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm test`, FAIL.

- [ ] **Step 3: Implement adapters**

`lib/adapters/claude.js`:

```js
'use strict';
const path = require('node:path');
module.exports = {
  key: 'claude',
  binary: 'claude',
  skillsDir: (home) => path.join(home, '.claude', 'skills'),
  instructionsFile: (home) => path.join(home, '.claude', 'CLAUDE.md'),
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', s.name, s.url]
    : ['mcp', 'add', '--scope', 'user', s.name, '--', ...s.command],
  mcpGetArgs: (name) => ['mcp', 'get', name],
};
```

`lib/adapters/gemini.js` — same shape with `.gemini`, `GEMINI.md`, binary `gemini`, and:

```js
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', s.name, s.url]
    : ['mcp', 'add', '--scope', 'user', s.name, ...s.command],
  mcpGetArgs: (name) => ['mcp', 'list'],
```

`lib/adapters/codex.js` — `.codex`, `AGENTS.md`, binary `codex`, and:

```js
  mcpAddArgs: (s) => s.type === 'http'
    ? ['mcp', 'add', s.name, '--url', s.url]
    : ['mcp', 'add', s.name, '--', ...s.command],
  mcpGetArgs: (name) => ['mcp', 'get', name],
```

**Verification sub-step (required, do during this task):** run `gemini mcp add --help` and `codex mcp add --help` locally (both binaries are installed on this machine). If actual flags differ from the above (e.g. Gemini uses `-s user`, or Codex HTTP servers aren't supported by `codex mcp add`), fix the adapter AND the test to match reality. If Codex can't register HTTP servers via CLI, make `mcpAddArgs` return `null` for http and the mcp provisioner (Task 8) will record it as `skipped` with note `http servers unsupported by codex CLI — add to ~/.codex/config.toml manually`.

`lib/adapters/index.js`:

```js
'use strict';
const ADAPTERS = [require('./claude.js'), require('./gemini.js'), require('./codex.js')];
function detectTools({ toolsFlag, isOnPath }) {
  if (toolsFlag && toolsFlag.length) return ADAPTERS.filter((a) => toolsFlag.includes(a.key));
  return ADAPTERS.filter((a) => isOnPath(a.binary));
}
module.exports = { ADAPTERS, detectTools };
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/adapters/ test/adapters.test.js
git commit -m "feat: claude/gemini/codex adapters with verified mcp add syntax"
```

---

### Task 6: Skills provisioner (`lib/provisioners/skills.js`)

**Files:**
- Create: `lib/provisioners/skills.js`, `test/provisioner-skills.test.js`
- Create (temporary content so the provisioner has something real to install): `components/skills/local-env/SKILL.md` — authored fully in Task 13; for THIS task create it with valid lint-passing placeholder-free minimal content:

```markdown
---
name: local-env
description: Start, stop and verify the simonrowe.dev local development environment. Use when running the app locally, tests need infrastructure, or ports conflict between Conductor workspaces.
---
# Local Environment
Authored in full by Task 13.
```

(The body line above is acceptable here because Task 13 replaces it; the frontmatter is final.)

**Interfaces:**
- Consumes: `copyDirAtomic` (Task 3), adapters (Task 5).
- Produces: `provisionSkills({ home, adapters, componentsDir, check }): Result[]` where `Result = { provisioner: 'skills', item: string, tool: string, status: 'installed'|'updated'|'unchanged'|'missing'|'failed', note?: string }`. In `check` mode nothing is written; status is `unchanged` or `missing`.

- [ ] **Step 1: Write the failing test**

`test/provisioner-skills.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails** — `npm test`, FAIL.

- [ ] **Step 3: Implement lib/provisioners/skills.js**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { copyDirAtomic, dirsEqual } = require('../fsx.js');

const STATUS_MAP = { new: 'installed', updated: 'updated', unchanged: 'unchanged' };

function provisionSkills({ home, adapters, componentsDir, check }) {
  const skillsRoot = path.join(componentsDir, 'skills');
  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const results = [];
  for (const adapter of adapters) {
    for (const skill of skills) {
      const src = path.join(skillsRoot, skill);
      const dest = path.join(adapter.skillsDir(home), skill);
      try {
        if (check) {
          const status = !fs.existsSync(dest) ? 'missing' : dirsEqual(src, dest) ? 'unchanged' : 'updated';
          results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: status === 'updated' ? 'missing' : status, note: status === 'updated' ? 'out of date' : undefined });
        } else {
          results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: STATUS_MAP[copyDirAtomic(src, dest)] });
        }
      } catch (err) {
        results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: 'failed', note: err.message });
      }
    }
  }
  return results;
}
module.exports = { provisionSkills };
```

(While implementing, simplify the awkward check-mode ternary into clear if/else; keep semantics: check mode never writes, out-of-date reports as `missing` with note `out of date`.)

- [ ] **Step 4: Run tests + lint to verify they pass** — `npm test && npm run lint:skills`, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioners/skills.js test/provisioner-skills.test.js components/skills/local-env/
git commit -m "feat: skills provisioner fanning out to all tool directories"
```

---

### Task 7: Instructions provisioner (`lib/provisioners/instructions.js`)

**Files:**
- Create: `lib/provisioners/instructions.js`, `test/provisioner-instructions.test.js`
- Create: `components/instructions/global.md` with the single line `Authored in full by Task 11.` (final content in Task 11 — this provisioner treats it as opaque text).

**Interfaces:**
- Consumes: `mergeMarkerBlock`, `hasMarkerBlock` (Task 2), adapters (Task 5).
- Produces: `provisionInstructions({ home, adapters, componentsDir, check }): Result[]` — one result per tool, item `'instructions'`, statuses: `installed` (block added), `updated` (block replaced with different content), `unchanged`, `missing` (check mode, no block), `failed`.

- [ ] **Step 1: Write the failing test**

`test/provisioner-instructions.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails** — `npm test`, FAIL.

- [ ] **Step 3: Implement lib/provisioners/instructions.js**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mergeMarkerBlock, hasMarkerBlock } = require('../markers.js');

function provisionInstructions({ home, adapters, componentsDir, check }) {
  const body = fs.readFileSync(path.join(componentsDir, 'instructions', 'global.md'), 'utf8');
  const results = [];
  for (const adapter of adapters) {
    const file = adapter.instructionsFile(home);
    try {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const merged = mergeMarkerBlock(existing, body);
      if (check) {
        const status = existing === null || !hasMarkerBlock(existing) ? 'missing' : merged === existing ? 'unchanged' : 'missing';
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status, note: status === 'missing' ? `block absent or stale in ${file}` : undefined });
      } else if (merged === existing) {
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: 'unchanged' });
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, merged);
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: existing !== null && hasMarkerBlock(existing) ? 'updated' : 'installed' });
      }
    } catch (err) {
      results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: 'failed', note: err.message });
    }
  }
  return results;
}
module.exports = { provisionInstructions };
```

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioners/instructions.js test/provisioner-instructions.test.js components/instructions/global.md
git commit -m "feat: instructions provisioner with clobber-safe marker merge"
```

---

### Task 8: MCP provisioner (`lib/provisioners/mcp.js`)

**Files:**
- Create: `lib/provisioners/mcp.js`, `test/provisioner-mcp.test.js`

**Interfaces:**
- Consumes: adapters (Task 5).
- Produces: `MCP_SERVERS` export and `provisionMcp({ adapters, exec, check }): Result[]`. `exec(binary, args) => { status: number, stdout: string, stderr: string }` is injected (real impl wraps `spawnSync`); tests pass a fake.

- [ ] **Step 1: Write the failing test**

`test/provisioner-mcp.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionMcp, MCP_SERVERS } = require('../lib/provisioners/mcp.js');
const { ADAPTERS } = require('../lib/adapters/index.js');
const claude = ADAPTERS.filter((a) => a.key === 'claude');

test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['excalidraw', 'playwright']);
});

test('adds missing servers, skips present, refuses project-scoped', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get' && args[2] === 'playwright') return { status: 0, stdout: 'playwright\n  Scope: Project config\n', stderr: '' };
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const byName = Object.fromEntries(results.map((r) => [r.item, r]));
  assert.strictEqual(byName.playwright.status, 'failed');
  assert.match(byName.playwright.note, /project scope/i);
  assert.match(byName.playwright.note, /claude mcp remove/);
  assert.strictEqual(byName.excalidraw.status, 'installed');
  assert.ok(calls.some((c) => c.includes('mcp add --scope user --transport http excalidraw')));
});

test('check mode never calls add', () => {
  const calls = [];
  const exec = (bin, args) => { calls.push(args[1]); return { status: 1, stdout: '', stderr: '' }; };
  const results = provisionMcp({ adapters: claude, exec, check: true });
  assert.ok(results.every((r) => r.status === 'missing'));
  assert.ok(!calls.includes('add'));
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test`, FAIL.

- [ ] **Step 3: Implement lib/provisioners/mcp.js**

```js
'use strict';
const MCP_SERVERS = [
  { name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] },
  { name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' },
];

function scopeOf(getOutput) {
  const m = /Scope:\s*(User|Local|Project)/i.exec(getOutput || '');
  return m ? m[1].toLowerCase() : null;
}

function provisionMcp({ adapters, exec, check }) {
  const results = [];
  for (const adapter of adapters) {
    for (const server of MCP_SERVERS) {
      const push = (status, note) => results.push({ provisioner: 'mcp', item: server.name, tool: adapter.key, status, note });
      try {
        const get = exec(adapter.binary, adapter.mcpGetArgs(server.name));
        const registered = get.status === 0 && get.stdout.includes(server.name);
        const scope = registered ? scopeOf(get.stdout) : null;
        if (registered && scope && scope !== 'user') {
          push('failed', `registered at ${scope} scope which shadows user scope — run: ${adapter.binary} mcp remove ${server.name} -s ${scope}, then re-run install`);
          continue;
        }
        if (registered) { push('unchanged'); continue; }
        if (check) { push('missing'); continue; }
        const addArgs = adapter.mcpAddArgs(server);
        if (!addArgs) { push('skipped', `http servers unsupported by ${adapter.key} CLI — add manually`); continue; }
        const add = exec(adapter.binary, addArgs);
        push(add.status === 0 ? 'installed' : 'failed', add.status === 0 ? undefined : add.stderr.trim());
      } catch (err) {
        push('failed', err.message);
      }
    }
  }
  return results;
}
module.exports = { provisionMcp, MCP_SERVERS };
```

Note: `scopeOf` only ever matches on Claude's `mcp get` output; Gemini's `mcp list` output has no scope line so `scope` stays null and registration presence is the whole check — that's intended.

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioners/mcp.js test/provisioner-mcp.test.js
git commit -m "feat: mcp provisioner with scope-aware idempotency"
```

---

### Task 9: Plugins provisioner (`lib/provisioners/plugins.js`)

**Files:**
- Create: `lib/provisioners/plugins.js`, `test/provisioner-plugins.test.js`

**Interfaces:**
- Consumes: nothing from adapters (plugins are Claude-or-global concerns).
- Produces: `provisionPlugins({ exec, check, yes, prompt }): Result[]`. `prompt(question, def) => Promise<boolean>` injected; `--yes` passes `yes: true` so prompt is bypassed. Items: `superpowers`, `speckit`, `ui.sh`, `spring-tools`.

Plugin behaviors (encode exactly):

| Item | Check | Install action |
|---|---|---|
| `superpowers` | `claude plugin list` output contains a line matching `/^superpowers@/` AND that line contains `enabled` | `claude plugin install superpowers@claude-plugins-official` then, if list shows disabled, `claude plugin enable superpowers@<marketplace-from-list>`. Marketplace is parsed from the list line (superpowers ships in both `claude-plugins-official` and `superpowers-marketplace` — never hardcode which) |
| `speckit` | `specify --version` exits 0 | `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git` (if `uv` missing: status `skipped`, note `install uv first: https://docs.astral.sh/uv/`) |
| `ui.sh` | any directory matching `ui-*` or `ui.sh` marker exists under `~/.claude/skills/` (accept `home` param for this one check) | Never automated (account token required). Status `skipped` with note `get your personal install command from https://ui.sh (account token required)` |
| `spring-tools` | `claude plugin list` contains `/^spring-tools@/` | `claude plugin marketplace add spring-projects/spring-tools && claude plugin install spring-tools@spring-tools`, then enable if disabled (same pattern as superpowers). **Verification sub-step:** check https://github.com/spring-projects/spring-tools README for the current plugin/marketplace coordinates before finalizing; if the experimental plugin uses different coordinates, update both code and test to match |

- [ ] **Step 1: Write the failing test** — `test/provisioner-plugins.test.js` with a fake `exec` that scripts these scenarios: (a) all present+enabled → all `unchanged` except `ui.sh` which is `unchanged` when marker dir exists; (b) superpowers installed but disabled → install path calls `plugin enable superpowers@claude-plugins-official` (marketplace taken from fake list output) and returns `updated`; (c) check mode with nothing present → `missing`/`skipped`, zero install calls. Write the test with the same fake-exec call-recording pattern as Task 8.

- [ ] **Step 2: Run test to verify it fails** — `npm test`, FAIL.

- [ ] **Step 3: Implement** — follow the behavior table exactly; parse `claude plugin list` lines with `/^(\S+)@(\S+)\s+.*\b(enabled|disabled)\b/` per line; statuses: present+enabled → `unchanged`; installed-this-run → `installed`; enabled-this-run → `updated`; declined prompt → `skipped` note `declined`; tool missing → `skipped` with actionable note.

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioners/plugins.js test/provisioner-plugins.test.js
git commit -m "feat: plugins provisioner (superpowers, speckit, ui.sh, spring-tools)"
```

---

### Task 10: Orchestrator, summary table, doctor, smoke test (`lib/run.js`)

**Files:**
- Create: `lib/run.js`, `lib/report.js`, `test/report.test.js`, `test/smoke.test.js`
- Modify: `bin/agent-setup.js` (no change needed if Task 1 was followed — it already requires `../lib/run.js`).

**Interfaces:**
- Consumes: all four provisioners, `detectTools`.
- Produces: `run(args): Promise<number>` (exit code); `renderTable(results): string`.

- [ ] **Step 1: Write the failing tests**

`test/report.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderTable, exitCode } = require('../lib/report.js');

test('renders aligned table with one row per result and a totals line', () => {
  const results = [
    { provisioner: 'skills', item: 'local-env', tool: 'claude', status: 'installed' },
    { provisioner: 'mcp', item: 'playwright', tool: 'claude', status: 'failed', note: 'boom' },
  ];
  const out = renderTable(results);
  assert.match(out, /local-env\s+claude\s+installed/);
  assert.match(out, /playwright\s+claude\s+FAILED\s+boom/);
  assert.match(out, /1 installed.*1 failed/);
});

test('exit code 1 iff any failed', () => {
  assert.strictEqual(exitCode([{ status: 'installed' }]), 0);
  assert.strictEqual(exitCode([{ status: 'failed' }]), 1);
});
```

`test/smoke.test.js` (the CI-critical end-to-end):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail** — `npm test`, FAIL.

- [ ] **Step 3: Implement lib/report.js and lib/run.js**

`lib/report.js`: `renderTable(results)` — columns `item | tool | status | note`, pad with spaces, uppercase FAILED, totals line counting each status; `exitCode(results)` — `results.some(r => r.status === 'failed') ? 1 : 0`. In doctor mode `missing` also counts as failure: export `exitCode(results, { strictMissing })`.

`lib/run.js`:

```js
'use strict';
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detectTools } = require('./adapters/index.js');
const { provisionSkills } = require('./provisioners/skills.js');
const { provisionInstructions } = require('./provisioners/instructions.js');
const { provisionMcp } = require('./provisioners/mcp.js');
const { provisionPlugins } = require('./provisioners/plugins.js');
const { renderTable, exitCode } = require('./report.js');

function realExec(binary, args) {
  const r = spawnSync(binary, args, { encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const isOnPath = (binary) => spawnSync('which', [binary], { encoding: 'utf8' }).status === 0;

async function run(args) {
  const home = args.target || os.homedir();
  const componentsDir = path.join(__dirname, '..', 'components');
  const check = args.command === 'doctor';
  const adapters = detectTools({ toolsFlag: args.tools, isOnPath });
  if (!adapters.length) { console.error('No tools found on PATH (claude, gemini, codex) and none specified via --tools.'); return 1; }
  console.log(`${check ? 'Checking' : 'Provisioning'} for: ${adapters.map((a) => a.key).join(', ')}`);

  const results = [];
  const skip = (name) => args.skip.includes(name);
  if (!skip('skills')) results.push(...provisionSkills({ home, adapters, componentsDir, check }));
  if (!skip('instructions')) results.push(...provisionInstructions({ home, adapters, componentsDir, check }));
  if (!skip('mcp')) results.push(...provisionMcp({ adapters, exec: realExec, check }));
  if (!skip('plugins')) results.push(...provisionPlugins({ exec: realExec, check, yes: args.yes, prompt: makePrompt(args.yes), home }));

  console.log(renderTable(results));
  return exitCode(results, { strictMissing: check });
}

function makePrompt(yes) {
  if (yes || !process.stdin.isTTY) return async () => true;
  const readline = require('node:readline/promises');
  return async (question, def = true) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`${question} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    rl.close();
    return answer === '' ? def : answer.startsWith('y');
  };
}

module.exports = { run };
```

Also add a doctor-only extra check inside `run` when `check` is true: verify `path.join(home, 'workspace', 'simonjamesrowe', 'env')` exists → result `{ provisioner: 'env', item: 'workspace env file', tool: '-', status: exists ? 'unchanged' : 'missing', note: '~/workspace/simonjamesrowe/env holds shared secrets' }`.

- [ ] **Step 4: Run tests to verify they pass** — `npm test`, PASS.

- [ ] **Step 5: Manually run doctor against the real machine and eyeball output**

Run: `node bin/agent-setup.js doctor --skip plugins` (safe: doctor never writes). Confirm the table renders and detection matches installed tools.

- [ ] **Step 6: Commit**

```bash
git add lib/run.js lib/report.js test/report.test.js test/smoke.test.js
git commit -m "feat: install/doctor orchestration with summary table"
```

---

### Task 11: Instruction content (`components/instructions/*.md`)

**Files:**
- Modify: `components/instructions/global.md` (replace Task 7 stub with the full content below)
- Create: `components/instructions/monorepo-additions.md`

- [ ] **Step 1: Write global.md** — exactly this content (it is the deliverable; adjust only if a stated fact fails verification against the monorepo):

```markdown
# simonjamesrowe / simonrowe.dev

This section applies when working in repos under the `simonjamesrowe` GitHub
org (the simonrowe.dev monorepo and its satellites). Ignore it in other repos.

## Environment map

- https://simonrowe.dev — the site (React frontend)
- https://api.simonrowe.dev — Spring Boot backend (`/actuator/health`, `/api/blogs`, `/api/profile`; management port 8081 in prod, 8082 default locally)
- https://console.simonrowe.dev — Portainer (container management)
- https://langfuse.simonrowe.dev — Langfuse (v2 today: no OTLP ingest, no backend SDK — expect no traces)
- Grafana Cloud Loki — prod container logs (`logs-prod-035.grafana.net`, query by `container` label)
- Production host: Raspberry Pi (ARM64) running `docker-compose.prod.yml`, ingress via Cloudflare → pinggy tunnel → nginx. **No SSH access from this machine**: emit a single copy-paste command block for Simon to run on the Pi and ask for the output.
- Images: `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-{backend,frontend}` — pushed by the "Publish" GitHub Actions workflow on merge to main; the Pi pulls (no push deploy).

## Non-negotiables

- **Credentials come from env files** (`.env` in the repo, sourced from `~/workspace/simonjamesrowe/env`). Admin identity is `admin@simonrowe.dev`; the password is in env. Never ask for or echo credential values.
- **Mongock-first**: any production data change ships as a Mongock change unit in the backend, not an ad-hoc script.
- **Data restores go through the admin Data Ops UI** (browser automation), not raw mongorestore against prod data.
- **Backups**: full-with-media only; retain the last 7.
- **Never restart prod nginx** unless all four upstreams (frontend, backend, portainer, langfuse) are running — nginx aborts at boot if any upstream is down, taking Portainer with it.

## Git conventions (this org)

Conventional commits and branch prefixes (`feat/`, `fix/`, `chore/`). No Jira
ticket references. CI must be green before merge; branches auto-delete on merge.

## Installed skills

Reach for these before improvising:

- `prod-data-restore` — restore the latest prod backup into a local environment
- `prod-deploy` — ship a merge to production and verify it
- `prod-logs` — fetch prod logs (Loki, Portainer, docker compose)
- `prod-triage` — site down / broken page runbook
- `prod-backup-ops` — trigger and verify backups
- `local-env` — start/stop/verify the local stack (Conductor port contention)
- `backend-test` — gradle test/checkstyle incantations and the pre-commit hook
- `mongock-migration` — scaffold a data migration the right way
- `content-source-add` — add a content-aggregation scraper source
- `chat-e2e-verify` — browser-driven chatbot quality pass
- `langfuse-verify` — check LLM trace plumbing end-to-end
```

- [ ] **Step 2: Write monorepo-additions.md** — canonical text for the monorepo CLAUDE.md `<!-- MANUAL ADDITIONS -->` section. Content: a heading noting its provenance (`Maintained in simonjamesrowe/agent-setup — edit there`), then these facts (full sentences, one bullet each): pinggy single-tunnel token + `+force` reclaim suffix; OrbStack overrides `DOCKER_BINARY_PATH=/opt/homebrew/bin/docker` and `DOCKER_PLUGINS_PATH=~/.docker/cli-plugins` when running prod compose on macOS; management-port mismatch (prod compose sets `MANAGEMENT_SERVER_PORT: 8081`, `application.yml` defaults to 8082 — local health checks use 8082 unless env overrides); README staleness warning (`create-backup.sh`/`restore-backup.sh`/`migrate-strapi-data.js` no longer exist; use `backup.sh`/`restore.sh`); self-redeploy endpoint `POST /api/admin/data-operations/redeploy` (pulls backend/frontend/nginx, restarts backend via ephemeral `docker:cli` helper); nginx four-upstream boot fragility (duplicated here deliberately — it's the highest-cost gotcha).

- [ ] **Step 3: Run tests** — `npm test` (instructions provisioner test + smoke re-run against new content), PASS.

- [ ] **Step 4: Commit**

```bash
git add components/instructions/
git commit -m "feat: global instruction block and monorepo additions content"
```

---

### Task 12: Prod-ops skills (5 skills)

**Files:**
- Create: `components/skills/prod-data-restore/SKILL.md`, `components/skills/prod-data-restore/references/data-ops-api.md`, `components/skills/prod-deploy/SKILL.md`, `components/skills/prod-logs/SKILL.md`, `components/skills/prod-logs/references/loki-cookbook.md`, `components/skills/prod-triage/SKILL.md`, `components/skills/prod-backup-ops/SKILL.md`

**Authoring rules for every skill (this task and Tasks 13–14):** frontmatter `name` (== dir) + `description` ending in a `Use when …` clause; body 100–300 lines with sections: `# Title`, `## When to use`, `## Prerequisites`, numbered workflow steps with exact commands, `## Gotchas`, `## Related skills`. Verify every path/command against `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` before writing it. Credentials referenced as env var names only.

Fact sheets (the body of each skill is built from these — every bullet must appear):

**prod-data-restore** — description: `Restore the latest simonrowe.dev production backup (Google Drive) into a local environment via the admin Data Ops UI. Use when local data is stale, missing, or a bug needs prod-like data to reproduce.`
- Precondition: local stack running (`docker compose up -d`, backend via `./scripts/start-backend.sh`, frontend `./scripts/start-frontend.sh`); in Conductor, stop other workspaces first (shared ports 8080/5173/27017/9200/9092).
- Flow: open `http://localhost:5173`, log in as `admin@simonrowe.dev` (password from env — with browser automation this is Playwright MCP in Claude Code; otherwise print manual steps) → Admin → Data Ops → list backups → restore the newest → watch progress (SSE) → then trigger rebuild-index and reembed.
- Never use mongorestore/mongosh against prod-derived data for this flow — the Data Ops restore imports collections in `@DBRef` dependency order (independent: tags, skills, profiles, social_medias, tourSteps, media_assets, content_sources, aggregated_articles, aggregated_events; then dependent: skill_groups, jobs, blogs, code_examples) and takes a local safety backup first.
- API alternative when the UI is unavailable → `references/data-ops-api.md`: all under `/api/admin/data-operations` (Auth0 JWT with `DEV_PORTAL_ADMIN` role): `GET /status`, `GET /progress` (SSE), `GET /backups`, `POST /restore {backupFileId}`, `POST /backup?includeMedia=true`, `POST /clear {confirmationPhrase}` (exact phrase required), `POST /rebuild-index`, `POST /reembed`, `POST /redeploy`. 409 = op in progress; 503 = Drive not connected/Docker unavailable. Google Drive env: `GOOGLE_DRIVE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/FOLDER_ID` (one-time auth: `./scripts/google-drive-auth.sh`).
- Local tarball alternative for local-only snapshots: `./scripts/backup.sh` / `./scripts/restore.sh` (`~/backups/backup-*.tar.gz`, mongodump + uploads + ES snapshot; restart backend after restore).

**prod-deploy** — description: `Deploy simonrowe.dev to production: merge, watch the Publish workflow, restart on the Pi, smoke-test. Use when shipping merged changes to prod or checking whether prod runs the latest build.`
- Flow: PR merged to main → `gh run watch` the "Publish" workflow (`publish.yml`, ARM runners) → confirm images `ghcr.io/simonjamesrowe/simonrowe-dev-monorepo-backend:latest` + `-frontend:latest` updated (`gh api /orgs... or docker manifest inspect`) → deploy on the Pi.
- Pi has no SSH from this machine: emit ONE copy-paste block for Simon to run on the Pi: `cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && ./scripts/restart-prod.sh && ./scripts/status-prod.sh` (restart = pull + `up -d`; status prints per-service health table + external reachability verdict). Alternative without the Pi: authenticated `POST https://api.simonrowe.dev/api/admin/data-operations/redeploy` (pulls backend/frontend/nginx; backend restarts itself via an ephemeral `docker:cli` helper container ~5s later).
- Smoke tests after deploy: `curl -fsS https://api.simonrowe.dev/actuator/health`, `curl -fsS https://simonrowe.dev`, check `https://www.simonrowe.dev/mcp`, spot-check a blog page (images render, dates present).
- **Stale-image check** (the incident pattern): compare running container image digest vs ghcr latest — on the Pi: `docker compose -f docker-compose.prod.yml images` and `docker inspect --format '{{.Image}}' simonrowe-dev-monorepo-frontend-1`. If prod behavior predates the merge, prod is running a stale image: re-run restart script (it pulls).

**prod-logs** — description: `Fetch simonrowe.dev production logs from Grafana Cloud Loki, Portainer, or docker compose. Use when investigating prod errors, checking container output, or confirming a fix landed.`
- Primary: Loki query_range API: `curl -su "$GRAFANA_CLOUD_LOKI_USER:$GRAFANA_CLOUD_API_KEY" 'https://logs-prod-035.grafana.net/loki/api/v1/query_range' --data-urlencode 'query={container="simonrowe-dev-monorepo-backend-1"}' --data-urlencode 'start=...' --data-urlencode 'limit=200'` (creds are env var names; endpoint from `GRAFANA_CLOUD_LOKI_ENDPOINT` minus `/push`). Label is `container` (full compose container name), also `image` label available.
- **Free-tier exclusions**: kafka, mongo, frontend, langfuse-db containers do NOT ship logs to Loki (deliberate free-tier volume control) — for those use Portainer or compose logs.
- Portainer: `https://console.simonrowe.dev` (Auth0 SSO, `DEV_PORTAL_ADMIN`) → container → Logs; browser automation works well here.
- On the Pi (copy-paste block): `docker compose -f docker-compose.prod.yml logs --since 30m backend nginx`.
- Traces/metrics honesty: Alloy ships logs only; `traces = []` (Tempo endpoint is wrong region, Langfuse v2 has no OTLP); nothing scrapes `/actuator/prometheus`. Don't promise metrics; suggest `prod-triage` for health signals. `references/loki-cookbook.md`: 6–8 canned LogQL queries (backend errors `|= "ERROR"`, nginx 5xx, restore progress, chat requests, per-container volumes with `sum by (container) (count_over_time(...))`).

**prod-triage** — description: `Runbook for simonrowe.dev being down or misbehaving in production. Use when the site is unreachable, a page breaks after deploy, containers are unhealthy, or Portainer/Langfuse are inaccessible.`
- Ordered checks: 1) `curl -fsS https://simonrowe.dev` + `https://api.simonrowe.dev/actuator/health` from local. 2) If unreachable: pinggy tunnel likely — the Pi runs `monitor-prod.sh` via cron every minute (auto-restarts pinggy after 3 consecutive failures, max 3 restarts/10min, logs `/var/log/prod-health/monitor.log`); Pi block: `cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && ./scripts/status-prod.sh && tail -50 /var/log/prod-health/monitor.log`. 3) Pinggy "same token already active" → reclaim with `PINGGY_TOKEN=<token>+force`. Check status.pinggy.io. 4) Containers stuck in `created` → `docker compose -f docker-compose.prod.yml up -d` reconciles. 5) nginx crash-loop: verify ALL FOUR upstreams (frontend, backend, portainer, langfuse) are up before restarting nginx — nginx resolves upstreams at boot and dies if any is missing (`host not found in upstream`), which also kills Portainer access. Minimal recovery: `docker start simonrowe-dev-monorepo-langfuse-1 && docker start simonrowe-dev-monorepo-nginx-1`. 6) Behavior predates latest merge → stale image (see `prod-deploy`). 7) Errors → `prod-logs`.
- Backend JVM note: `JAVA_TOOL_OPTIONS: -Xshare:off` in prod compose works around an aarch64 G1GC SIGSEGV — don't remove it.

**prod-backup-ops** — description: `Trigger, verify and manage simonrowe.dev production backups to Google Drive. Use when checking backup health, taking a pre-change backup, or pruning old backups.`
- Policy: full-with-media only (`POST /api/admin/data-operations/backup?includeMedia=true`); retain last 7 (delete older via Drive or Data Ops UI list).
- Verify: `GET /backups` lists Drive files with id/size/date — newest should be < 24h old (nightly job).
- Contents: 13 collections as extended JSON + uploads + ES snapshot in a ZIP; incremental media via `.media-state.json` sidecar in the Drive folder (don't delete it).
- Drive quota is Simon's personal account (OAuth user creds, not service account).
- Local tarball flow (`./scripts/backup.sh`) is separate and local-only.

- [ ] **Step 1: Author the 5 skills + 2 references files from the fact sheets, verifying each command/path against the monorepo**
- [ ] **Step 2: Run lint and tests** — `npm run lint:skills && npm test`, PASS (skill counts in smoke test adjust automatically).
- [ ] **Step 3: Commit**

```bash
git add components/skills/
git commit -m "feat: prod-ops skills (restore, deploy, logs, triage, backups)"
```

---

### Task 13: Dev-workflow skills (3 skills)

**Files:**
- Create/Replace: `components/skills/local-env/SKILL.md` (replaces Task 6 stub body), `components/skills/backend-test/SKILL.md`, `components/skills/mongock-migration/SKILL.md`, `components/skills/mongock-migration/references/changeunit-patterns.md`

Fact sheets:

**local-env** — keep Task 6 frontmatter. Body: `docker compose up -d` gives mongodb:27017, kafka:9092, elasticsearch:9200, langfuse:3000; `./scripts/start.sh` = compose `--wait` + backend + frontend with trap-based cleanup; `./scripts/stop.sh` kills ports 8080/5173 + compose down; individual `./scripts/start-backend.sh` / `start-frontend.sh` (both hard-fail if their `.env` missing — copy from `~/workspace/simonjamesrowe/env`, which conductor.json automates). Conductor contention: workspaces share host ports — stop other workspaces' stacks before starting (`lsof -ti:8080` to find offenders). Verify: `curl localhost:8082/actuator/health` (management port default 8082 locally), frontend on 5173. Backend tests do NOT need compose (Testcontainers).

**backend-test** — description: `Run and interpret simonrowe.dev backend tests, checkstyle and coverage. Use when running tests, fixing checkstyle violations, or the pre-commit hook fails.`
- Commands: `./gradlew :backend:test`, single test `./gradlew :backend:test --tests 'com.simonrowe.blog.*'`, full gate `./gradlew check` (checkstyle + tests + jacoco ≥0.78 verification), `./gradlew :backend:checkstyleMain :backend:checkstyleTest` (Google checks, `maxWarnings=0` — one warning fails).
- Testcontainers: no docker-compose needed; `auth0.jwt.enabled=false` in tests; forks = cores/2, 1536m heap.
- Jacoco excludes: `migration/**`, `dataops/**`, `embedding/**`, some agents — new code elsewhere needs coverage.
- Pre-commit hook runs the full backend suite + checkstyle + coverage — don't `--no-verify` around failures, fix them. Frontend: `cd frontend && npm test` (Vitest).

**mongock-migration** — description: `Create a Mongock change unit for simonrowe.dev data changes with the repo's idempotency and test patterns. Use when data needs migrating, backfilling, deduping, or seeding — any time an ad-hoc script is tempting.`
- Rule: data changes ship as change units in `backend/src/main/java/com/simonrowe/migration/changeunits/`, auto-run at startup (mongock enabled in `application.yml`).
- Before writing: read the two most recent change units in that package and copy their exact conventions (`@ChangeUnit(id, order, author)`, ordering scheme, guard-clause idempotency — check-before-write so re-execution is safe, `@RollbackExecution`).
- Integration-test pattern (put real details in `references/changeunit-patterns.md`, extracted from an actual recent change unit + its test at authoring time: annotations, mongock.enabled override, mocked ScraperFactory where aggregation is involved, teardown).
- Verify locally: restart backend, check mongock lock/history collections, confirm data shape.

- [ ] **Step 1: Author the 3 skills + references from fact sheets, verifying against the monorepo (especially: read a real change unit and test to fill changeunit-patterns.md with actual code)**
- [ ] **Step 2: Run lint and tests** — `npm run lint:skills && npm test`, PASS.
- [ ] **Step 3: Commit**

```bash
git add components/skills/
git commit -m "feat: dev-workflow skills (local-env, backend-test, mongock-migration)"
```

---

### Task 14: Content & AI skills (3 skills)

**Files:**
- Create: `components/skills/content-source-add/SKILL.md`, `components/skills/chat-e2e-verify/SKILL.md`, `components/skills/langfuse-verify/SKILL.md`

Fact sheets:

**content-source-add** — description: `Add a new content-aggregation source (blog/news/events scraper) to simonrowe.dev. Use when adding a site to aggregate, fixing a broken scraper, or backfilling articles from a source.`
- Read `backend/src/main/java/com/simonrowe/agents/scrapers/` to enumerate current strategies (RSS, HTML listing, etc.) and pick per source (prefer RSS/feed when the site has one).
- Seed the source via Mongock change unit (see `mongock-migration`) into `content_sources`; `scripts/seed-content-sources.js` shows the document shape.
- Trigger aggregation (admin UI or scheduler — aggregation cron `0 0 */6 * * *`), then verify `aggregated_articles` documents and the site's rendering; check images and dates populated (both were past regressions).

**chat-e2e-verify** — description: `Browser-driven quality check of the simonrowe.dev chatbot against a local environment. Use when chat behavior, rendering, guardrails, or personas changed and need end-to-end verification.`
- Precondition: local env with restored prod data (`prod-data-restore`) — quality checks are meaningless on empty data.
- With browser automation (Playwright MCP in Claude Code): open localhost:5173, exercise chat: on-topic question (Simon's career), off-topic question (must deflect politely — guardrail), question triggering tool use (rendering of tool-usage indicators), response with links/images (render correctly, no raw markdown).
- WebSocket note: chat runs over STOMP at `/ws/chat` — if messages hang, check backend logs for STOMP errors.
- promptfoo evals exist in `/evals` (run in CI via evals.yml with seeded data + reembed); mention `cd evals && npm run eval` needs `OPENAI_API_KEY` and a running backend.

**langfuse-verify** — description: `Verify Langfuse LLM trace plumbing for simonrowe.dev end to end. Use when checking whether chat/agent calls produce traces, or after observability changes.`
- Current honest state (2026-07): Langfuse v2.95.1 in prod has NO OTLP ingest (`/api/public/otel` is v3+); backend has NO Langfuse SDK; Alloy trace exporters are commented out (Tempo endpoint wrong region). Expect zero traces today — say so instead of debugging a non-existent pipeline.
- What CAN be verified: Langfuse UI reachable (`https://langfuse.simonrowe.dev`, Auth0 + `DEV_PORTAL_ADMIN`), container healthy, `./scripts/verify-langfuse-trace.sh` (read it first — it documents the intended flow; run against local `localhost:3000` with `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` from env).
- Path to real traces (for context, not to execute): upgrade Langfuse to v3, re-enable Alloy OTLP exporter with correct endpoint, or add SDK/Spring AI observability to the backend.

- [ ] **Step 1: Author the 3 skills from fact sheets, verifying against the monorepo (read scrapers package and verify-langfuse-trace.sh before writing)**
- [ ] **Step 2: Run lint and tests** — `npm run lint:skills && npm test`, PASS.
- [ ] **Step 3: Commit**

```bash
git add components/skills/
git commit -m "feat: content and AI skills (content-source-add, chat-e2e-verify, langfuse-verify)"
```

---

### Task 15: Docs (`docs/SKILLS.md`, full `README.md`)

**Files:**
- Create: `docs/SKILLS.md`
- Modify: `README.md`

- [ ] **Step 1: Write docs/SKILLS.md** — conventions doc adapted from ct-engineering-skills for a solo org: naming (lower-kebab-case, `prod-`/`backend-`/`content-` category prefixes, verb at leaf, folder name == frontmatter name — enforced by `npm run lint:skills`); placement decision (org-wide reusable → this repo's `components/skills/`; repo-specific → that repo's `.claude/skills/`); format contract (frontmatter `name`+`description` with `Use when`, 100–300 line body, `references/` for heavy material, agent-agnostic phrasing, secrets as env names); the fan-out table (Claude/Gemini/Codex destinations); 5-step new-skill checklist (name → author → lint → test install → version bump).

- [ ] **Step 2: Write full README.md** — sections: What this is (one paragraph); Quick start (`npx @simonjamesrowe/agent-setup`, `doctor`, flags table matching Task 1 USAGE exactly); What gets installed (three-tool destination table + skills list with one-liners taken from each skill's description); Updating (re-run npx; version bump policy patch/minor/major); Development (clone, `npm test`, `npm run lint:skills`, smoke test command); License.

- [ ] **Step 3: Run tests** — `npm test`, PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/SKILLS.md README.md
git commit -m "docs: skills conventions and full README"
```

---

### Task 16: CI, release workflow, GitHub repo, first publish

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Write ci.yml**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm test
      - run: npm run lint:skills
      - name: Install smoke test against temp home
        run: |
          TARGET="$(mktemp -d)"
          node bin/agent-setup.js install --yes --target "$TARGET" --tools claude,gemini,codex --skip mcp,plugins
          for d in .claude/skills .gemini/skills .codex/skills; do
            [ "$(ls "$TARGET/$d" | wc -l)" -eq "$(ls components/skills | wc -l)" ] || { echo "count mismatch in $d"; exit 1; }
          done
          grep -q 'AGENT-SETUP:SIMONJAMESROWE START' "$TARGET/.claude/CLAUDE.md"
          node bin/agent-setup.js doctor --target "$TARGET" --tools claude,gemini,codex --skip mcp,plugins
```

- [ ] **Step 2: Write release.yml**

```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
      - run: npm test && npm run lint:skills
      - name: Publish if version is new
        run: |
          NAME=$(node -p "require('./package.json').name")
          VERSION=$(node -p "require('./package.json').version")
          if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
            echo "Version $VERSION already published — skipping."
          else
            npm publish --provenance --access public
          fi
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Create the GitHub repo and push**

Run:
```bash
gh repo create simonjamesrowe/agent-setup --public --description "AI agent setup for the simonjamesrowe org: skills, instructions, MCP and plugins for Claude Code, Gemini CLI and Codex" --source . --push
```

- [ ] **Step 4: Manual secret step (surface to Simon, don't skip)**

An npmjs.com automation token for the `@simonjamesrowe` scope must be added: `gh secret set NPM_TOKEN --repo simonjamesrowe/agent-setup`. If the npm scope/org doesn't exist yet, create it at npmjs.com first. Pause and ask Simon to do this (token creation can't be automated).

- [ ] **Step 5: Commit workflows, push, verify CI green and publish succeeds**

```bash
git add .github/
git commit -m "ci: validation and npm publish workflows"
git push
gh run watch
npx @simonjamesrowe/agent-setup@latest doctor --skip plugins   # end-to-end proof
```

- [ ] **Step 6: Real-machine install** — run `npx @simonjamesrowe/agent-setup` (no skips) interactively with Simon present, confirm summary table, then `agent-setup doctor` clean.

---

### Task 17: Monorepo follow-up PR (separate repo)

**Files (in `~/workspace/simonjamesrowe/simonrowe-dev-monorepo`):**
- Modify: `CLAUDE.md` (inside `<!-- MANUAL ADDITIONS START/END -->` markers only)

- [ ] **Step 1: Branch `chore/agent-setup-manual-additions` in the monorepo; replace the MANUAL ADDITIONS section content with `components/instructions/monorepo-additions.md` from this repo (keeping the markers), preserving any existing manual content not covered by it**
- [ ] **Step 2: Open PR titled `chore: sync CLAUDE.md manual additions from agent-setup`, body linking to the agent-setup repo; note it must not touch speckit-managed sections**
- [ ] **Step 3: After CI green, surface the PR to Simon for merge (his repo, his call)**

---

## Self-Review (completed)

1. **Spec coverage:** repo layout → T1–T10; 11 skills → T6+T12–T14; instructions/marker strategy → T2, T7, T11; adapters incl. Gemini/Codex verification → T5; MCP scope-aware idempotency → T8; plugins incl. superpowers enable-gotcha and ui.sh token limitation → T9; doctor incl. env-file check and clobber detection → T10; lint (name==dir, "Use when") → T4; CI smoke + publish-on-new-version → T16; monorepo-additions applied via PR, installer never writes to repos → T11+T17. No gaps found.
2. **Placeholder scan:** the two intentional stubs (T6 `local-env` body, T7 `global.md` one-liner) are explicitly replaced by named later tasks (T13, T11) and carry final frontmatter — not placeholders in the failure sense. Skill bodies are specified by exhaustive fact sheets rather than verbatim prose; each fact is concrete (command, path, URL, policy).
3. **Type consistency:** `Result` shape `{provisioner, item, tool, status, note?}` used by T6–T10; statuses drawn from the same set everywhere (`installed|updated|unchanged|missing|skipped|failed`); `exec(binary, args)` signature identical in T8/T9/T10; `detectTools({toolsFlag, isOnPath})` matches T5 test and T10 usage; marker consts shared via `lib/markers.js`.
