'use strict';
const fs = require('node:fs');
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
  if (!skip('plugins')) results.push(...(await provisionPlugins({ exec: realExec, check, yes: args.yes, prompt: makePrompt(args.yes), home })));

  // Doctor-only extra check: the shared-secrets env file the work installer manages. This only
  // applies to the real home directory — under --target (smoke test / CI, a fresh tmp dir) the
  // file will never exist, and with strictMissing doctor exit semantics that would make the
  // smoke test's post-install doctor run fail spuriously. So we only check when --target was NOT
  // supplied, i.e. we're actually inspecting the real machine.
  if (check && !args.target) {
    const envFile = path.join(home, 'workspace', 'simonjamesrowe', 'env');
    const exists = fs.existsSync(envFile);
    results.push({
      provisioner: 'env',
      item: 'workspace env file',
      tool: '-',
      status: exists ? 'unchanged' : 'missing',
      note: '~/workspace/simonjamesrowe/env holds shared secrets',
    });
  }

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
