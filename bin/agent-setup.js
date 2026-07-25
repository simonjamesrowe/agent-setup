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
  const { run } = require('../lib/run.js');
  process.exitCode = await run(args);
}

module.exports = { parseArgs, USAGE };
if (require.main === module) main();
