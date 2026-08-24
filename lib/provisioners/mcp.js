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
];

function scopeOf(getOutput) {
  const m = /Scope:\s*(User|Local|Project)/i.exec(getOutput || '');
  return m ? m[1].toLowerCase() : null;
}

// Default check strategy: run the adapter's `mcp get`/`mcp list` CLI call and look for the
// server name (and a `Scope:` line) in stdout. Adapters whose CLI output is unreliable as a
// check source (see lib/adapters/gemini.js) can instead expose `mcpCheckRegistered(name, home)`
// to bypass this entirely.
function execBasedCheck(adapter, server, exec) {
  const get = exec(adapter.binary, adapter.mcpGetArgs(server.name));
  const registered = get.status === 0 && get.stdout.includes(server.name);
  const scope = registered ? scopeOf(get.stdout) : null;
  return { registered, scope };
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
        const { registered, scope } = typeof adapter.mcpCheckRegistered === 'function'
          ? adapter.mcpCheckRegistered(server.name, home)
          : execBasedCheck(adapter, server, exec);
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
