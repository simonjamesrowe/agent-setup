// Drives a native macOS app for a demo through scripts/native/DemoNative.swift:
// compiles the helper once per source change, speaks its JSON-lines protocol,
// and exposes the `app` helpers scene actions use.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'native', 'DemoNative.swift');
const CACHE = path.join(os.homedir(), 'Library', 'Caches', 'demo-record');

// Playwright-style role names, mapped to the AX roles WebKit and AppKit expose.
export const ROLES = {
  button: ['AXButton'],
  link: ['AXLink'],
  textbox: ['AXTextField', 'AXTextArea'],
  searchbox: ['AXTextField'],
  checkbox: ['AXCheckBox'],
  switch: ['AXCheckBox'],
  radio: ['AXRadioButton'],
  tab: ['AXRadioButton', 'AXTab'],
  combobox: ['AXPopUpButton', 'AXComboBox'],
  menuitem: ['AXMenuItem'],
  heading: ['AXHeading'],
  text: ['AXStaticText'],
  image: ['AXImage'],
  row: ['AXRow'],
  cell: ['AXCell'],
  list: ['AXList'],
  group: ['AXGroup'],
};

// A target is { role, name, exact, id, className, subrole, index }, where
// name may be a string (case-insensitive substring unless exact) or a RegExp.
export function toQuery(target) {
  if (!target || typeof target !== 'object') throw new Error(`app target must be an object like { role: 'button', name: 'Save' }, got ${target}`);
  const { role, name, ...rest } = target;
  const roles = role ? (ROLES[role] || (role.startsWith('AX') ? [role] : null)) : [];
  if (!roles) throw new Error(`unknown role '${role}' (use one of ${Object.keys(ROLES).join(', ')} or a raw AX role)`);
  const query = { ...rest, roles };
  if (name instanceof RegExp) query.pattern = { source: name.source, flags: name.flags };
  else if (name !== undefined) query.name = String(name);
  return query;
}

export function describe(target) {
  if (!target) return String(target);
  const name = target.name instanceof RegExp ? String(target.name) : target.name !== undefined ? `"${target.name}"` : '';
  return [target.role, name, target.id && `#${target.id}`, target.className && `.${target.className}`].filter(Boolean).join(' ');
}

export function helperBinary() {
  if (process.platform !== 'darwin') throw new Error('native demos need macOS');
  const source = fs.readFileSync(SOURCE);
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const bin = path.join(CACHE, `demo-native-${hash}`);
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(CACHE, { recursive: true });
  const res = spawnSync('swiftc', ['-O', '-swift-version', '5', SOURCE, '-o', `${bin}.tmp`], { encoding: 'utf8' });
  if (res.error) throw new Error(`swiftc not found (xcode-select --install): ${res.error.message}`);
  if (res.status !== 0) throw new Error(`compiling the native helper failed:\n${res.stderr.slice(-3000)}`);
  fs.renameSync(`${bin}.tmp`, bin);
  return bin;
}

export function startHelper() {
  const proc = spawn(helperBinary(), [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let next = 1;
  let exited = null;
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  proc.on('exit', (code) => {
    exited = code;
    for (const p of pending.values()) p.reject(new Error(`native helper exited (${code})`));
    pending.clear();
  });
  const request = (op, args = {}) => new Promise((resolve, reject) => {
    if (exited !== null) { reject(new Error(`native helper exited (${exited})`)); return; }
    const id = next++;
    pending.set(id, { resolve, reject });
    proc.stdin.write(`${JSON.stringify({ ...args, id, op })}\n`);
  });
  const close = async () => {
    if (exited !== null) return;
    request('quit').catch(() => {});
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(2000)]);
    if (exited === null) proc.kill();
  };
  return { request, close };
}

// Reads the helper's frame index: one { file, t } per line.
export function readFrameIndex(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// The helpers a scene's `do` receives as `app`. `onShow` is called whenever an
// action means the viewer should be looking at the app.
export function appHelpers(helper, { onShow, timeout = 20 } = {}) {
  const wait = (seconds) => sleep(seconds * 1000);
  const q = (target, opts = {}) => ({ target: toQuery(target), timeout: opts.timeout ?? timeout });
  const shown = () => onShow?.();
  const withTarget = async (target, fn) => {
    try { return await fn(); } catch (e) { throw new Error(`app ${describe(target)}: ${e.message}`); }
  };

  const cursor = {
    move: (target, { duration = 0.6 } = {}) => withTarget(target, async () => { shown(); await helper.request('move', { ...q(target), duration }); }),
    click: (target, { duration = 0.6, count = 1 } = {}) => withTarget(target, async () => { shown(); await helper.request('click', { ...q(target), duration, count }); }),
    async type(target, text, { delay = 0.055 } = {}) {
      await cursor.click(target);
      await helper.request('type', { text, delay });
    },
  };
  cursor.hover = cursor.move;

  const sheet = { roles: ['AXSheet'] };
  async function panel(file) {
    shown();
    const until = async (present, secs) => {
      const deadline = Date.now() + secs * 1000;
      while ((await helper.request('exists', { target: sheet })) !== present) {
        if (Date.now() > deadline) throw new Error(`file panel did not ${present ? 'open' : 'close'} within ${secs}s`);
        await sleep(200);
      }
    };
    await until(true, 15);
    await wait(0.6);
    await helper.request('key', { key: 'Cmd+Shift+G' });
    await wait(0.8);
    await helper.request('type', { text: path.resolve(file), delay: 0.01 });
    await wait(0.5);
    await helper.request('key', { key: 'Enter' });
    await wait(1);
    await helper.request('key', { key: 'Enter' });
    await until(false, 15);
  }

  return {
    // Cuts the video to the app and brings it to the front.
    async show() { shown(); await helper.request('front'); },
    cursor,
    keyboard: {
      type: async (text, { delay = 0.055 } = {}) => { shown(); await helper.request('type', { text, delay }); },
      press: async (combo) => { shown(); await helper.request('key', { key: combo }); },
    },
    paste: async (text) => { shown(); await helper.request('paste', { text }); },
    scroll: async (pixels) => { shown(); await helper.request('scroll', { pixels }); await wait(0.3); },
    scrollTo: (target) => withTarget(target, async () => { shown(); await helper.request('scrollIntoView', q(target)); }),
    // With { text }, outlines just that phrase inside the element (scrolled
    // into view), for a long block of text taller than the window.
    highlight: (target, seconds = 1.5, { text } = {}) => withTarget(target, async () => {
      shown();
      if (text) {
        const rect = await helper.request('textBounds', { ...q(target), text });
        await helper.request('highlight', { rect, seconds });
      } else {
        await helper.request('highlight', { ...q(target), seconds });
      }
      await wait(seconds);
    }),
    // Selects a phrase inside an element's text with a real drag, for apps that
    // act on a mouse selection. target names the element; text is the phrase.
    selectText: (target, text, { duration = 0.6 } = {}) => withTarget(target, async () => {
      shown();
      const r = await helper.request('textBounds', { ...q(target), text });
      const y = r.y + r.height / 2;
      await helper.request('drag', { from: [r.x + 1, y], to: [r.x + r.width - 1, y], duration });
    }),
    find: (target, opts) => withTarget(target, () => helper.request('find', q(target, opts))),
    exists: (target) => helper.request('exists', { target: toQuery(target) }),
    text: (target, opts) => withTarget(target, async () => (await helper.request('text', q(target, opts))).names.join(' ')),
    // Waits for a target to appear, or with { gone: true } to disappear.
    async waitFor(target, { timeout: secs = timeout, gone = false } = {}) {
      const deadline = Date.now() + secs * 1000;
      for (;;) {
        const present = await helper.request('exists', { target: toQuery(target) });
        if (present !== gone) return;
        if (Date.now() > deadline) throw new Error(`app ${describe(target)}: still ${gone ? 'present' : 'absent'} after ${secs}s`);
        await sleep(250);
      }
    },
    // Fills the open or save panel the app has just shown: waits for its sheet,
    // types the full path into Go to Folder, confirms, and waits for it to close.
    // A save panel accepts a path ending in the file name.
    async chooseFile(file) { await panel(file); },
    async saveFile(file) { await panel(file); },
    wait,
  };
}
