'use strict';
const MCP_SERVERS = [
  { name: 'playwright', type: 'stdio', command: ['npx', '-y', '@playwright/mcp@latest'] },
  { name: 'excalidraw', type: 'http', url: 'https://mcp.excalidraw.com/mcp' },
  // javadocs.dev — Java/Kotlin/Scala API docs resolved from Maven Central: latest artifact
  // version, javadoc-jar contents, and per-symbol documentation. Open endpoint, no auth.
  { name: 'javadocs', type: 'http', url: 'https://www.javadocs.dev/mcp' },
  // Opt-in only (`--with embabel-guide`). Embabel's docs server is a local Spring Boot + Neo4j
  // app you run yourself and it costs LLM tokens per query, so registering it unconditionally
  // would leave a dead server configured on every machine. See the embabel-guide skill.
  { name: 'embabel-guide', type: 'stdio', optional: true,
    // `-y` is not optional: without it, on a machine where `mcp-remote` isn't already in the npx
    // cache, npx prompts to confirm the install. An MCP client launches this over non-TTY stdio,
    // so that prompt can never be answered and the server just fails to start — looking like a
    // `guide` fault rather than an npx one. Verified 2026-08-21 against embabel/guide's own README,
    // which uses the `-y` form in every client config it documents. This argv is duplicated in
    // test/provisioner-mcp.test.js and components/skills/embabel-guide/SKILL.md — keep all three
    // in step.
    command: ['npx', '-y', 'mcp-remote', 'http://localhost:1337/sse', '--transport', 'sse-only'] },
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
];

function scopeOf(getOutput) {
  const m = /Scope:\s*(User|Local|Project)/i.exec(getOutput || '');
  return m ? m[1].toLowerCase() : null;
}

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

// Default check strategy: run the adapter's `mcp get`/`mcp list` CLI call and look for the
// server name (and a `Scope:` line) in stdout. Adapters whose CLI output is unreliable as a
// check source (see lib/adapters/gemini.js) can instead expose `mcpCheckRegistered(name, home)`
// to bypass this entirely.
function execBasedCheck(adapter, server, exec) {
  const get = exec(adapter.binary, adapter.mcpGetArgs(server.name));
  const registered = get.status === 0 && get.stdout.includes(server.name);
  const scope = registered ? scopeOf(get.stdout) : null;
  return { registered, scope, needsAuth: registered && needsAuthOf(get.stdout) };
}

function provisionMcp({ adapters, exec, check, home, with: optIns = [] }) {
  const results = [];
  for (const adapter of adapters) {
    for (const server of MCP_SERVERS) {
      const push = (status, note) => results.push({ provisioner: 'mcp', item: server.name, tool: adapter.key, status, note });
      try {
        if (server.optional && !optIns.includes(server.name)) {
          push('optional', `opt in with: --with ${server.name}`);
          continue;
        }
        const { registered, scope, needsAuth } = typeof adapter.mcpCheckRegistered === 'function'
          ? adapter.mcpCheckRegistered(server.name, home)
          : execBasedCheck(adapter, server, exec);
        if (registered && scope && scope !== 'user') {
          push('failed', `registered at ${scope} scope which shadows user scope — run: ${adapter.binary} mcp remove ${server.name} -s ${scope}, then re-run install`);
          continue;
        }
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
        if (registered) { push('unchanged'); continue; }
        if (check) { push('missing'); continue; }
        const addArgs = adapter.mcpAddArgs(server);
        if (!addArgs) { push('skipped', `http servers unsupported by ${adapter.key} CLI — add manually`); continue; }
        const add = exec(adapter.binary, addArgs);
        if (add.status !== 0) { push('failed', add.stderr.trim()); continue; }
        // A fresh `mcp add` of an OAuth server leaves it registered-but-unauthorized, so the row
        // has to name the next action rather than implying the setup is finished.
        push('installed', server.needsAuth ? 'authorize with /mcp in Claude Code' : undefined);
      } catch (err) {
        push('failed', err.message);
      }
    }
  }
  return results;
}
module.exports = { provisionMcp, MCP_SERVERS };
