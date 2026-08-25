# Linear MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register Linear's official hosted MCP server for every detected agent, and make `doctor` report the truth when an OAuth server is registered but not yet authorized.

**Architecture:** Linear is a plain `type: 'http'` entry appended to `MCP_SERVERS` in `lib/provisioners/mcp.js` — all three adapters already build correct `mcp add` argv for HTTP servers, so no adapter changes. Linear is the catalog's first OAuth server, so the entry carries a new `needsAuth: true` flag. When a `needsAuth` server is registered, the Claude check parses the `Status:` line out of `claude mcp get` and reports `optional` (never `missing` or `failed`) with a sign-in note, so `doctor` neither lies nor exits non-zero for a condition the installer cannot fix.

**Tech Stack:** Node.js (CommonJS, no runtime dependencies), `node:test` + `node:assert`, `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-25-linear-mcp-design.md`

## Global Constraints

- Node `>=20` (`package.json` engines); CI matrix is Node 20, 22, 24. No new runtime dependencies — this package has none and must keep none.
- Every test runs via `npm test` (`node --test test/*.test.js`).
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). **No Jira ticket** in this org. **Never attribute Claude** in commit messages or PR descriptions.
- Endpoint is exactly `https://mcp.linear.app/mcp` (read/write). The read-only variant `https://mcp.linear.app/mcp/readonly` is documented only, never registered.
- `optional` is the status for registered-but-unauthorized. Not `missing` (which exits 1 on the doctor path via `strictMissing: check` at `lib/run.js:70`) and not `failed` (which always exits 1, `lib/report.js:32`).
- Only the explicit needs-authentication state is treated as an auth problem. `✘ Failed to connect` must fall through to today's behaviour — it is transient for open HTTP servers.
- Auth state is reported for **Claude only**. Gemini's check reads `~/.gemini/settings.json`, which holds no auth state; Codex's unauthorized string is unverified. Neither may be guessed at.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/provisioners/mcp.js` | The MCP catalog and the provisioning/check flow for every adapter | Modify: add the `linear` entry; add `needsAuthOf()`; thread `needsAuth` through `execBasedCheck` and `provisionMcp` |
| `test/provisioner-mcp.test.js` | Unit tests for the catalog and the provisioning flow, with a faked `exec` | Modify: update the catalog assertion; add registration-argv and auth-state tests |
| `README.md` | User-facing inventory of what gets provisioned | Modify: MCP table row, catalog prose, an auth note |
| `package.json` | Package version — `release.yml` publishes when this version is new | Modify: `0.3.0` → `0.4.0` |

No adapter files change. `lib/adapters/claude.js:8-10`, `lib/adapters/codex.js:13-15` and `lib/adapters/gemini.js:44-46` already handle `type: 'http'`.

---

### Task 1: Register Linear as an HTTP server

Adds the catalog entry and proves the per-adapter argv is right. No auth behaviour yet — a registered Linear reports `unchanged` at the end of this task, which Task 2 corrects.

**Files:**
- Modify: `lib/provisioners/mcp.js:3-20` (the `MCP_SERVERS` array)
- Test: `test/provisioner-mcp.test.js:18-21` (the existing `server catalog` test), plus one new test

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the catalog entry `{ name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', needsAuth: true }`. Task 2 reads the `needsAuth` property off this object; the property is added here but has no effect until Task 2.

- [ ] **Step 1: Update the existing catalog test and add a registration test**

In `test/provisioner-mcp.test.js`, replace the `server catalog` test (currently at line 18) with:

```js
test('server catalog', () => {
  assert.deepStrictEqual(MCP_SERVERS.map((s) => s.name).sort(), ['embabel-guide', 'excalidraw', 'javadocs', 'linear', 'playwright']);
  assert.deepStrictEqual(MCP_SERVERS.filter((s) => s.optional).map((s) => s.name), ['embabel-guide']);
  // linear is always-on: it is a hosted endpoint that costs nothing to have registered, unlike
  // embabel-guide which needs a local Docker/Neo4j app running to be anything but a dead server.
  assert.ok(!MCP_SERVERS.find((s) => s.name === 'linear').optional);
});
```

Then append this test to the end of the file (it uses the `codex` binding declared near line 128 — put this test after that declaration):

```js
test('linear registers as an HTTP server with per-adapter argv', () => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const claudeResults = provisionMcp({ adapters: claude, exec, check: false });
  assert.strictEqual(claudeResults.find((r) => r.item === 'linear').status, 'installed');
  assert.ok(calls.includes('claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp'));

  calls.length = 0;
  const codexResults = provisionMcp({ adapters: codex, exec, check: false });
  assert.strictEqual(codexResults.find((r) => r.item === 'linear').status, 'installed');
  assert.ok(calls.includes('codex mcp add linear --url https://mcp.linear.app/mcp'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. The `server catalog` test fails on the `deepStrictEqual` (actual list lacks `linear`), and `linear registers as an HTTP server` fails with a `TypeError` on `.status` of `undefined` because no `linear` row exists.

- [ ] **Step 3: Add the catalog entry**

In `lib/provisioners/mcp.js`, append to the `MCP_SERVERS` array (after the `embabel-guide` entry, before the closing `];`):

```js
  // Linear's official hosted MCP server — streamable HTTP, first-party, no local process and no
  // token in an env file. Verified against https://linear.app/docs/mcp (2026-08-25): the docs'
  // own client examples are `claude mcp add --transport http linear https://mcp.linear.app/mcp`
  // and `codex mcp add linear --url https://mcp.linear.app/mcp`, both of which our existing
  // type: 'http' mcpAddArgs already produce.
  //
  // needsAuth: OAuth 2.1 with dynamic client registration. `mcp add` succeeds with no credential
  // whatsoever, but every tool call fails until someone completes the browser sign-in via `/mcp`
  // in Claude Code — which this installer can never do for them. See provisionMcp for how that
  // state is reported. A read-only endpoint (https://mcp.linear.app/mcp/readonly) exists if write
  // access is ever unwanted; we deliberately register the read/write one.
  { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', needsAuth: true },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests. In particular the existing `check mode never calls add` test must still pass — with an unregistered `linear` it produces a `missing` row, which that test's `every(r => r.status === 'missing' || r.status === 'optional')` already allows.

- [ ] **Step 5: Commit**

```bash
git add lib/provisioners/mcp.js test/provisioner-mcp.test.js
git commit -m "feat: register the official Linear MCP server for every agent"
```

---

### Task 2: Report unauthorized OAuth servers honestly

**Files:**
- Modify: `lib/provisioners/mcp.js:22-37` (add `needsAuthOf`, extend `execBasedCheck`) and `:39-56` (the `provisionMcp` per-server flow)
- Test: `test/provisioner-mcp.test.js` (six new tests)

> **Correction:** the Step 1 code block below actually contains **seven** tests,
> not six — the count in this header was wrong when written. Seven were added.

**Interfaces:**
- Consumes: `server.needsAuth` from the Task 1 catalog entry.
- Produces:
  - `needsAuthOf(getOutput: string) => boolean` — module-private, not exported.
  - `execBasedCheck` and any `adapter.mcpCheckRegistered` now return `{ registered: boolean, scope: string|null, needsAuth?: boolean }`. The third field is optional: Gemini's `mcpCheckRegistered` (`lib/adapters/gemini.js:22-31`) returns it absent, which must be treated as "no auth problem known".

- [ ] **Step 1: Write the failing tests**

Add to the top of `test/provisioner-mcp.test.js`, after the existing `require` lines:

```js
const { exitCode } = require('../lib/report.js');

// Real shape of `claude mcp get <name>` stdout, captured on 2026-08-25. `status` is 0 for all
// three Status values — that is the whole reason these tests exist.
function claudeGetStdout(name, status, scope = 'User config (available in all your projects)') {
  return `${name}:\n  Scope: ${scope}\n  Status: ${status}\n  Type: http\n  URL: https://example.invalid/mcp\n`;
}

// A faked `claude` exec where `linear`'s `mcp get` returns the given Status line (exit 0, as the
// real CLI does) and every other server is unregistered.
function claudeExecWithLinearStatus(status, scope) {
  return (bin, args) => {
    if (args[1] === 'get' && args[2] === 'linear') {
      return { status: 0, stdout: claudeGetStdout('linear', status, scope), stderr: '' };
    }
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
}
```

Then append these six tests to the end of the file:

```js
// `claude mcp get` exits 0 whether the server is connected, unauthorized, or failing to connect
// (verified 2026-08-25 against the real `atlassian` server, registered at user scope but never
// authorized: `Status: ! Needs authentication`, exit 0). Reporting that as `unchanged` would be
// doctor lying about exactly the condition it exists to surface.
test('needsAuth server registered but unauthorized -> optional with a sign-in note', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication');
  const results = provisionMcp({ adapters: claude, exec, check: true });
  const linear = results.find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'optional');
  assert.match(linear.note, /not authorized/);
  assert.match(linear.note, /\/mcp/);
});

// `optional` rather than `missing`/`failed` is the point: doctor must not exit non-zero for a
// browser sign-in the installer cannot perform. Same precedent as moderneAuthRow in plugins.js.
// The row is isolated here because the other catalog servers are unregistered in this fake and
// would exit 1 on their own under strictMissing.
test('an unauthorized needsAuth row never affects the exit code', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(exitCode([linear], { strictMissing: true }), 0);
  assert.strictEqual(exitCode([linear]), 0);
});

test('needsAuth server that is authorized -> plain unchanged, no note', () => {
  const exec = claudeExecWithLinearStatus('✔ Connected');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'unchanged');
  assert.strictEqual(linear.note, undefined);
});

// `✘ Failed to connect` is transient for a hosted HTTP endpoint (a network blip). Treating it as
// an auth problem would make doctor flaky, so it must fall through to today's behaviour.
test('failed-to-connect is not an auth problem', () => {
  const exec = claudeExecWithLinearStatus('✘ Failed to connect');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'unchanged');
});

// A shadowing project/local-scope registration is a real misconfiguration the operator must fix,
// and it outranks any auth consideration.
test('project-scope shadowing beats the auth check', () => {
  const exec = claudeExecWithLinearStatus('! Needs authentication', 'Project config');
  const linear = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'failed');
  assert.match(linear.note, /project scope/i);
});

// The catalog flag gates the behaviour, not the presence of the string — an open server has no
// OAuth flow to complete, so there is nothing to tell the operator to do.
test('servers without needsAuth are unaffected by a needs-authentication status', () => {
  const exec = (bin, args) => {
    if (args[1] === 'get' && args[2] === 'javadocs') {
      return { status: 0, stdout: claudeGetStdout('javadocs', '! Needs authentication'), stderr: '' };
    }
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const javadocs = provisionMcp({ adapters: claude, exec, check: true }).find((r) => r.item === 'javadocs');
  assert.strictEqual(javadocs.status, 'unchanged');
});

// A fresh install cannot authorize the server, so the row must say what the operator does next.
test('installing a needsAuth server tells the operator to sign in', () => {
  const exec = (bin, args) => {
    if (args[1] === 'get') return { status: 1, stdout: '', stderr: 'not found' };
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  const results = provisionMcp({ adapters: claude, exec, check: false });
  const linear = results.find((r) => r.item === 'linear');
  assert.strictEqual(linear.status, 'installed');
  assert.match(linear.note, /\/mcp/);
  // An open server's install row stays note-free.
  assert.strictEqual(results.find((r) => r.item === 'javadocs').note, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. `needsAuth server registered but unauthorized` fails with actual `'unchanged'` vs expected `'optional'`; `installing a needsAuth server tells the operator to sign in` fails because `linear.note` is `undefined`, so `assert.match` throws on a non-string. The `authorized`, `failed-to-connect`, `project-scope` and `without needsAuth` tests already pass — they pin behaviour that must not regress.

- [ ] **Step 3: Add the status parse**

In `lib/provisioners/mcp.js`, immediately after `scopeOf` (line 26), add:

```js
// `claude mcp get` prints a `Status:` line and exits 0 no matter what it says. Verified
// 2026-08-25 on a real machine: the `atlassian` server, registered at user scope but never
// authorized, prints `Status: ! Needs authentication` and exits 0, while `javadocs` prints
// `Status: ✔ Connected` and also exits 0. So a zero exit is NOT proof the server is usable, and
// `registered` alone is not proof its tools work.
//
// Only the explicit needs-authentication state is recognised. `claude mcp list` has a third
// state, `✘ Failed to connect`, which is transient for the open HTTP servers in this catalog — a
// network blip must not be reported as an auth problem, or `doctor` becomes flaky for reasons
// unrelated to provisioning. Matching the words rather than the `!` glyph so a change of icon
// doesn't silently disable this.
function needsAuthOf(getOutput) {
  return /Status:.*Needs authentication/i.test(getOutput || '');
}
```

- [ ] **Step 4: Thread the flag through the check**

Replace the `return` in `execBasedCheck` (line 36) so the function ends:

```js
  const scope = registered ? scopeOf(get.stdout) : null;
  return { registered, scope, needsAuth: registered && needsAuthOf(get.stdout) };
}
```

- [ ] **Step 5: Use it in the per-server flow**

In `provisionMcp`, change the destructuring (currently line 47) to pull the third field:

```js
        const { registered, scope, needsAuth } = typeof adapter.mcpCheckRegistered === 'function'
          ? adapter.mcpCheckRegistered(server.name, home)
          : execBasedCheck(adapter, server, exec);
```

Then, between the existing scope-shadowing block and the `if (registered)` line, insert:

```js
        // Registered but the OAuth flow was never completed: the server is configured and yet
        // every tool call fails. `optional` deliberately — `missing` exits 1 on the doctor path
        // (strictMissing at lib/run.js:70) and `failed` always exits 1, and neither is right for
        // a browser sign-in this installer cannot perform on the operator's behalf. Same
        // reasoning as moderneAuthRow in plugins.js, whose comment records that `missing` made
        // doctor exit 1 on a correctly-configured machine.
        //
        // Only Claude ever reaches this branch today: gemini's mcpCheckRegistered reads
        // ~/.gemini/settings.json, which carries no auth state at all, and codex surfaces auth in
        // `codex mcp list` (an `Auth` column) but not in `codex mcp get`, with the unauthorized
        // string unverified as of 2026-08-25. Guessing it would be the same "trust the exit code"
        // bug the moderne comments in plugins.js exist to prevent, so those adapters simply
        // return needsAuth absent and fall through to `unchanged`.
        if (registered && server.needsAuth && needsAuth) {
          push('optional', 'registered but not authorized — run /mcp in Claude Code to sign in');
          continue;
        }
```

> **Superseded by commits b21a202 and the final fix wave (2026-08-25).** Both
> hardcoded `'... run /mcp in Claude Code ...'` strings in this step are wrong:
> the two `push` calls sit in the shared per-adapter loop with no adapter gate,
> so a codex or gemini row was told to run a Claude Code slash command that does
> not exist in those tools. The shipped code takes the wording from
> `adapter.authHint(server.name)` — a **function** taking the server name,
> because two of the three real commands need it (`codex mcp login linear`,
> gemini's `/mcp auth linear`; Claude's `/mcp` ignores the argument). The
> `optional` note is `registered but not authorized — ${authHint}`, and the
> `installed` note is the hint alone. An adapter that omits `authHint` drops the
> clause rather than rendering `undefined`. Read the two comment blocks in
> `lib/provisioners/mcp.js` and each adapter's `authHint` for the real contract.

Finally, replace the install block's last two lines (currently `const add = ...` and the `push(...)` after it) with:

```js
        const add = exec(adapter.binary, addArgs);
        if (add.status !== 0) { push('failed', add.stderr.trim()); continue; }
        // A fresh `mcp add` of an OAuth server leaves it registered-but-unauthorized, so the row
        // has to name the next action rather than implying the setup is finished.
        push('installed', server.needsAuth ? 'authorize with /mcp in Claude Code' : undefined);
```

> **Superseded** by the same note above: shipped as
> `push('installed', server.needsAuth ? (authHint || undefined) : undefined)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests including every pre-existing one. The Gemini tests matter most here — they assert `unchanged`/`missing` rows through `mcpCheckRegistered`, which returns no `needsAuth` field, proving the destructured `undefined` is handled.

- [ ] **Step 7: Commit**

```bash
git add lib/provisioners/mcp.js test/provisioner-mcp.test.js
git commit -m "fix: report registered-but-unauthorized MCP servers instead of claiming unchanged"
```

---

### Task 3: Document it and bump the version

**Files:**
- Modify: `README.md:102-119` (the MCP servers section)
- Modify: `package.json:3` (version)

**Interfaces:**
- Consumes: the `linear` catalog entry and the `optional` auth row from Tasks 1 and 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the README table row**

In `README.md`, insert after the `javadocs` row of the MCP servers table:

```markdown
| `linear` | HTTP (`mcp.linear.app`) | OAuth (interactive, first use) | Linear issues, projects and comments |
```

- [ ] **Step 2: Update the catalog prose**

Replace the sentence beginning "`playwright`, `excalidraw`, `javadocs` and `embabel-guide` are" with:

```markdown
`playwright`, `excalidraw`, `javadocs`, `linear` and `embabel-guide` are
`agent-setup`'s own catalog (`MCP_SERVERS` in `lib/provisioners/mcp.js`).
```

Leave the rest of that paragraph (the `moderne` explanation) untouched.

- [ ] **Step 3: Document the OAuth behaviour**

Add after the existing paragraph about project/local scope shadowing:

```markdown
`linear` is the only catalog server needing credentials, and it uses OAuth, so
registration and authorization are separate steps: `install` registers it, then
you sign in once with `/mcp` in Claude Code. Until you do, `doctor` reports it
as `optional` — "registered but not authorized" — rather than `unchanged`,
because the server is configured but its tools do not work. That row never
affects the exit code, since the sign-in is a browser flow `agent-setup` cannot
perform for you. Auth state is only reported for Claude Code: Gemini's config
file records no auth state, and Codex reports it in `codex mcp list` but not
`codex mcp get`.

If you would rather agents never write to your tracker, swap the URL for
`https://mcp.linear.app/mcp/readonly` — same server, search and read only.
```

- [ ] **Step 4: Bump the version**

In `package.json`, change `"version": "0.3.0"` to `"version": "0.4.0"`. `.github/workflows/release.yml` publishes on merge to main only when this version is not already on npm, so the bump is what ships the change.

- [ ] **Step 5: Verify the whole suite and the docs claims**

Run: `npm test && npm run lint:skills`
Expected: PASS both.

Then confirm the README's new claims match the code, since this is the file most likely to drift:

Run: `grep -n "mcp.linear.app" README.md lib/provisioners/mcp.js`
Expected: the README mentions both `mcp.linear.app` (table) and `mcp.linear.app/mcp/readonly` (escape hatch); `mcp.js` contains only the read/write `https://mcp.linear.app/mcp` as the registered URL.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json
git commit -m "docs: document the linear MCP server and its OAuth step"
```

---

## Manual verification (after Task 3)

The unit tests fake `exec`, so they prove the logic but never touch a real CLI. Run this once against the real binaries — it is how the `Status:` findings in the spec were obtained in the first place:

```bash
node bin/agent-setup.js install --tools claude
claude mcp get linear          # expect: Scope: User config, Status: ! Needs authentication
node bin/agent-setup.js doctor --tools claude ; echo "exit=$?"
```

Expected: the `doctor` run shows `linear  claude  optional  registered but not authorized — run /mcp in Claude Code to sign in`, and `exit=0`. Then sign in with `/mcp` in an interactive Claude Code session, re-run `doctor`, and expect `linear  claude  unchanged`.

Report the actual output rather than assuming — if `claude mcp get` has reformatted its `Status:` line since 2026-08-25, this is the step that catches it, and the failure mode is a silent fall-through to `unchanged`.

> **Executed 2026-08-25** (it had been skipped when the branch was first landed).
> Real output is recorded in
> `.superpowers/sdd/2026-08-25-linear-mcp/final-fix-report.md`. Note that the
> expected `doctor` note in the block above is now adapter-specific — see the
> superseded-note annotations under Task 2 Step 5.
