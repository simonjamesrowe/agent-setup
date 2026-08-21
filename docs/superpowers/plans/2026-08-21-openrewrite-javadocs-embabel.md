# Moderne/OpenRewrite, javadocs MCP and opt-in Embabel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Java-modernisation tooling to `@simonjamesrowe/agent-setup` — a `javadocs` MCP server, the Moderne CLI with its OpenRewrite MCP server and skills, a `spring-boot-upgrade` skill for the 3.5 → 4 migration, and an opt-in Embabel docs server — then rewrite the README so the inventory and three-agent support are obvious.

**Architecture:** Everything plugs into the existing provisioner architecture, nothing new is invented. Static MCP servers are registry rows in `lib/provisioners/mcp.js`; CLI tools that need a confirm prompt are functions in `lib/provisioners/plugins.js` alongside `provisionSpeckit`; skills are markdown directories under `components/skills/`. One genuinely new mechanism: a `--with <a,b>` flag plus an `optional: true` registry marker, so a component can be opt-in without breaking `doctor`.

**Tech Stack:** Node ≥20, zero runtime dependencies, `node:test` + `node:assert` for tests. External CLIs are reached only through the injected `exec(binary, args)` seam so tests never touch the real machine.

## Global Constraints

- **Zero runtime dependencies.** `fs`/`path`/`child_process` only. Do not add a package to `dependencies`.
- **Never exec a real CLI from a test.** Provisioners take `exec` by injection; tests pass a fake and throw on unexpected calls. Follow the existing pattern in `test/provisioner-plugins.test.js`.
- **`--target` force-skips `mcp` and `plugins`** (see `lib/run.js`) because they mutate real user config. Do not weaken this.
- **Skill format contract** (enforced by `npm run lint:skills`): frontmatter is *exactly* `name` and `description`, nothing else; `name` must equal the directory name; `description` must contain the literal phrase `Use when`; body roughly 100–300 lines; heavy material goes in `references/`.
- **Agent-agnostic skill prose.** No "use the Read tool" or other Claude-Code-specific tool names — skills install into Gemini CLI and Codex too.
- **Secrets as env var names, never values.** Name the variable and where it is sourced from; never inline a token, real or sample.
- **Verified-behaviour comments.** When code depends on an external CLI's output shape or argv, add a comment saying what was verified and when — the house style throughout `lib/provisioners/plugins.js`.
- **Commit per task**, conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`), no agent attribution in the message.
- **Exact identifiers, copied verbatim:**
  - javadocs MCP: `https://www.javadocs.dev/mcp` (HTTP, no auth)
  - Moderne install: `brew install moderneinc/moderne/mod`, then `mod config agent-tools install`
  - Boot 4 recipe: `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`
  - Recipe artifacts repo: `https://artifacts.codegenomeproject.org/maven`
  - Embabel guide MCP endpoint: `http://localhost:1337/sse`

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `lib/provisioners/mcp.js` | MCP registry + registration/check logic. Gains the `javadocs` row, the `embabel-guide` optional row, and optional-entry filtering. | 1, 4 |
| `lib/provisioners/plugins.js` | CLI-tool installs needing a prompt. Gains `provisionModerne` + `moderneAuthStatus`. | 2 |
| `lib/run.js` | Orchestration. Threads `args.with` into the mcp provisioner; adds the doctor-only Moderne auth row. | 2, 4 |
| `bin/agent-setup.js` | Arg parsing + usage text. Gains `--with`. | 4 |
| `components/skills/spring-boot-upgrade/SKILL.md` | The Boot upgrade runbook. | 3 |
| `components/skills/spring-boot-upgrade/references/spring-boot-4-playbook.md` | Chained recipe list + known breakages, with sources. | 3 |
| `components/skills/embabel-guide/SKILL.md` | Running the Embabel docs MCP server locally. | 5 |
| `README.md` | Inventory + three-agent support matrix. | 6 |
| `package.json` | Version 0.2.0 → 0.3.0. | 7 |
| `test/provisioner-mcp.test.js` | Catalog, javadocs argv, optional filtering. | 1, 4 |
| `test/provisioner-plugins.test.js` | Moderne install/unchanged/no-brew/gemini/declined/failed. | 2 |
| `test/cli.test.js` | `--with` parsing. | 4 |
| `test/report.test.js` | `optional` never fails an exit code. | 4 |

---

### Task 1: `javadocs` MCP server

**Files:**
- Modify: `lib/provisioners/mcp.js:2-5` (the `MCP_SERVERS` array)
- Test: `test/provisioner-mcp.test.js:22-24` (the `server catalog` test) and a new test

**Interfaces:**
- Consumes: nothing.
- Produces: `MCP_SERVERS` gains `{ name: 'javadocs', type: 'http', url: 'https://www.javadocs.dev/mcp' }`. Task 4 adds an `optional` field to entries of this same array.

- [ ] **Step 1: Update the catalog test to expect javadocs**

In `test/provisioner-mcp.test.js`, replace the existing `server catalog` test with:

```js
test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['excalidraw', 'javadocs', 'playwright']);
});
```

- [ ] **Step 2: Add a test proving the right argv per adapter**

Append to `test/provisioner-mcp.test.js`:

```js
const codex = ADAPTERS.filter((a) => a.key === 'codex');

test('javadocs registers as an HTTP server with per-adapter argv', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const claudeResults = provisionMcp({ adapters: claude, exec, check: false });
  assert.strictEqual(claudeResults.find((r) => r.item === 'javadocs').status, 'installed');
  assert.ok(calls.includes('claude mcp add --scope user --transport http javadocs https://www.javadocs.dev/mcp'));

  calls.length = 0;
  const codexResults = provisionMcp({ adapters: codex, exec, check: false });
  assert.strictEqual(codexResults.find((r) => r.item === 'javadocs').status, 'installed');
  assert.ok(calls.includes('codex mcp add javadocs --url https://www.javadocs.dev/mcp'));
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test test/provisioner-mcp.test.js`
Expected: FAIL — the catalog assertion reports `['excalidraw','playwright']` and no `javadocs` row exists, so `.find(...)` returns `undefined` and throws on `.status`.

- [ ] **Step 4: Add the registry entry**

In `lib/provisioners/mcp.js`, change the array to:

```js
const MCP_SERVERS = [
  { name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] },
  { name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' },
  // javadocs.dev — Java/Kotlin/Scala API docs resolved from Maven Central: latest artifact
  // version, javadoc-jar contents, and per-symbol documentation. Open endpoint, no auth.
  { name: 'javadocs', type: 'http', url: 'https://www.javadocs.dev/mcp' },
];
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/provisioner-mcp.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add lib/provisioners/mcp.js test/provisioner-mcp.test.js
git commit -m "feat: register the javadocs.dev MCP server for all three agents"
```

---

### Task 2: Moderne CLI provisioner

**Files:**
- Modify: `lib/provisioners/plugins.js` (add `provisionModerne`, `moderneAuthStatus`; wire into `provisionPlugins`)
- Modify: `lib/run.js` (pass `adapters` to `provisionPlugins`; add the doctor-only auth row)
- Test: `test/provisioner-plugins.test.js`

**Interfaces:**
- Consumes: `provisionPlugins({ exec, check, yes, prompt, hasClaude })` as it exists today.
- Produces:
  - `provisionPlugins` gains an `adapters` option: an array of adapter objects (each has a `key` of `'claude' | 'gemini' | 'codex'`). Defaults to `[]`, in which case Moderne rows report `skipped` with note `no supported agent selected`.
  - Exported `moderneAuthStatus(exec)` → `{ configured: boolean, note?: string }`, used by `lib/run.js` for the doctor-only row.
  - New result rows with `provisioner: 'plugins'`, `item: 'moderne'`, one per agent in `adapters`, `tool` = the agent key.

- [ ] **Step 1: Discovery — install the real CLI and record the verified commands**

This task depends on three facts the published docs do not state. Establish them **before** writing code, and paste the real output into the code comments.

```bash
brew install moderneinc/moderne/mod
mod --version
mod config --help
mod config agent-tools --help
mod config agent-tools install --help
claude mcp list
```

Record:
1. **The MCP server name** `mod config agent-tools install` registers (expected `moderne`; confirm against `claude mcp list`).
2. **Which agents** `mod config agent-tools` accepts as subcommands (docs say `claude`, `codex`, `cursor`, `copilot`, `amp`, `windsurf` — and *not* `gemini`; confirm from `--help`).
3. **The auth-status command** — inspect `mod config --help` for the Moderne/Code Genome credential subcommands and find the read-only one (candidates: `mod config moderne show`, `mod config http credentials show`, `mod config recipes artifacts show`). Pick the one that reports configuration without printing a secret.

If fact 1 differs from `moderne`, change only the `MODERNE_MCP_SERVER` constant in Step 3 and the test fixture in Step 2. If fact 2 differs, change only `MODERNE_AGENTS`. If fact 3's command differs, change only `MODERNE_AUTH_ARGV`. Everything else in this task is independent of the discovery.

- [ ] **Step 2: Write the failing tests**

Append to `test/provisioner-plugins.test.js`. `claudeOnly`/`allThree` stand in for the adapter objects the provisioner receives — it only ever reads `.key`.

```js
const claudeOnly = [{ key: 'claude' }];
const allThree = [{ key: 'claude' }, { key: 'gemini' }, { key: 'codex' }];

// Baseline fake: superpowers/spring-tools/speckit all already present, so the only rows that
// move in these tests are moderne's. `moderneInstalled` controls `mod --version`;
// `mcpRegistered` controls whether the agent already has the moderne MCP server.
function moderneExec({ moderneInstalled, mcpRegistered, hasBrew = true, calls = [], failAt = null }) {
  return (bin, args) => {
    const line = [bin, ...args].join(' ');
    calls.push(line);
    if (failAt && line.includes(failAt)) return { status: 1, stdout: '', stderr: 'boom' };
    if (bin === 'claude' && args[0] === 'plugin' && args[1] === 'list') {
      return {
        status: 0,
        stdout: pluginListJson([
          { id: 'superpowers@claude-plugins-official', enabled: true },
          { id: 'spring-tools@spring-tools-marketplace', enabled: true },
        ]),
        stderr: '',
      };
    }
    if (bin === 'specify' && args[0] === '--version') return { status: 0, stdout: 'specify 0.1.0', stderr: '' };
    if (bin === 'mod' && args[0] === '--version') {
      return moderneInstalled ? { status: 0, stdout: 'mod 3.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (bin === 'brew' && args[0] === '--version') {
      return hasBrew ? { status: 0, stdout: 'Homebrew 4.0.0', stderr: '' } : { status: 1, stdout: '', stderr: 'command not found' };
    }
    if (args[0] === 'mcp' && args[1] === 'get') {
      return mcpRegistered ? { status: 0, stdout: 'moderne\n  Scope: User config\n', stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
    }
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}

test('moderne: cli present and mcp registered -> unchanged, no install calls', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'unchanged');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: cli absent -> brew install then agent-tools install, reports installed', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools install'));
});

test('moderne: cli present but mcp not registered -> only runs agent-tools install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'installed');
  assert.ok(!calls.includes('brew install moderneinc/moderne/mod'));
  assert.ok(calls.includes('mod config agent-tools install'));
});

test('moderne: no homebrew -> skipped with actionable note, never runs brew install', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, hasBrew: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /brew\.sh/);
  assert.ok(!calls.some((c) => c.includes('brew install')));
});

test('moderne: gemini is reported unsupported and never provisioned', async () => {
  const exec = moderneExec({ moderneInstalled: true, mcpRegistered: true });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: allThree });
  const moderneRows = results.filter((r) => r.item === 'moderne');
  const gemini = moderneRows.find((r) => r.tool === 'gemini');
  assert.strictEqual(gemini.status, 'skipped');
  assert.match(gemini.note, /not supported/i);
  assert.deepStrictEqual(moderneRows.filter((r) => r.tool !== 'gemini').map((r) => r.status), ['unchanged', 'unchanged']);
});

test('moderne: no adapters -> skipped, never execs mod or brew', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: [] });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.match(r.moderne.note, /no supported agent/i);
  assert.ok(!calls.some((c) => c.startsWith('mod ') || c.startsWith('brew ')));
});

test('moderne: check mode reports missing and never installs', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: true, yes: false, prompt: async () => { throw new Error('must never prompt in check mode'); }, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'missing');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: declined prompt -> skipped with declined note', async () => {
  const calls = [];
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, calls });
  const results = await provisionPlugins({ exec, check: false, yes: false, prompt: async () => false, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'skipped');
  assert.strictEqual(r.moderne.note, 'declined');
  assert.ok(!calls.some((c) => c.includes('brew install') || c.includes('agent-tools install')));
});

test('moderne: failing install step -> failed with stderr in the note', async () => {
  const exec = moderneExec({ moderneInstalled: false, mcpRegistered: false, failAt: 'brew install' });
  const results = await provisionPlugins({ exec, check: false, yes: true, prompt: async () => true, adapters: claudeOnly });
  const r = byItem(results);
  assert.strictEqual(r.moderne.status, 'failed');
  assert.strictEqual(r.moderne.note, 'boom');
});

test('moderneAuthStatus: configured when the status command succeeds with output', () => {
  const configured = moderneAuthStatus(() => ({ status: 0, stdout: 'https://app.moderne.io  user@example.com\n', stderr: '' }));
  assert.strictEqual(configured.configured, true);
  const empty = moderneAuthStatus(() => ({ status: 0, stdout: '   \n', stderr: '' }));
  assert.strictEqual(empty.configured, false);
  const failed = moderneAuthStatus(() => ({ status: 1, stdout: '', stderr: 'not configured' }));
  assert.strictEqual(failed.configured, false);
});
```

Add `moderneAuthStatus` to the require at the top of the file:

```js
const { provisionPlugins, findPlugin, moderneAuthStatus } = require('../lib/provisioners/plugins.js');
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `node --test test/provisioner-plugins.test.js`
Expected: FAIL — `moderneAuthStatus is not a function`, and every `r.moderne` is `undefined` because no such row is produced yet.

- [ ] **Step 4: Implement `provisionModerne` and `moderneAuthStatus`**

Add to `lib/provisioners/plugins.js` above `provisionPlugins`. Replace the three constants with whatever Step 1 verified, and update the comment to say what was verified and when.

```js
// Verified against `mod config agent-tools --help` (Moderne CLI, 2026-08-21).
// `mod config agent-tools install` does two things in one shot: registers the local Moderne MCP
// server with each supported agent (it shells out to `claude mcp add` itself) and installs
// Moderne's skills into that agent's marketplace directory. So there is nothing to register by
// hand here — we only ensure `mod` exists and has been pointed at the agents.
const MODERNE_MCP_SERVER = 'moderne';
// Moderne's per-agent subcommands: claude, codex, cursor, copilot, amp, windsurf. Gemini CLI is
// NOT supported upstream, so we report that gap rather than pretending to provision it.
const MODERNE_AGENTS = ['claude', 'codex'];
// Read-only credential status: reports whether Moderne / Code Genome auth is configured without
// printing the token.
const MODERNE_AUTH_ARGV = ['config', 'moderne', 'show'];

function moderneAuthStatus(exec) {
  const res = exec('mod', MODERNE_AUTH_ARGV);
  if (res.status !== 0 || !res.stdout.trim()) {
    return { configured: false, note: 'run the one-time setup in the spring-boot-upgrade skill — OpenRewrite recipes resolve from the Code Genome Project and need a token' };
  }
  return { configured: true };
}

async function provisionModerne({ exec, check, yes, prompt, adapters }) {
  const supported = adapters.filter((a) => MODERNE_AGENTS.includes(a.key));
  const unsupported = adapters.filter((a) => !MODERNE_AGENTS.includes(a.key));
  const rows = unsupported.map((a) => ({ tool: a.key, status: 'skipped', note: `not supported by mod config agent-tools (supports ${MODERNE_AGENTS.join(', ')})` }));
  if (!supported.length) {
    rows.push({ tool: '-', status: 'skipped', note: `no supported agent selected (needs one of ${MODERNE_AGENTS.join(', ')})` });
    return rows;
  }

  const cliPresent = exec('mod', ['--version']).status === 0;
  const registered = cliPresent && supported.every((a) => {
    const get = exec(a.binary || a.key, ['mcp', 'get', MODERNE_MCP_SERVER]);
    return get.status === 0 && get.stdout.includes(MODERNE_MCP_SERVER);
  });
  if (cliPresent && registered) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'unchanged' }))];
  }
  if (check) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'missing' }))];
  }

  const proceed = await confirmInstall(prompt, yes, 'moderne (OpenRewrite CLI, MCP server and skills)');
  if (!proceed) return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'skipped', note: 'declined' }))];

  const steps = [];
  if (!cliPresent) {
    if (exec('brew', ['--version']).status !== 0) {
      return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'skipped', note: 'install Homebrew first: https://brew.sh' }))];
    }
    steps.push(['brew', ['install', 'moderneinc/moderne/mod']]);
  }
  steps.push(['mod', ['config', 'agent-tools', 'install']]);
  for (const [bin, args] of steps) {
    const res = exec(bin, args);
    if (res.status !== 0) {
      return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'failed', note: (res.stderr || '').trim() }))];
    }
  }
  return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'installed' }))];
}
```

Wire it into `provisionPlugins` — change the signature to accept `adapters` and append the Moderne rows before the return:

```js
async function provisionPlugins({ exec, check, yes, prompt, hasClaude = true, adapters = [] }) {
```

```js
  for (const row of await provisionModerne({ exec, check, yes, prompt, adapters })) {
    results.push({ provisioner: 'plugins', item: 'moderne', tool: row.tool, status: row.status, ...(row.note ? { note: row.note } : {}) });
  }

  return results;
}
```

Export the new function:

```js
module.exports = { provisionPlugins, findPlugin, moderneAuthStatus };
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/provisioner-plugins.test.js`
Expected: PASS. If a pre-existing test now fails because `adapters` defaults to `[]`, that is correct — those tests don't pass `adapters`, so Moderne reports `skipped: no supported agent selected` and never touches `exec`, which is why the `no adapters` test asserts exactly that.

- [ ] **Step 6: Thread `adapters` through `run.js` and add the doctor auth row**

In `lib/run.js`, add `adapters` to the existing `provisionPlugins` call — that is the only change to the call; every other argument keeps its current value:

```js
    results.push(...(await provisionPlugins({ exec: realExec, check, yes: args.yes, prompt: makePrompt(args.yes), home, hasClaude, adapters })));
```

Then, in the doctor-only block that already checks the env file, add the Moderne auth row *after* it. Guard on `mod` being installed so machines that deliberately don't have the CLI aren't reported as broken:

```js
    if (realExec('mod', ['--version']).status === 0) {
      const { moderneAuthStatus } = require('./provisioners/plugins.js');
      const auth = moderneAuthStatus(realExec);
      results.push({
        provisioner: 'env',
        item: 'moderne auth',
        tool: '-',
        status: auth.configured ? 'unchanged' : 'missing',
        ...(auth.note ? { note: auth.note } : {}),
      });
    }
```

- [ ] **Step 7: Verify the whole suite and a real doctor run**

Run: `npm test`
Expected: PASS, every file.

Run: `node bin/agent-setup.js doctor`
Expected: a `moderne` row per selected agent, a `moderne auth` row only if `mod` is on PATH, and exit code 0 or 1 depending on what's genuinely missing. Read the table and confirm the Moderne rows say what you expect on this machine.

- [ ] **Step 8: Commit**

```bash
git add lib/provisioners/plugins.js lib/run.js test/provisioner-plugins.test.js
git commit -m "feat: provision the Moderne CLI with its OpenRewrite MCP server and skills"
```

---

### Task 3: `spring-boot-upgrade` skill

**Files:**
- Create: `components/skills/spring-boot-upgrade/SKILL.md`
- Create: `components/skills/spring-boot-upgrade/references/spring-boot-4-playbook.md`
- Modify: `docs/SKILLS.md` (add `spring-boot-` to the category-prefix list)

**Interfaces:**
- Consumes: the Moderne MCP server from Task 2 (`search_recipes`, `learn_recipe`, `run_recipe`, `lst_status`, `build_status`) and the spring-tools MCP already provisioned (`getSpringBootVersion`, `getLatestBootVersionsFromMavenRepo`, `getJavaVersion`, `getProjectDiagnostics`).
- Produces: a skill named `spring-boot-upgrade`; referenced by name from the README table in Task 6 and from the `Related skills` sections of no other skill (leave existing skills untouched).

- [ ] **Step 1: Confirm the Boot 4 breaking changes before writing them down**

Do not write the playbook from memory. Read these and cite them in the reference file:

- `https://docs.openrewrite.org/recipes/java/spring/boot4/upgradespringboot_4_0-community-edition` — the authoritative list of what the recipe chains and therefore what you do *not* have to do by hand.
- The Spring Boot 4.0 release notes / migration guide on `github.com/spring-projects/spring-boot/wiki`.
- `https://docs.openrewrite.org/recipes/java/spring/boot4/migratetomodularstarters-community-edition` — the modular-starter split.

Confirm specifically, and record the answer for each:
1. Which starter artifacts the modular split replaces (`spring-boot-starter-web` → what).
2. Jackson: whether Boot 4.0 moves to Jackson 3 and what the package rename is.
3. Whether `@MockBean`/`@SpyBean` are removed (not merely deprecated) in favour of `@MockitoBean`/`@MockitoSpyBean`.
4. The minimum Gradle and Java versions Boot 4.0's plugin requires — the monorepo pins `JavaLanguageVersion.of(21)`, so note whether that still satisfies the floor.
5. **The blocker check**: whether the Spring AI and Embabel versions the backend depends on have Boot 4-compatible releases. The backend mocks Embabel's `Ai` in `AbstractIntegrationTest` and configures `spring.ai.openai.api-key`, so a Spring AI or Embabel release that is still Boot 3-only blocks the whole upgrade regardless of what the recipe does. Record the versions required and whether they exist yet.
6. Mongock's Boot 4 support — every org data change ships as a Mongock change unit, so a Mongock incompatibility is also a hard blocker.

If items 5 or 6 turn out to be blockers, the skill still ships: it says so in the preflight, with the version floors, so the reader hits the blocker in 30 seconds instead of after a 40-file recipe run.

- [ ] **Step 2: Write the reference file**

Create `components/skills/spring-boot-upgrade/references/spring-boot-4-playbook.md` with these sections, populated from Step 1:

1. **What `UpgradeSpringBoot_4_0` does for you** — the chained recipes (Spring Framework 7, Spring Security 7, Spring Cloud 2025.1, modular starters, config-property renames, test-annotation replacements), each with the recipe ID.
2. **What it does not do** — the manual checklist items from Step 1, each with a source link.
3. **Blocker matrix** — Spring AI, Embabel, Mongock, Testcontainers, Java/Gradle floors: required version, current version in the monorepo, blocked yes/no.
4. **Recipe artifact resolution** — the Code Genome repo URL, the fact that recipes no longer come from Maven Central, and the env var names holding the username and token (values never inlined).
5. **Rollback** — `git checkout -- .` and `git clean -fd` after a bad `rewriteRun`, and why running the recipe on a dirty tree makes this impossible.

- [ ] **Step 3: Write the skill body**

Create `components/skills/spring-boot-upgrade/SKILL.md`. Frontmatter exactly:

```markdown
---
name: spring-boot-upgrade
description: Upgrade the simonrowe.dev backend across Spring Boot versions with OpenRewrite, via the Moderne MCP server or the OpenRewrite Gradle plugin. Use when bumping Spring Boot to a new major or minor line, running an OpenRewrite recipe, or a framework upgrade breaks the build.
---
```

Body sections, in this order:

1. **Intro (3–5 sentences)** — the transformation is deterministic (recipes, not an LLM); the agent's job is preflight, blocker checks, running the right recipe, and reading the test output. Working directory is `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` or a Conductor workspace clone; Gradle is a single-module build (`:backend:`).
2. **When to use** — bulleted triggers matching the description.
3. **One-time setup** — sign in to the Code Genome Project, create a download token, store username and token in `~/workspace/simonjamesrowe/env` (name the env vars; never a value), configure `mod` with the credential command verified in Task 2 Step 1, and verify with `mod config agent-tools install`. State plainly that OpenRewrite recipes no longer resolve from Maven Central, so **both** paths below need this.
4. **Preflight** — clean working tree (`git status --porcelain` must be empty, because rollback depends on it); branch `chore/spring-boot-4`; read current and available versions via the spring-tools MCP (`getSpringBootVersion`, `getLatestBootVersionsFromMavenRepo`, `getJavaVersion`); then the blocker matrix in the reference file. **Stop and report if a blocker is unresolved** — do not run the recipe.
5. **Path A — Moderne MCP (default)** — check `lst_status`/`build_status` first and wait for the LST build to finish (recipes run against a partially built LST silently under-apply); `search_recipes` to confirm the recipe ID; `learn_recipe` to read its options; `run_recipe` with `org.openrewrite.java.spring.boot4.UpgradeSpringBoot_4_0`; then `git diff --stat` to size the change before reading it.
6. **Path B — OpenRewrite Gradle plugin (fallback)** — for machines without the `mod` CLI. The plugin block, the `rewrite-spring` dependency, the Code Genome repository with credentials read from env vars, `./gradlew rewriteRun`, and **reverting the temporary build-file edit afterwards** so it never reaches a commit.
7. **Manual checklist** — the items from the reference file, one line each, linking to the reference for detail.
8. **Verification** — in order: `./gradlew :backend:checkstyleMain :backend:checkstyleTest`, `./gradlew :backend:test`, `./gradlew :backend:jacocoTestCoverageVerification` (delegate the detail to `backend-test`); then the spring-tools `validate` skill / `getProjectDiagnostics`; then `local-env` for a runtime smoke test, because a Boot upgrade breaks things at context startup that compile fine. State explicitly: do not claim the upgrade works before test output has been seen.
9. **Gotchas** — dirty tree defeats rollback; recipes are per-repo so the frontend is unaffected; a large `rewriteRun` diff needs reviewing in chunks, not accepted wholesale; `--rerun-tasks` when Gradle reports `UP-TO-DATE`; the recipe will happily bump a dependency whose Boot 4 release doesn't exist yet, which surfaces as a resolution failure not a recipe error.
10. **Related skills** — `backend-test`, `local-env`, `dependency-cve-fix`, `mongock-migration`, `prod-deploy`.

Keep the body between 100 and 300 lines. Push detail into the reference file rather than the body.

- [ ] **Step 4: Add the new category prefix to the conventions doc**

In `docs/SKILLS.md`, add to the prefix list, keeping the existing alphabetical-ish grouping:

```markdown
  - `spring-` — Spring framework and Spring Boot version upgrades
```

- [ ] **Step 5: Lint the skill**

Run: `npm run lint:skills`
Expected: `skills lint: OK`. If it reports a frontmatter error, fix the frontmatter — do not relax the linter.

- [ ] **Step 6: Verify the skill installs**

Run: `node bin/agent-setup.js install --yes --target "$(mktemp -d)" --tools claude,gemini,codex --skip mcp,plugins`
Expected: `spring-boot-upgrade` appears as `installed` for all three tools, and the `references/` file is copied with it.

- [ ] **Step 7: Commit**

```bash
git add components/skills/spring-boot-upgrade docs/SKILLS.md
git commit -m "feat: add spring-boot-upgrade skill for OpenRewrite-driven Boot upgrades"
```

---

### Task 4: `--with` flag and opt-in Embabel MCP registration

**Files:**
- Modify: `bin/agent-setup.js` (parse `--with`, document it in `USAGE`)
- Modify: `lib/run.js` (thread `args.with` into `provisionMcp`)
- Modify: `lib/provisioners/mcp.js` (optional-entry filtering + the `embabel-guide` row)
- Test: `test/cli.test.js`, `test/provisioner-mcp.test.js`, `test/report.test.js`

**Interfaces:**
- Consumes: `MCP_SERVERS` from Task 1.
- Produces:
  - `parseArgs` result gains `with: []` (array of component names).
  - `provisionMcp({ adapters, exec, check, home, with: [] })` — a new `with` option; optional entries not named there are reported with status `'optional'`.
  - `MCP_SERVERS` gains `{ name: 'embabel-guide', type: 'stdio', optional: true, command: [...] }`.

- [ ] **Step 1: Write the failing tests**

In `test/cli.test.js`, update the defaults test and the flags test:

```js
test('parseArgs defaults to install', () => {
  assert.deepStrictEqual(parseArgs([]), { command: 'install', yes: false, tools: null, skip: [], target: null, with: [] });
});

test('parseArgs reads flags', () => {
  const a = parseArgs(['doctor', '--yes', '--tools', 'claude,gemini', '--skip', 'mcp,plugins', '--target', '/tmp/x', '--with', 'embabel-guide']);
  assert.strictEqual(a.command, 'doctor');
  assert.strictEqual(a.yes, true);
  assert.deepStrictEqual(a.tools, ['claude', 'gemini']);
  assert.deepStrictEqual(a.skip, ['mcp', 'plugins']);
  assert.strictEqual(a.target, '/tmp/x');
  assert.deepStrictEqual(a.with, ['embabel-guide']);
});

test('parseArgs --with accepts a comma list and defaults to empty', () => {
  assert.deepStrictEqual(parseArgs(['--with', 'embabel-guide,something-else']).with, ['embabel-guide', 'something-else']);
  assert.deepStrictEqual(parseArgs(['--with', '']).with, []);
});
```

In `test/provisioner-mcp.test.js`, update the catalog test and add optional-filtering tests:

```js
test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['embabel-guide', 'excalidraw', 'javadocs', 'playwright']);
  assert.deepStrictEqual(MCP_SERVERS.filter((s) => s.optional).map((s) => s.name), ['embabel-guide']);
});

test('optional servers are reported optional and never registered unless named in --with', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const embabel = results.find((r) => r.item === 'embabel-guide');
  assert.strictEqual(embabel.status, 'optional');
  assert.match(embabel.note, /--with embabel-guide/);
  assert.ok(!calls.some((c) => c.includes('embabel-guide')), 'must not even check an opted-out server');
});

test('optional servers register when named in --with', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false, with: ['embabel-guide'] });
  assert.strictEqual(results.find((r) => r.item === 'embabel-guide').status, 'installed');
  assert.ok(calls.some((c) => c.includes('mcp add --scope user embabel-guide -- npx mcp-remote http://localhost:1337/sse --transport sse-only')));
});
```

In `test/report.test.js`, add:

```js
test('optional rows never affect the exit code, even under strictMissing', () => {
  const results = [{ status: 'optional' }, { status: 'unchanged' }];
  assert.strictEqual(exitCode(results), 0);
  assert.strictEqual(exitCode(results, { strictMissing: true }), 0);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `node --test test/cli.test.js test/provisioner-mcp.test.js test/report.test.js`
Expected: FAIL — `parseArgs` returns no `with` key, the catalog lacks `embabel-guide`, and the optional-status row doesn't exist. The `report.test.js` case may already pass, since `exitCode` only looks for `failed`/`missing`; that's fine — it's a regression guard.

- [ ] **Step 3: Parse the flag**

In `bin/agent-setup.js`, add the default and the parse branch:

```js
  const args = { command: 'install', yes: false, tools: null, skip: [], target: null, with: [] };
```

```js
    else if (a === '--with') args.with = (rest.shift() || '').split(',').filter(Boolean);
```

And add the line to `USAGE`, under `--skip`:

```
  --with <a,b>          opt in to optional components: embabel-guide
```

- [ ] **Step 4: Add optional filtering and the Embabel row**

In `lib/provisioners/mcp.js`, add the registry row:

```js
  // Opt-in only (`--with embabel-guide`). Embabel's docs server is a local Spring Boot + Neo4j
  // app you run yourself and it costs LLM tokens per query, so registering it unconditionally
  // would leave a dead server configured on every machine. See the embabel-guide skill.
  { name: 'embabel-guide', type: 'stdio', optional: true,
    command: ['npx', 'mcp-remote', 'http://localhost:1337/sse', '--transport', 'sse-only'] },
```

Change the signature and add the skip, at the top of the per-server loop:

```js
function provisionMcp({ adapters, exec, check, home, with: optIns = [] }) {
```

```js
      if (server.optional && !optIns.includes(server.name)) {
        push('optional', `opt in with: --with ${server.name}`);
        continue;
      }
```

Place that check **before** the registration check so an opted-out server is never probed.

- [ ] **Step 5: Thread the flag through `run.js`**

```js
  if (!skipMcp) results.push(...provisionMcp({ adapters, exec: realExec, check, home, with: args.with }));
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 7: Commit**

```bash
git add bin/agent-setup.js lib/run.js lib/provisioners/mcp.js test/cli.test.js test/provisioner-mcp.test.js test/report.test.js
git commit -m "feat: add --with flag for opt-in components and register embabel-guide behind it"
```

---

### Task 5: `embabel-guide` skill

**Files:**
- Create: `components/skills/embabel-guide/SKILL.md`

**Interfaces:**
- Consumes: the `embabel-guide` optional MCP entry from Task 4 — the skill's instructions must match that exact command (`npx mcp-remote http://localhost:1337/sse --transport sse-only`) and tell the reader to enable it with `npx @simonjamesrowe/agent-setup --with embabel-guide`.
- Produces: a skill named `embabel-guide`, referenced from the README tables in Task 6.

- [ ] **Step 1: Confirm the run instructions against the repo**

Read `https://github.com/embabel/guide` (README) and record:
1. The exact `docker compose` invocation and profile name (documented as `docker compose --profile java up --build -d`).
2. Which LLM provider env vars it accepts (OpenAI, Anthropic, Mistral, DeepSeek) and the variable names.
3. Whether Neo4j comes up inside the compose file or must be run separately for the `./mvnw spring-boot:run` path.
4. The MCP endpoint and transport (documented as `http://localhost:1337/sse`, SSE) and the `guide.toolPrefix` setting that determines the tool names.

- [ ] **Step 2: Write the skill**

Create `components/skills/embabel-guide/SKILL.md`. Frontmatter exactly:

```markdown
---
name: embabel-guide
description: Run the Embabel docs MCP server (embabel/guide) locally and register it, for authoring Embabel agent code on the JVM. Use when writing or debugging Embabel agents, goals, actions or conditions and the framework's own docs would help.
---
```

Body sections:

1. **What this is** — a self-hosted Spring Boot app that serves RAG-backed MCP tools over the Embabel documentation, graph-backed by Neo4j. It is not a hosted service: there is no remote endpoint, you run it. It calls an LLM per query, so it costs tokens. The backend already depends on Embabel (`AbstractIntegrationTest` mocks Embabel's `Ai`), which is why this is worth the setup.
2. **When to use / when not to** — reach for it when authoring Embabel agents, GOAP goals/actions/conditions or MCP-exposed tools; don't bother for general Spring questions, where the spring-tools MCP and `javadocs` are cheaper and need no server running.
3. **Prerequisites** — Docker running, a free port `1337`, Neo4j (via the compose profile), and an LLM API key named by env var, sourced from `~/workspace/simonjamesrowe/env`. Never inline a key.
4. **First run** — clone or update `embabel/guide` under `~/workspace/embabel/guide`, export the LLM key, `docker compose --profile java up --build -d`, then wait for the docs to load.
5. **Health check** — confirm the server answers on `http://localhost:1337` before registering, and what "still indexing" looks like versus "up".
6. **Registering the MCP server** — `npx @simonjamesrowe/agent-setup --with embabel-guide`, which registers `npx mcp-remote http://localhost:1337/sse --transport sse-only` at user scope for each detected agent. Note the tools appear under the prefix set by `guide.toolPrefix`.
7. **Shutting down** — `docker compose --profile java down`, and that the registered MCP server will then fail to connect until it's brought back up. That failure is expected, not a broken install.
8. **Gotchas** — Conductor workspaces contend for ports, so `1337` may already be taken by another workspace's stack (cross-reference `local-env`); `mcp-remote` needs the server running *before* the agent starts, or the agent shows the server as failed until restarted; a cold Neo4j means the first few queries return thin results while indexing finishes.
9. **Related skills** — `local-env` (port contention), `spring-boot-upgrade` (Embabel's Boot 4 compatibility is a blocker there), `backend-test` (how Embabel's `Ai` is mocked in tests).

- [ ] **Step 3: Lint and verify install**

Run: `npm run lint:skills`
Expected: `skills lint: OK`.

Run: `node bin/agent-setup.js install --yes --target "$(mktemp -d)" --tools claude,gemini,codex --skip mcp,plugins`
Expected: `embabel-guide` reported `installed` for all three tools.

- [ ] **Step 4: Commit**

```bash
git add components/skills/embabel-guide
git commit -m "feat: add embabel-guide skill for running the Embabel docs MCP server"
```

---

### Task 6: README rework

**Files:**
- Modify: `README.md` (rewrite the intro and the "What gets installed" section; keep Quick start, Updating, Version policy, Development, License)

**Interfaces:**
- Consumes: the final component set from Tasks 1–5. Every row must match what the code actually does — the skill list against `components/skills/`, the MCP list against `MCP_SERVERS`, the plugin list against `provisionPlugins`.
- Produces: nothing other code reads.

- [ ] **Step 1: Rewrite the intro to name all three agents and their vendors**

Replace the opening paragraph so the three-agent story is unmissable and unambiguous about which vendor is which:

```markdown
# agent-setup

One command that sets up **three different coding agents** with the same
skills, instructions and tools for working on the `simonjamesrowe` org:

- **Claude Code** (Anthropic) — `~/.claude/`
- **Gemini CLI** (Google) — `~/.gemini/`
- **Codex** (OpenAI) — `~/.codex/`

Skills are authored once, in agent-agnostic markdown, and fanned out to each
tool's native location — so switching agents doesn't mean starting from a
blank slate. `agent-setup` also registers MCP servers and installs CLI
plugins for whichever of the three it finds on your `PATH`.
```

- [ ] **Step 2: Add the support matrix**

Directly after the intro, before Quick start:

```markdown
## What each agent gets

| | Claude Code | Gemini CLI | Codex |
| --- | --- | --- | --- |
| Skills (15) | ✅ `~/.claude/skills/` | ✅ `~/.gemini/skills/` | ✅ `~/.codex/skills/` |
| Instructions | ✅ `CLAUDE.md` | ✅ `GEMINI.md` | ✅ `AGENTS.md` |
| MCP servers | ✅ | ✅ | ✅ |
| Plugins (superpowers, spring-tools) | ✅ | ❌ Claude-only marketplaces | ❌ Claude-only marketplaces |
| speckit | ✅ | ✅ | ✅ (tool-agnostic, via `uv`) |
| Moderne CLI + OpenRewrite MCP | ✅ | ❌ not supported upstream | ✅ |
```

Update the skill count in the header row to the real number after Tasks 3 and 5 (13 existing + 2 new = 15; verify with `ls components/skills | wc -l`).

- [ ] **Step 3: Replace the "What gets installed" prose with inventory tables**

Keep the existing destinations table and the marker-block explanation, then replace the MCP/plugin bullets with three tables.

Skills — extend the existing table with the two new rows, keeping alphabetical order:

```markdown
| `embabel-guide`        | Run the Embabel docs MCP server locally, for authoring Embabel agent code. |
| `spring-boot-upgrade`  | Upgrade Spring Boot across major/minor lines with OpenRewrite, via the Moderne MCP or the Gradle plugin. |
```

Also add the two rows missing from the current table — `code-review-triage` and `dependency-cve-fix` exist in `components/skills/` but aren't listed. Verify the full list against `ls components/skills`.

MCP servers:

```markdown
### MCP servers

Registered at **user scope** for every detected agent.

| Server | Transport | Auth | What it's for |
| --- | --- | --- | --- |
| `playwright` | stdio (`npx @playwright/mcp@latest`) | none | Browser automation — admin UI flows, chat verification |
| `excalidraw` | HTTP | none | Diagrams |
| `javadocs` | HTTP (`javadocs.dev`) | none | Java/Kotlin/Scala API docs from Maven Central |
| `moderne` | stdio (local, via the `mod` CLI) | Code Genome token | OpenRewrite recipe search and deterministic execution |
| `embabel-guide` | stdio (`mcp-remote` → `localhost:1337`) | your own LLM key | Embabel framework docs — **opt-in**, see below |

A server already registered at project or local scope would shadow the
user-scope one, so that's reported as `failed` with the `mcp remove` command
to fix it rather than being silently overwritten.
```

CLI tools and plugins:

```markdown
### CLI tools and plugins

| Tool | Installed via | Agents |
| --- | --- | --- |
| `superpowers` | `claude plugin install` | Claude Code |
| `spring-tools` | `claude plugin marketplace add` + `plugin install` | Claude Code |
| `speckit` | `uv tool install specify-cli` | all (tool-agnostic) |
| `moderne` | `brew install moderneinc/moderne/mod` + `mod config agent-tools install` | Claude Code, Codex |

`mod config agent-tools install` registers the Moderne MCP server **and**
installs Moderne's own OpenRewrite skills into each supported agent, so
`agent-setup` defers to it rather than reimplementing either. Gemini CLI is
not a supported target upstream and is reported as `skipped`.

Recipes resolve from the Code Genome Project, not Maven Central, so `mod`
needs a token before any recipe will run — `doctor` reports this as
`moderne auth` once the CLI is installed, and the one-time setup is in the
`spring-boot-upgrade` skill.
```

Optional components:

```markdown
### Optional components

Not installed by default; opt in by name.

```bash
npx @simonjamesrowe/agent-setup --with embabel-guide
```

| Component | Why it's opt-in |
| --- | --- |
| `embabel-guide` | Needs a local Docker + Neo4j server on `localhost:1337` and your own LLM API key. Registering it unconditionally would leave a dead server configured on every machine. |

`doctor` reports opted-out components as `optional`, never `missing`, so they
don't affect its exit code.
```

- [ ] **Step 4: Add `--with` to the flags table**

```markdown
| `--with <a,b>`   | opt in to optional components: `embabel-guide`              |
```

- [ ] **Step 5: Verify every claim in the README against the code**

Run each and reconcile the output with the tables you just wrote:

```bash
ls components/skills
node -e "console.log(require('./lib/provisioners/mcp.js').MCP_SERVERS.map(s => s.name + (s.optional ? ' (optional)' : '')))"
node bin/agent-setup.js help
```

Expected: the skill table has one row per directory, the MCP table one row per catalog entry plus `moderne` (which the `mod` CLI registers, so it isn't in `MCP_SERVERS`), and the flags table matches `USAGE` exactly. Fix the README, not the code.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: restructure README around the three-agent matrix and a full tool inventory"
```

---

### Task 7: Version bump and full verification

**Files:**
- Modify: `package.json:3` (`version`)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: version `0.3.0`, ready to publish via the existing OIDC trusted-publishing workflow.

- [ ] **Step 1: Bump the version**

In `package.json`, `"version": "0.2.0"` → `"version": "0.3.0"`. Minor, per the repo's version policy: new skills and a new flag, backward-compatible.

- [ ] **Step 2: Run the full gate**

```bash
npm test
npm run lint:skills
node bin/agent-setup.js install --yes --target "$(mktemp -d)" --tools claude,gemini,codex --skip mcp,plugins
node bin/agent-setup.js doctor
```

Expected: tests pass; lint reports `skills lint: OK`; the smoke install reports every skill `installed` for all three tools with no `failed` rows; `doctor` renders `moderne`, `javadocs` and `embabel-guide` rows with statuses that match this machine's real state. Paste the actual output when reporting — do not claim green without it.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: release 0.3.0"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Component 1 — `javadocs` MCP server | 1 |
| Component 2 — Moderne CLI provisioner (detection, install, per-agent reporting, doctor credential check) | 2 |
| Component 3 — `spring-boot-upgrade` skill + reference file | 3 |
| Component 4 — Embabel opt-in (`--with`, `optional: true`, MCP entry) | 4 |
| Component 4 — `embabel-guide` skill | 5 |
| Component 5 — README rework | 6 |
| Testing table (mcp, plugins, cli, report, lint) | 1, 2, 4, 5 |
| Version 0.3.0 | 7 |
| Implementation order (Moderne first, README second, Embabel third) | Task order 1→2→3, 6 before/after 4–5 is interchangeable; the plan sequences README as Task 6 so it describes the finished component set |

**Open item from the spec** — whether a Code Genome / Moderne account already exists — is resolved inside Task 2 Step 1 and Task 3 Step 3: the discovery step reads the real credential state off the machine, and the skill's setup section is written against what's actually configured rather than assuming a fresh signup.

**Deliberate deferrals, not placeholders:** three constants in Task 2 (`MODERNE_MCP_SERVER`, `MODERNE_AGENTS`, `MODERNE_AUTH_ARGV`) and the factual content of the Boot 4 playbook are established by explicit discovery steps with exact commands and URLs, because the published docs don't state them. Each has a named single point of change if discovery contradicts the expected value.
