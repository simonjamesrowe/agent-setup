'use strict';
const fs = require('node:fs');
const path = require('node:path');

// `claude plugin list --json` (verified against claude-cli 2026-07-25) returns an array of
// installed plugins, each shaped like:
//   { "id": "mattpocock-skills@mattpocock", "enabled": true, ... }
// This is far more robust than parsing the human-readable `claude plugin list` text output,
// which renders as an indented, multi-line block per plugin (not a single
// `name@marketplace ... enabled` line as previously assumed):
//   Installed plugins:
//
//     ❯ spring-tools@spring-tools-marketplace
//       Version: 2.2.0
//       Scope: user
//       Status: ✔ enabled
function findPlugin(listOutput, name) {
  let parsed;
  try {
    parsed = JSON.parse(listOutput || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  for (const entry of parsed) {
    const id = entry && entry.id;
    if (typeof id !== 'string') continue;
    const at = id.indexOf('@');
    if (at === -1) continue;
    const entryName = id.slice(0, at);
    const marketplace = id.slice(at + 1);
    if (entryName === name) return { marketplace, enabled: Boolean(entry.enabled) };
  }
  return null;
}

async function confirmStep(prompt, yes, question) {
  if (yes) return true;
  return prompt(question, true);
}

async function confirmInstall(prompt, yes, item) {
  return confirmStep(prompt, yes, `Install ${item}?`);
}

// Shared flow for plugins that live in a `claude plugin list` marketplace: mattpocock-skills and
// spring-tools. `installSteps` is an ordered list of `claude` CLI argv arrays run to get the
// plugin installed — both of today's callers need a `marketplace add` before `plugin install`,
// since neither ships in the built-in `claude-plugins-official` marketplace. After a successful
// install, if the plugin was already present-but-
// disabled, it is enabled using the marketplace parsed from the *original* list output (plugins
// can ship in more than one marketplace, so this is never hardcoded).
async function provisionClaudePlugin({ exec, check, yes, prompt, item, installSteps }) {
  const list = exec('claude', ['plugin', 'list', '--json']);
  const found = findPlugin(list.stdout, item);
  if (found && found.enabled) return { status: 'unchanged' };
  if (check) return { status: 'missing' };

  const proceed = await confirmInstall(prompt, yes, item);
  if (!proceed) return { status: 'skipped', note: 'declined' };

  for (const args of installSteps) {
    const res = exec('claude', args);
    if (res.status !== 0) return { status: 'failed', note: (res.stderr || '').trim() };
  }

  if (found && !found.enabled) {
    const enable = exec('claude', ['plugin', 'enable', `${item}@${found.marketplace}`]);
    if (enable.status !== 0) return { status: 'failed', note: (enable.stderr || '').trim() };
    return { status: 'updated' };
  }
  return { status: 'installed' };
}

// `codex plugin list --json` (verified against codex-cli 0.150.1, 2026-09-06) returns
//   { "installed": [ { "pluginId": "mattpocock-skills@mattpocock", "name": "mattpocock-skills",
//                      "marketplaceName": "mattpocock", "installed": true, "enabled": true, ... } ],
//     "available": [ ... ] }
// Only genuinely-installed plugins appear under `installed`; `available` lists marketplace entries
// that are NOT installed, so it must be ignored or every plugin in every configured marketplace
// would read as present. Shape differs from Claude's (an object with two arrays, and a separate
// `name`/`marketplaceName` pair rather than a single `name@marketplace` id string), which is why
// this is a second parser rather than a reuse of findPlugin.
function findCodexPlugin(listOutput, name) {
  let parsed;
  try {
    parsed = JSON.parse(listOutput || '{}');
  } catch {
    return null;
  }
  const installed = parsed && Array.isArray(parsed.installed) ? parsed.installed : [];
  for (const entry of installed) {
    if (!entry || entry.name !== name) continue;
    return { marketplace: entry.marketplaceName || null, enabled: entry.enabled !== false };
  }
  return null;
}

// Codex's plugin CLI mirrors Claude's closely enough to share this shape, with two differences
// that matter (both verified against `codex plugin --help`, codex-cli 0.150.1, 2026-09-06):
//   - the install verb is `plugin add`, not `plugin install`;
//   - there is NO `plugin enable`. The subcommands are add/list/marketplace/remove only. So an
//     installed-but-disabled plugin cannot be re-enabled from here the way provisionClaudePlugin
//     does; we re-run the add and then re-probe, and report `failed` if it is still not enabled
//     rather than claiming a success we did not verify.
// The re-probe is deliberate and mirrors provisionModerne below: on this codebase's own evidence
// an exit code of 0 from an agent-tooling CLI is not proof the state actually changed.
async function provisionCodexPlugin({ exec, check, yes, prompt, item, installSteps }) {
  const found = findCodexPlugin(exec('codex', ['plugin', 'list', '--json']).stdout, item);
  if (found && found.enabled) return { status: 'unchanged' };
  if (check) return { status: 'missing', ...(found ? { note: 'installed but disabled' } : {}) };

  const proceed = await confirmInstall(prompt, yes, `${item} (codex)`);
  if (!proceed) return { status: 'skipped', note: 'declined' };

  for (const args of installSteps) {
    const res = exec('codex', args);
    if (res.status !== 0) return { status: 'failed', note: (res.stderr || '').trim() };
  }

  const after = findCodexPlugin(exec('codex', ['plugin', 'list', '--json']).stdout, item);
  if (!after || !after.enabled) {
    return { status: 'failed', note: `codex reported success but ${item} is still ${after ? 'disabled' : 'not installed'}` };
  }
  return { status: found ? 'updated' : 'installed' };
}

// Gemini CLI has no plugin or marketplace mechanism at all — `gemini extensions` takes a
// different manifest format, and there is no `gemini plugin`. What it does have is
// `gemini skills install <git-url> --path <subdir>` (`gemini skills install --help`, gemini-cli
// 0.49.0), which clones the repo once and installs every SKILL.md found beneath that one
// subdirectory into ~/.gemini/skills. That is how the same skill set reaches Gemini.
//
// Two flags are load-bearing:
//   - `--consent` — without it the command blocks on an interactive confirmation prompt, which a
//     non-TTY spawnSync can never answer, so the install would hang rather than fail.
//   - `--scope user` — the default is already user, but stating it keeps these skills in the same
//     home-directory scope as everything else agent-setup provisions.
// Verified idempotent 2026-09-06: a second run prints `Skill "x" already exists. Overwriting...`
// and exits 0, so re-running install is safe.
//
// Note the co-tenancy: these land in the SAME directory that provisionSkills fans
// components/skills/ into. There is no name collision today (checked against all 18 org skills),
// and provisionSkills only ever writes the directories it owns, so neither set clobbers the
// other. If upstream ever adds a skill whose name matches one of ours, provisionSkills runs first
// and this call would overwrite it — worth checking when bumping the pinned list below.
async function provisionGeminiSkillSet({ exec, check, yes, prompt, home, adapter, item, repoUrl, paths, skillNames }) {
  const dir = adapter.skillsDir(home);
  const absent = () => skillNames.filter((n) => !fs.existsSync(path.join(dir, n)));
  const missing = absent();
  if (!missing.length) return { status: 'unchanged' };
  if (check) return { status: 'missing', note: `${missing.length} of ${skillNames.length} skills absent from ${dir}` };

  const proceed = await confirmInstall(prompt, yes, `${item} (${skillNames.length} skills for gemini)`);
  if (!proceed) return { status: 'skipped', note: 'declined' };

  for (const p of paths) {
    const res = exec('gemini', ['skills', 'install', repoUrl, '--path', p, '--scope', 'user', '--consent']);
    if (res.status !== 0) return { status: 'failed', note: (res.stderr || '').trim() };
  }

  // Re-probe on disk rather than trusting the exit code — same reasoning as everywhere else in
  // this file, and here it is the only check that can catch upstream moving a skill directory.
  const stillMissing = absent();
  if (stillMissing.length) {
    return { status: 'failed', note: `gemini reported success but still absent: ${stillMissing.join(', ')}` };
  }
  return { status: missing.length === skillNames.length ? 'installed' : 'updated' };
}

// Matt Pocock's skills (https://github.com/mattpocock/skills, MIT) — the replacement for
// superpowers as this org's process layer. Installed from upstream rather than vendored into
// components/skills/ so it tracks the source: `plugin update` / re-running install picks up new
// releases, and nothing here has to be kept manually in step with a copy.
const MATTPOCOCK_REPO = 'mattpocock/skills';
const MATTPOCOCK_REPO_URL = 'https://github.com/mattpocock/skills';
const MATTPOCOCK_PLUGIN = 'mattpocock-skills';
// The marketplace name comes from the repo's own .claude-plugin/marketplace.json (`"name":
// "mattpocock"`), not from the repo name — the two differ here, so it is never derived.
const MATTPOCOCK_MARKETPLACE = 'mattpocock';
// Codex reads Claude-format marketplaces. Verified 2026-09-06 on codex-cli 0.150.1:
// `codex plugin marketplace add mattpocock/skills` resolved the repo's
// .claude-plugin/marketplace.json and registered the marketplace as `mattpocock`, and
// `codex plugin add mattpocock-skills@mattpocock` installed v1.2.3. So the README's old claim
// that plugin marketplaces are Claude-only is out of date for Codex; it remains true for Gemini.
const MATTPOCOCK_CLAUDE_STEPS = [
  ['plugin', 'marketplace', 'add', MATTPOCOCK_REPO],
  ['plugin', 'install', `${MATTPOCOCK_PLUGIN}@${MATTPOCOCK_MARKETPLACE}`],
];
const MATTPOCOCK_CODEX_STEPS = [
  ['plugin', 'marketplace', 'add', MATTPOCOCK_REPO],
  ['plugin', 'add', `${MATTPOCOCK_PLUGIN}@${MATTPOCOCK_MARKETPLACE}`],
];
// Gemini gets the same set one directory at a time. These two paths are NOT `skills/` — the
// repo also carries skills/in-progress (8) and skills/misc (4) which the plugin's own
// .claude-plugin/plugin.json deliberately excludes, so installing `--path skills` would
// over-install by 12 skills relative to what Claude and Codex get.
const MATTPOCOCK_GEMINI_PATHS = ['skills/engineering', 'skills/productivity'];
// Pinned from mattpocock-skills 1.2.3's plugin.json `skills` array (2026-09-06): 18 engineering
// + 7 productivity = 25. Used only as the presence check for Gemini, where there is no CLI that
// can answer "is this plugin installed?" — the check is "do all 25 directories exist". A skill
// added upstream will not be detected as missing until this list is bumped; that is the accepted
// cost of Gemini having no plugin manifest to interrogate.
const MATTPOCOCK_SKILL_NAMES = [
  'ask-matt', 'code-review', 'codebase-design', 'diagnosing-bugs', 'domain-modeling',
  'grill-with-docs', 'implement', 'improve-codebase-architecture', 'prototype', 'research',
  'resolving-merge-conflicts', 'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets',
  'triage', 'wayfinder', 'wizard',
  'grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what', 'writing-for-agents',
];

// One row per detected agent, three mechanisms, the same 25 skills. `grill-me` itself is the
// user-invoked entry point (it ships `disable-model-invocation: true`, so Claude and Codex both
// hide it from the model's skill list and only surface it when you type it); the model-visible
// half is `grilling`, which carries the actual design-tree interview loop.
async function provisionMattpocock({ exec, check, yes, prompt, home, adapter }) {
  const common = { exec, check, yes, prompt, item: MATTPOCOCK_PLUGIN };
  if (adapter.key === 'claude') return provisionClaudePlugin({ ...common, installSteps: MATTPOCOCK_CLAUDE_STEPS });
  if (adapter.key === 'codex') return provisionCodexPlugin({ ...common, installSteps: MATTPOCOCK_CODEX_STEPS });
  if (adapter.key === 'gemini') {
    return provisionGeminiSkillSet({
      ...common, home, adapter,
      repoUrl: MATTPOCOCK_REPO_URL,
      paths: MATTPOCOCK_GEMINI_PATHS,
      skillNames: MATTPOCOCK_SKILL_NAMES,
    });
  }
  return { status: 'skipped', note: `no mattpocock-skills mechanism for ${adapter.key}` };
}

// One-release migration, added in 1.0.0. superpowers used to be installed by this tool for Claude
// Code, and OpenAI's own `openai-curated` marketplace offers it to Codex as well. It has been
// dropped in favour of mattpocock-skills, and `install` actively UNINSTALLS it rather than merely
// ceasing to manage it: an orphaned superpowers keeps injecting its SessionStart block into every
// session, which is precisely the standing context cost this change exists to remove. Delete this
// function and its rows once every machine has run 1.x at least once.
//
// `missing` on the check path is deliberate and is the one place in this codebase where it means
// "present, and should not be" rather than "absent". It is the only status lib/report.js counts
// towards doctor's non-zero exit (strictMissing in lib/run.js), which is the correct signal for
// "superpowers is still installed here". The note spells that out so the table is never misread.
const SUPERPOWERS = 'superpowers';
const SUPERPOWERS_REMOVAL = {
  claude: { find: findPlugin, remove: (mp) => ['plugin', 'uninstall', `${SUPERPOWERS}@${mp}`] },
  codex: { find: findCodexPlugin, remove: (mp) => ['plugin', 'remove', `${SUPERPOWERS}@${mp}`] },
};

async function removeSuperpowers({ exec, check, yes, prompt, adapters }) {
  const rows = [];
  for (const adapter of adapters) {
    // Gemini has no plugin mechanism, so superpowers was never installable there and there is
    // nothing to remove — no row at all, rather than a noise row saying "not applicable".
    const spec = SUPERPOWERS_REMOVAL[adapter.key];
    if (!spec) continue;
    const listArgv = ['plugin', 'list', '--json'];
    const binary = adapter.binary || adapter.key;
    const found = spec.find(exec(binary, listArgv).stdout, SUPERPOWERS);
    if (!found) { rows.push({ tool: adapter.key, status: 'unchanged', note: 'not installed' }); continue; }
    if (check) { rows.push({ tool: adapter.key, status: 'missing', note: 'still installed — run install to remove it' }); continue; }

    const proceed = await confirmStep(prompt, yes, `Uninstall superpowers from ${adapter.key} (replaced by ${MATTPOCOCK_PLUGIN})?`);
    if (!proceed) { rows.push({ tool: adapter.key, status: 'skipped', note: 'declined' }); continue; }

    const res = exec(binary, spec.remove(found.marketplace));
    if (res.status !== 0) { rows.push({ tool: adapter.key, status: 'failed', note: (res.stderr || '').trim() }); continue; }
    if (spec.find(exec(binary, listArgv).stdout, SUPERPOWERS)) {
      rows.push({ tool: adapter.key, status: 'failed', note: `${binary} reported success but superpowers is still installed` });
      continue;
    }
    rows.push({ tool: adapter.key, status: 'updated', note: 'removed' });
  }
  return rows;
}

async function provisionSpeckit({ exec, check, yes, prompt }) {
  const ver = exec('specify', ['--version']);
  if (ver.status === 0) return { status: 'unchanged' };
  if (check) return { status: 'missing' };

  const proceed = await confirmInstall(prompt, yes, 'speckit');
  if (!proceed) return { status: 'skipped', note: 'declined' };

  const uv = exec('uv', ['--version']);
  if (uv.status !== 0) return { status: 'skipped', note: 'install uv first: https://docs.astral.sh/uv/' };

  const install = exec('uv', ['tool', 'install', 'specify-cli', '--from', 'git+https://github.com/github/spec-kit.git']);
  if (install.status !== 0) return { status: 'failed', note: (install.stderr || '').trim() };
  return { status: 'installed' };
}

// Verified against the real Moderne CLI (`brew install moderneinc/moderne/mod`, mod 4.6.3,
// 2026-08-21): `mod config agent-tools install` registers the local Moderne MCP server with each
// supported agent (it shells out to `claude mcp add` itself, and `claude mcp get moderne` /
// `claude mcp list` confirm the server is registered as `moderne`, command
// `/opt/homebrew/bin/mod mcp`) and installs Moderne's skills into that agent's marketplace
// directory. So there is nothing to register by hand here — we only ensure `mod` exists and has
// been pointed at the agents.
//
// Deliberately NOT using the blanket form, though. Re-verified 2026-08-21 against
// `mod config agent-tools --help` and `mod config agent-tools claude --help` on this machine
// (mod 4.6.3): the blanket `mod config agent-tools install` provisions ALL EIGHT agents Moderne
// supports (Claude Code, Windsurf, Cursor, GitHub Copilot, GitHub Copilot CLI, Sourcegraph Amp,
// OpenAI Codex, opencode) regardless of which agents agent-setup was asked to provision, and it
// writes into the *current working directory* — running it inside a project checkout created
// `.github/instructions/moderne-*.instructions.md` (10 Copilot files) and `.vscode/mcp.json`
// inside that repo. `agent-setup install` must never pollute whatever repo the user happens to be
// running it from. Per-agent subcommands exist instead (`claude`, `windsurf`, `cursor`,
// `copilot`, `amp`, `codex`, `opencode`) and are scoped to that one agent's home-directory config
// — `mod config agent-tools claude --help` documents that the `claude` form "installs skills as a
// Claude Code plugin under ~/.claude/marketplaces/moderne/ and registers the MCP server via the
// 'claude' CLI". So we run `mod config agent-tools <agent> install` once per supported agent that
// actually needs it. Do NOT "simplify" this back to the blanket call — that is the bug this
// comment exists to prevent.
const MODERNE_MCP_SERVER = 'moderne';
// Moderne's per-agent subcommands (`mod config agent-tools --help`, mod 4.6.3, 2026-08-21):
// claude, windsurf, cursor, copilot, amp, codex, opencode. Gemini CLI is NOT among them, so we
// report that gap rather than pretending to provision it.
const MODERNE_AGENTS = ['claude', 'codex'];
// Read-only credential status (`mod config moderne --help` / `mod config moderne show`, mod
// 4.6.3, 2026-08-21): with no tenant configured this exits non-zero ("No Moderne tenant has been
// configured") and never prints a token; it only ever shows the configured tenant URL.
const MODERNE_AUTH_ARGV = ['config', 'moderne', 'show'];

// The note must not claim a credential is required. Re-verified 2026-08-21: Maven Central serves
// `rewrite-spring:6.37.1`, the same latest release the OpenRewrite version table lists, so the
// Spring Boot 4 recipe resolves with no credential at all — see README's Moderne section and the
// spring-boot-upgrade skill, which both say so. A Code Genome Project token only matters for a
// recipe release newer than Central carries, and it is issued by Moderne rather than being
// self-service, so it may be unobtainable. An unconfigured tenant is therefore NOT a broken
// setup: callers report this as `optional`, which lib/report.js excludes from the exit code.
function moderneAuthStatus(exec) {
  const res = exec('mod', MODERNE_AUTH_ARGV);
  if (res.status !== 0 || !res.stdout.trim()) {
    return { configured: false, note: 'no Moderne tenant configured — only needed for recipe releases newer than Maven Central carries; see the spring-boot-upgrade skill' };
  }
  return { configured: true };
}

// The doctor row for the above. `optional`, never `missing`: `optional` is the project's existing
// "not enabled, and that is not a problem" status (see MCP_SERVERS' opt-in rows) and lib/report.js
// excludes it from the exit code. Reporting `missing` here made `doctor` exit 1 on a machine that
// is correctly configured. Kept here rather than inlined in run.js so it is unit-testable without
// exec'ing the real `mod` binary.
function moderneAuthRow(exec) {
  const auth = moderneAuthStatus(exec);
  return {
    provisioner: 'env',
    item: 'moderne auth',
    tool: '-',
    status: auth.configured ? 'unchanged' : 'optional',
    ...(auth.note ? { note: auth.note } : {}),
  };
}

// Registration is probed per agent, via that agent's OWN binary (`claude mcp get moderne`,
// `codex mcp get moderne`, ...) — never the `mod` binary. This is what surfaced finding 1 live on
// this machine: Claude Code genuinely has the `moderne` server registered but Codex doesn't, so a
// single combined `every(...)` check was reporting Claude as `missing` too. Each supported agent
// now gets its own status row reflecting its own binary's answer.
function isModerneRegistered(exec, agent) {
  const get = exec(agent.binary || agent.key, ['mcp', 'get', MODERNE_MCP_SERVER]);
  return get.status === 0 && get.stdout.includes(MODERNE_MCP_SERVER);
}

// Applied whenever the install flow stops partway (declined prompt, missing Homebrew, or a
// failed step): agents that were already registered are genuinely fine and stay `unchanged`;
// only the ones that still need work get the given not-done status/note. A failed `claude
// install` must never be papered over as success for `codex`, and a still-pending `codex` must
// never borrow `claude`'s good state — each row is decided from that agent's own registeredMap
// entry.
function settleRemaining(supported, registeredMap, notDoneStatus, note) {
  return supported.map((a) => (
    registeredMap.get(a.key)
      ? { tool: a.key, status: 'unchanged' }
      : { tool: a.key, status: notDoneStatus, ...(note ? { note } : {}) }
  ));
}

async function provisionModerne({ exec, check, yes, prompt, adapters }) {
  const supported = adapters.filter((a) => MODERNE_AGENTS.includes(a.key));
  const unsupported = adapters.filter((a) => !MODERNE_AGENTS.includes(a.key));
  const rows = unsupported.map((a) => ({ tool: a.key, status: 'skipped', note: `not supported by mod config agent-tools (supports ${MODERNE_AGENTS.join(', ')})` }));
  if (!supported.length) {
    // Only emit the placeholder `-` row when there is nothing else to say. A gemini-only run
    // already gets an explanatory `gemini / skipped / not supported by ...` row, and adding a
    // second `- / skipped / no supported agent selected` row on top of it is pure noise.
    if (!rows.length) {
      rows.push({ tool: '-', status: 'skipped', note: `no supported agent selected (needs one of ${MODERNE_AGENTS.join(', ')})` });
    }
    return rows;
  }

  const cliPresent = exec('mod', ['--version']).status === 0;
  const registeredMap = new Map(supported.map((a) => [a.key, isModerneRegistered(exec, a)]));
  const allRegistered = supported.every((a) => registeredMap.get(a.key));

  if (cliPresent && allRegistered) {
    return [...rows, ...supported.map((a) => ({ tool: a.key, status: 'unchanged' }))];
  }
  // `cliPresent` matters on the check path too, not just the install path. Verified 2026-08-21:
  // `mod config agent-tools claude install` registers the MCP server with command
  // `/opt/homebrew/bin/mod mcp`, so if `mod` is later removed (uninstalled, or a Homebrew prefix
  // change) the registration survives and both agents fail to start the server. Reporting those
  // agents as `unchanged` — which this branch used to do, because it only consulted registeredMap
  // — is doctor lying about exactly the condition it exists to surface. `install` is unaffected:
  // it brews `mod` first and then legitimately reports `unchanged`.
  if (check) {
    return [...rows, ...supported.map((a) => {
      const registered = registeredMap.get(a.key);
      if (cliPresent) return { tool: a.key, status: registered ? 'unchanged' : 'missing' };
      return {
        tool: a.key,
        status: 'missing',
        note: registered
          ? 'mod not on PATH — the registered moderne MCP server runs `mod mcp` and cannot start; run install'
          : 'mod not on PATH',
      };
    })];
  }

  const proceed = await confirmInstall(prompt, yes, 'moderne (OpenRewrite CLI, MCP server and skills)');
  if (!proceed) return [...rows, ...settleRemaining(supported, registeredMap, 'skipped', 'declined')];

  if (!cliPresent) {
    if (exec('brew', ['--version']).status !== 0) {
      return [...rows, ...settleRemaining(supported, registeredMap, 'skipped', 'install Homebrew first: https://brew.sh')];
    }
    const brew = exec('brew', ['install', 'moderneinc/moderne/mod']);
    if (brew.status !== 0) {
      return [...rows, ...settleRemaining(supported, registeredMap, 'failed', (brew.stderr || '').trim())];
    }
  }

  // One `mod config agent-tools <agent> install` call per agent that still needs it — see the
  // verified-behaviour comment above the constants for why the blanket `install` form is never
  // used. A failed install for one agent does not affect the others: each is its own row.
  //
  // Verified live on this machine, 2026-08-21 (mod 4.6.3): `mod config agent-tools codex install`
  // exited 0 and printed "OpenAI Codex was not detected. Nothing to install." — Codex.app is
  // installed and `codex` is on PATH (which is why agent-setup selected it as a supported agent),
  // but mod's own agent-detection did not recognise it. So the exit code is NOT proof that the
  // server got registered: `install` had reported this row as `installed` while the very next
  // `doctor` run correctly reported it `missing`, for the same machine, the same agent. That is
  // why every install step that exits 0 is re-probed via the agent's own binary
  // (isModerneRegistered) before deciding the row — never inferred from the exit code alone. Do
  // NOT "simplify" this back to trusting `res.status === 0`; that is the bug this comment exists
  // to prevent.
  const finalRows = [];
  for (const a of supported) {
    if (registeredMap.get(a.key)) {
      finalRows.push({ tool: a.key, status: 'unchanged' });
      continue;
    }
    const res = exec('mod', ['config', 'agent-tools', a.key, 'install']);
    if (res.status !== 0) {
      finalRows.push({ tool: a.key, status: 'failed', note: (res.stderr || '').trim() });
      continue;
    }
    if (isModerneRegistered(exec, a)) { finalRows.push({ tool: a.key, status: 'installed' }); continue; }

    // Fallback for exactly the defect the comment above describes. When mod's own agent
    // detection misses an agent it still exits 0, leaving the row permanently `failed` with no
    // way for `install` to fix it — which is where `moderne / codex / FAILED` came from on this
    // machine. There is nothing mod-specific about the registration itself, though: it is an
    // ordinary stdio MCP server whose argv is `<mod> mcp`, so we can register it through the
    // agent's own MCP CLI via the adapter's existing mcpAddArgs contract. Verified 2026-09-06:
    // `codex mcp add moderne -- /opt/homebrew/bin/mod mcp` succeeds and `codex mcp get moderne`
    // then reports it, taking that row to green.
    //
    // The path is resolved rather than left bare: mod's own registration writes an absolute path
    // (`/opt/homebrew/bin/mod mcp`), and a bare `mod` would fail for any MCP client that does not
    // inherit the user's interactive PATH. `which` is the same probe lib/run.js uses for tool
    // detection. Falling back to `mod` if `which` somehow fails is still better than not trying.
    const modPath = (exec('which', ['mod']).stdout || '').trim() || 'mod';
    const addArgs = typeof a.mcpAddArgs === 'function'
      ? a.mcpAddArgs({ name: MODERNE_MCP_SERVER, type: 'stdio', command: [modPath, 'mcp'] })
      : null;
    if (addArgs && exec(a.binary || a.key, addArgs).status === 0 && isModerneRegistered(exec, a)) {
      finalRows.push({ tool: a.key, status: 'installed', note: `mod did not detect ${a.key}; registered the MCP server directly` });
      continue;
    }
    finalRows.push({
      tool: a.key,
      status: 'failed',
      note: `mod config agent-tools ${a.key} install reported success but did not register the server, and registering it directly also failed`,
    });
  }
  return [...rows, ...finalRows];
}

async function provisionPlugins({ exec, check, yes, prompt, home, hasClaude = true, adapters = [] }) {
  const results = [];
  const push = (item, tool, r) => results.push({ provisioner: 'plugins', item, tool, status: r.status, ...(r.note ? { note: r.note } : {}) });
  const claudeSkipped = { status: 'skipped', note: 'claude not selected' };

  for (const adapter of adapters) {
    push(MATTPOCOCK_PLUGIN, adapter.key, await provisionMattpocock({ exec, check, yes, prompt, home, adapter }));
  }

  for (const row of await removeSuperpowers({ exec, check, yes, prompt, adapters })) {
    push(SUPERPOWERS, row.tool, row);
  }

  push('speckit', '-', await provisionSpeckit({ exec, check, yes, prompt }));

  // Verified against https://github.com/spring-projects/spring-tools/blob/master/claude-plugins/spring-tools/README.md
  // (2026-07-25): the plugin's marketplace.json is published to a CDN, not the GitHub repo
  // itself, and the marketplace name is `spring-tools-marketplace` (stable) — not `spring-tools`.
  push('spring-tools', 'claude', hasClaude ? await provisionClaudePlugin({
    exec, check, yes, prompt,
    item: 'spring-tools',
    installSteps: [
      ['plugin', 'marketplace', 'add', 'https://cdn.spring.io/spring-tools/release/claude-plugins/marketplace.json'],
      ['plugin', 'install', 'spring-tools@spring-tools-marketplace'],
    ],
  }) : claudeSkipped);

  for (const row of await provisionModerne({ exec, check, yes, prompt, adapters })) {
    results.push({ provisioner: 'plugins', item: 'moderne', tool: row.tool, status: row.status, ...(row.note ? { note: row.note } : {}) });
  }

  return results;
}

module.exports = {
  provisionPlugins,
  findPlugin,
  findCodexPlugin,
  moderneAuthStatus,
  moderneAuthRow,
  MATTPOCOCK_PLUGIN,
  MATTPOCOCK_SKILL_NAMES,
};
