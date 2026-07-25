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
