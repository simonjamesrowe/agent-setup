#!/usr/bin/env node
// Narrated browser-demo pipeline: Google Cloud TTS narration -> Chromium screencast
// driven by Playwright -> ffmpeg mix into a web-ready MP4.
//
//   node demo.mjs check    [<demo-dir>]
//   node demo.mjs init     <demo-dir>
//   node demo.mjs plan     <demo-dir>
//   node demo.mjs narrate  <demo-dir>
//   node demo.mjs rehearse <demo-dir> [--headless]
//   node demo.mjs build    <demo-dir> [--headed] [--keep-frames]
//
// Narration is synthesised first so every scene knows how long its voice-over
// runs; the recorder then holds each scene for max(action, narration), and the
// mixer places each clip at the wall-clock offset its scene actually started.
// Playwright itself is resolved from the demo directory (or any parent), so a
// demos workspace needs `npm i -D playwright` once — see `init`.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const TTS_URL = 'https://texttospeech.googleapis.com/v1';
const DEFAULT_ENV_FILE = path.join(os.homedir(), 'workspace', 'simonjamesrowe', 'env');
const DEFAULT_VOICE = { name: 'en-GB-Chirp3-HD-Charon', languageCode: 'en-GB' };
const WORDS_PER_SECOND = 2.6;
const FPS = 30;
const OUTRO_ID = 'outro';

// ---------- small utilities ----------

function die(msg) {
  console.error(`demo: ${msg}`);
  process.exit(1);
}

function run(cmd, args, { quiet = false } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`${cmd} failed to start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} exited ${res.status}: ${(res.stderr || '').slice(-2000)}`);
  if (!quiet && res.stderr && process.env.DEMO_DEBUG) console.error(res.stderr);
  return res.stdout;
}

function has(cmd) {
  return spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0;
}

function probeDuration(file) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());
}

function sentences(text) {
  return text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

function estimateSeconds(text) {
  return text ? text.trim().split(/\s+/).length / WORDS_PER_SECOND : 0;
}

function loadEnv(argv) {
  const flag = argv.indexOf('--env-file');
  const file = flag >= 0 ? argv[flag + 1] : process.env.DEMO_ENV_FILE || DEFAULT_ENV_FILE;
  if (file && fs.existsSync(file)) process.loadEnvFile(file);
}

// ---------- demo definition ----------

async function loadDemo(dir) {
  const demoDir = path.resolve(dir);
  const file = path.join(demoDir, 'script.mjs');
  if (!fs.existsSync(file)) die(`no script.mjs in ${demoDir} — run \`init\` first`);
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  const cfg = mod.default;
  const errors = [];
  if (!cfg || typeof cfg !== 'object') die('script.mjs must `export default { ... }`');
  if (!cfg.title) errors.push('title is required');
  if (!cfg.url) errors.push('url is required');
  if (!Array.isArray(cfg.scenes) || cfg.scenes.length === 0) errors.push('scenes must be a non-empty array');
  const ids = new Set();
  for (const [i, s] of (cfg.scenes || []).entries()) {
    const where = `scenes[${i}]`;
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) errors.push(`${where}: id must be lower-kebab-case`);
    else if (ids.has(s.id) || s.id === OUTRO_ID) errors.push(`${where}: duplicate or reserved id '${s.id}'`);
    ids.add(s.id);
    if (!s.show) errors.push(`${where} (${s.id}): 'show' (what is on screen) is required for the approval plan`);
    if (s.say && Buffer.byteLength(s.say) > 4500) errors.push(`${where} (${s.id}): narration over 4500 bytes — split the scene`);
    if (s.do && typeof s.do !== 'function') errors.push(`${where} (${s.id}): 'do' must be an async function`);
    if (s.order && !['together', 'say-then-do', 'do-then-say'].includes(s.order)) errors.push(`${where} (${s.id}): unknown order '${s.order}'`);
  }
  const outro = sentences(cfg.outro || '');
  if (outro.length !== 2) errors.push(`outro must be exactly two sentences (found ${outro.length}) — it closes every demo`);
  if (errors.length) die(`invalid script.mjs:\n  - ${errors.join('\n  - ')}`);
  const viewport = { width: 1920, height: 1080, ...(cfg.viewport || {}) };
  const voice = {
    name: process.env.GOOGLE_CLOUD_TTS_VOICE_NAME || DEFAULT_VOICE.name,
    languageCode: process.env.GOOGLE_CLOUD_TTS_LANGUAGE_CODE || DEFAULT_VOICE.languageCode,
    ...(cfg.voice || {}),
  };
  const slug = cfg.slug || path.basename(demoDir);
  return { cfg, demoDir, slug, viewport, voice, buildDir: path.join(demoDir, '.build'), outDir: path.join(demoDir, 'out') };
}

// Captions and the end card show the written text; only the voice hears the
// `pronounce` substitutions (e.g. { 'simonrowe.dev': 'simon rowe dot dev' }).
function spoken(text, pronounce = {}) {
  const keys = Object.keys(pronounce).sort((a, b) => b.length - a.length);
  return keys.reduce((t, k) => t.split(k).join(pronounce[k]), text);
}

function narrationItems(demo) {
  const items = demo.cfg.scenes.filter((s) => s.say).map((s) => ({ id: s.id, text: s.say }));
  items.push({ id: OUTRO_ID, text: demo.cfg.outro.trim() });
  return items.map((i) => ({ ...i, speech: spoken(i.text, demo.cfg.pronounce) }));
}

function clipFile(demo, item) {
  // Cache on everything that changes the audio, so tweaking one scene re-voices only that scene.
  const hash = createHash('sha256').update(JSON.stringify({ text: item.speech, voice: demo.voice })).digest('hex').slice(0, 16);
  return path.join(demo.buildDir, 'tts', `${hash}.wav`);
}

// ---------- narration (Google Cloud Text-to-Speech) ----------

function ttsHeaders() {
  const key = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (key) return { 'x-goog-api-key': key };
  // User ADC needs an explicit quota project or Google rejects the call.
  const token = run('gcloud', ['auth', 'application-default', 'print-access-token'], { quiet: true }).trim();
  const project = process.env.GOOGLE_CLOUD_TTS_PROJECT_ID
    || run('gcloud', ['config', 'get-value', 'project'], { quiet: true }).trim();
  return { Authorization: `Bearer ${token}`, 'x-goog-user-project': project };
}

async function synthesize(text, voice, outFile, headers) {
  const { speakingRate, pitch, ...voiceSel } = voice;
  const body = {
    input: { text },
    voice: voiceSel,
    audioConfig: { audioEncoding: 'LINEAR16', ...(speakingRate && { speakingRate }), ...(pitch && { pitch }) },
  };
  const res = await fetch(`${TTS_URL}/text:synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 800)}`);
  const json = await res.json();
  if (!json || typeof json.audioContent !== 'string' || !json.audioContent) throw new Error('Google TTS returned no audioContent');
  fs.writeFileSync(outFile, Buffer.from(json.audioContent, 'base64'));
}

async function narrate(demo) {
  const cacheDir = path.join(demo.buildDir, 'tts');
  fs.mkdirSync(cacheDir, { recursive: true });
  const clips = new Map();
  let headers;
  for (const item of narrationItems(demo)) {
    const file = clipFile(demo, item);
    if (!fs.existsSync(file)) {
      headers ??= ttsHeaders();
      process.stdout.write(`  voicing ${item.id}… `);
      await synthesize(item.speech, demo.voice, file, headers);
      console.log('done');
    }
    clips.set(item.id, { file, duration: probeDuration(file), text: item.text });
  }
  return clips;
}

// ---------- browser helpers exposed to scene actions ----------

// Injected into every document: keeps navigation in the one recorded tab and
// draws a visible cursor (headless screencasts have none).
const PAGE_SCRIPT = `(() => {
  if (window.top !== window) return;
  // The screencast follows a single tab, so new-tab links and window.open load
  // in place. Returning window keeps \`window.open().location = url\` working too.
  window.open = function (url) { if (url) location.assign(url); return window; };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[target], area[target]');
    if (a && a.target !== '_self') a.target = '_self';
  }, true);
  document.addEventListener('submit', (e) => { if (e.target.target) e.target.target = '_self'; }, true);
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    Object.assign(c.style, {
      position: 'fixed', left: '0px', top: '0px', width: '24px', height: '24px',
      margin: '-12px 0 0 -12px', borderRadius: '50%', background: 'rgba(17,17,17,0.35)',
      border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.35)',
      pointerEvents: 'none', zIndex: '2147483646', transition: 'transform 120ms ease, background 120ms ease',
      display: 'none',
    });
    document.documentElement.appendChild(c);
    const place = (x, y) => { c.style.display = 'block'; c.style.left = x + 'px'; c.style.top = y + 'px'; };
    try { const p = JSON.parse(sessionStorage.getItem('__demo_cursor') || 'null'); if (p) place(p.x, p.y); } catch {}
    addEventListener('mousemove', (e) => {
      place(e.clientX, e.clientY);
      try { sessionStorage.setItem('__demo_cursor', JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {}
    }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(0.7)'; c.style.background = 'rgba(255,196,0,0.7)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = ''; c.style.background = 'rgba(17,17,17,0.35)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

function helpers(page, context, viewport) {
  const wait = (seconds) => sleep(seconds * 1000);
  const resolve = (target) => (typeof target === 'string' ? page.locator(target) : target);
  // Last cursor position, re-applied after every load: a new origin has no
  // stored position, so its cursor stays hidden until the mouse moves.
  let pos = { x: viewport.width / 2, y: viewport.height / 2 };
  const park = () => page.mouse.move(pos.x, pos.y).catch(() => {});

  async function move(target, { steps = 30 } = {}) {
    const loc = resolve(target);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`cursor: ${target} has no bounding box (hidden or detached)`);
    pos = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(pos.x, pos.y, { steps });
    return loc;
  }
  async function click(target, opts) {
    const loc = await move(target);
    await wait(0.15);
    await loc.click(opts);
    return loc;
  }
  async function type(target, text, { delay = 55 } = {}) {
    const loc = await click(target);
    await loc.pressSequentially(text, { delay });
    return loc;
  }
  async function scroll(pixels, { step = 60 } = {}) {
    const n = Math.max(1, Math.round(Math.abs(pixels) / step));
    for (let i = 0; i < n; i++) {
      await page.mouse.wheel(0, Math.sign(pixels) * step);
      await sleep(16);
    }
    await wait(0.3);
  }
  async function scrollTo(target) {
    const loc = resolve(target);
    await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await wait(0.9);
    return loc;
  }
  async function highlight(target, seconds = 1.5) {
    const loc = resolve(target);
    await loc.evaluate((el, ms) => {
      const prev = el.style.cssText;
      el.style.outline = '4px solid rgba(255,196,0,0.95)';
      el.style.outlineOffset = '6px';
      el.style.borderRadius = el.style.borderRadius || '6px';
      el.style.transition = 'outline-color 200ms ease';
      setTimeout(() => { el.style.cssText = prev; }, ms);
    }, seconds * 1000);
    await wait(seconds);
    return loc;
  }
  return { page, context, wait, cursor: { move, click, type, hover: move }, scroll, scrollTo, highlight, park };
}

async function showEndCard(page, demo) {
  const { cfg } = demo;
  const link = cfg.link ?? new URL(cfg.url).host;
  await page.evaluate(({ title, lines, link }) => {
    const cursor = document.getElementById('__demo_cursor');
    if (cursor) cursor.style.display = 'none';
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'flex-start', padding: '0 12vw', gap: '28px',
      background: '#0d1117', color: '#f0f3f6', opacity: '0', transition: 'opacity 600ms ease',
      fontFamily: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
    });
    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, { fontSize: '64px', fontWeight: '700', letterSpacing: '-0.02em', lineHeight: '1.1' });
    el.appendChild(h);
    for (const line of lines) {
      const p = document.createElement('div');
      p.textContent = line;
      Object.assign(p.style, { fontSize: '32px', lineHeight: '1.45', maxWidth: '1300px', color: '#c9d1d9' });
      el.appendChild(p);
    }
    if (link) {
      const a = document.createElement('div');
      a.textContent = link;
      Object.assign(a.style, { fontSize: '26px', color: '#f7b500', marginTop: '16px', fontWeight: '600' });
      el.appendChild(a);
    }
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
  }, { title: cfg.title, lines: sentences(cfg.outro), link });
  await sleep(700);
}

// ---------- recording ----------

function loadPlaywright(demoDir) {
  try {
    return createRequire(path.join(demoDir, 'package.json'))('playwright');
  } catch {
    die(`playwright is not resolvable from ${demoDir}. In the demos workspace run:\n  npm init -y && npm i -D playwright && npx playwright install chromium`);
  }
}

async function record(demo, clips, { headed = false, capture = true } = {}) {
  const { cfg, viewport } = demo;
  const dsf = cfg.deviceScaleFactor || 1;
  const { chromium } = loadPlaywright(demo.demoDir);
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport, deviceScaleFactor: dsf, colorScheme: cfg.colorScheme || 'light',
    ...(cfg.storageState && { storageState: path.resolve(demo.demoDir, cfg.storageState) }),
    ...(cfg.contextOptions || {}),
  });
  await context.addInitScript(PAGE_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(cfg.actionTimeoutMs || 20000);
  const h = helpers(page, context, viewport);
  page.on('load', () => { h.park(); });
  // Backstop for popups PAGE_SCRIPT cannot rewrite (iframes, noopener
  // handlers): close the popup and load its URL in the recorded tab.
  context.on('page', async (popup) => {
    if (popup === page) return;
    try {
      await popup.waitForURL((u) => u.href !== 'about:blank', { timeout: 10000 });
      const url = popup.url();
      await popup.close();
      console.log(`  ↪ popup ${url.slice(0, 120)} loaded in the recorded tab`);
      await page.goto(url);
    } catch {
      await popup.close().catch(() => {});
    }
  });
  const framesDir = path.join(demo.buildDir, 'frames');
  const frames = [];
  let cdp;
  const now = () => Date.now() / 1000;
  const timeline = [];
  let current = 'setup';
  // A demo that records a broken page is worse than no demo: surface failed
  // requests and page errors per scene instead of letting them pass silently.
  const problems = [];
  const ignored = cfg.ignoreProblems || [];
  const report = (issue) => { if (!ignored.some((s) => issue.includes(s))) problems.push({ scene: current, issue }); };
  page.on('response', (r) => { if (r.status() >= 400) report(`HTTP ${r.status()} ${r.request().resourceType()} ${r.url().slice(0, 200)}`); });
  page.on('requestfailed', (r) => {
    // ERR_ABORTED is a navigation cancelling in-flight beacons/prefetches, not a broken page.
    const why = r.failure()?.errorText || '';
    if (!why.includes('ERR_ABORTED')) report(`request failed ${r.url().slice(0, 200)} (${why})`);
  });
  page.on('pageerror', (e) => report(`page error: ${e.message.split('\n')[0]}`));

  try {
    await page.goto(cfg.url, { waitUntil: 'load' });
    if (cfg.setup) await cfg.setup(h);
    await h.park();

    if (capture) {
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.mkdirSync(framesDir, { recursive: true });
      cdp = await context.newCDPSession(page);
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const file = path.join(framesDir, `${String(frames.length).padStart(6, '0')}.jpg`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, t: metadata.timestamp ?? now() });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: 92, everyNthFrame: 1,
        maxWidth: viewport.width * dsf, maxHeight: viewport.height * dsf,
      });
      await sleep(400);
    }

    // Everything before t0 (load, login, setup) is trimmed from the video.
    const t0 = now();
    const narrationFor = (s) => clips.get(s.id)?.duration ?? estimateSeconds(s.say);
    for (const scene of cfg.scenes) {
      current = scene.id;
      const start = now() - t0;
      const say = scene.say ? narrationFor(scene) : 0;
      let action = 0;
      const act = async () => {
        const began = now();
        if (scene.do) await scene.do(h);
        action = now() - began;
      };
      let audioStart = start;
      if (scene.order === 'do-then-say') {
        await act();
        audioStart = now() - t0;
        await sleep(say * 1000);
      } else if (scene.order === 'say-then-do') {
        await sleep(say * 1000);
        await act();
      } else {
        await Promise.all([act(), sleep(say * 1000)]);
      }
      timeline.push({ id: scene.id, start, audioStart, audioDuration: say, action, text: scene.say || '' });
      console.log(`  ✓ ${scene.id} (${(now() - t0 - start).toFixed(1)}s)`);
      await sleep((scene.gap ?? 0.6) * 1000);
    }

    current = OUTRO_ID;
    await showEndCard(page, demo);
    const outroStart = now() - t0;
    const outroDur = clips.get(OUTRO_ID)?.duration ?? estimateSeconds(cfg.outro);
    timeline.push({ id: OUTRO_ID, start: outroStart, audioStart: outroStart, audioDuration: outroDur, text: cfg.outro.trim() });
    await sleep((outroDur + (cfg.tail ?? 1.5)) * 1000);
    const end = now() - t0;

    if (cdp) {
      await cdp.send('Page.stopScreencast');
      await sleep(200);
    }
    for (const p of problems.slice(0, 10)) console.warn(`  ⚠ [${p.scene}] ${p.issue}`);
    if (problems.length > 10) console.warn(`  ⚠ …and ${problems.length - 10} more in .build/timeline.json`);
    return { t0, end, timeline, frames, problems };
  } catch (err) {
    fs.mkdirSync(demo.buildDir, { recursive: true });
    const shot = path.join(demo.buildDir, `failure-${current}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    err.message = `scene '${current}' failed: ${err.message}\n  screenshot: ${shot}`;
    throw err;
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------- mixing ----------

function writeFrameList(rec, buildDir) {
  const { frames, t0, end } = rec;
  const t1 = t0 + end;
  if (frames.length === 0) throw new Error('screencast produced no frames');
  // The frame on screen at t0 is the last one painted at or before t0.
  let first = 0;
  for (let i = 0; i < frames.length; i++) if (frames[i].t <= t0) first = i;
  const used = frames.slice(first).filter((f) => f.t < t1);
  const lines = [];
  for (let i = 0; i < used.length; i++) {
    const from = Math.max(used[i].t, t0);
    const to = i + 1 < used.length ? used[i + 1].t : t1;
    const dur = Math.max(to - from, 0.001);
    lines.push(`file '${used[i].file.replace(/'/g, "'\\''")}'`, `duration ${dur.toFixed(4)}`);
  }
  // concat demuxer ignores the last duration unless the final file is repeated.
  lines.push(`file '${used[used.length - 1].file.replace(/'/g, "'\\''")}'`);
  const list = path.join(buildDir, 'frames.txt');
  fs.writeFileSync(list, `${lines.join('\n')}\n`);
  return list;
}

function mix(demo, rec, clips, outFile) {
  const list = writeFrameList(rec, demo.buildDir);
  const voiced = rec.timeline.filter((t) => clips.has(t.id));
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  for (const t of voiced) args.push('-i', clips.get(t.id).file);
  const parts = [`[0:v]fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]`];
  voiced.forEach((t, i) => parts.push(`[${i + 1}:a]aresample=48000,adelay=${Math.round(t.audioStart * 1000)}:all=1[a${i}]`));
  parts.push(`${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0:dropout_transition=0,apad,atrim=0:${rec.end.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart',
    '-t', rec.end.toFixed(3), outFile);
  run('ffmpeg', args);
}

function vttTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, '0')}`;
}

function captions(timeline) {
  const cues = [];
  for (const t of timeline.filter((x) => x.text)) {
    const parts = sentences(t.text);
    const total = parts.reduce((n, p) => n + p.length, 0);
    let at = t.audioStart;
    for (const p of parts) {
      const d = (t.audioDuration * p.length) / total;
      cues.push(`${vttTime(at)} --> ${vttTime(at + d)}\n${p}`);
      at += d;
    }
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function stills(outFile, timeline, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const t of timeline) {
    const at = t.start + Math.min(Math.max(t.audioDuration, 1) * 0.6, 4);
    const file = path.join(dir, `${t.id}.jpg`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', at.toFixed(2), '-i', outFile, '-frames:v', '1', '-q:v', '3', file]);
    shots.push(file);
  }
  return shots;
}

function verify(outFile) {
  const json = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', outFile]));
  const v = json.streams.find((s) => s.codec_type === 'video');
  const a = json.streams.find((s) => s.codec_type === 'audio');
  if (!v || !a) throw new Error(`output is missing a ${v ? 'audio' : 'video'} stream`);
  return { duration: Number(json.format.duration), sizeMb: Number(json.format.size) / 1e6, video: `${v.codec_name} ${v.width}x${v.height}`, audio: a.codec_name };
}

// ---------- commands ----------

const SCRIPT_TEMPLATE = `// Demo definition — see the demo-record skill's references/script-format.md.
export default {
  title: 'TODO product name — what it does',
  url: 'https://example.com',
  // link: 'example.com',               // shown on the end card (defaults to the url's host)
  // voice: { name: 'en-GB-Chirp3-HD-Charon', languageCode: 'en-GB', speakingRate: 1.0 },
  // pronounce: { 'example.com': 'example dot com' },   // voice-only substitutions
  // storageState: 'auth.json',         // Playwright storage state for signed-in demos
  // setup: async ({ page }) => {},     // runs before the clock starts; trimmed from the video

  scenes: [
    {
      id: 'intro',
      show: 'Landing page, cursor rests on the hero',
      say: 'TODO the opening line: the problem this product solves, for whom.',
      do: async ({ page, cursor, wait }) => {
        await wait(1);
      },
    },
  ],

  // Exactly two sentences: what was demoed, and why it matters.
  outro: 'TODO first sentence. TODO second sentence.',
};
`;

async function cmdInit(dir) {
  const demoDir = path.resolve(dir);
  const file = path.join(demoDir, 'script.mjs');
  if (fs.existsSync(file)) die(`${file} already exists — not overwriting`);
  fs.mkdirSync(demoDir, { recursive: true });
  fs.writeFileSync(file, SCRIPT_TEMPLATE);
  const root = path.dirname(demoDir);
  try {
    createRequire(path.join(demoDir, 'package.json')).resolve('playwright');
  } catch {
    console.log(`setting up Playwright in ${root}`);
    const npm = (args) => { const r = spawnSync('npm', args, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) die(`npm ${args.join(' ')} failed`); };
    if (!fs.existsSync(path.join(root, 'package.json'))) npm(['init', '-y']);
    npm(['install', '--save-dev', 'playwright']);
    const r = spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) die('playwright install chromium failed');
  }
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'node_modules/\n*/.build/\n*/out/\n*/auth.json\n');
  console.log(`created ${file}`);
}

async function cmdCheck(dir) {
  let ok = true;
  const line = (good, label, note = '') => { ok &&= good; console.log(`${good ? '✓' : '✗'} ${label}${note ? ` — ${note}` : ''}`); };
  line(has('ffmpeg'), 'ffmpeg', has('ffmpeg') ? '' : 'brew install ffmpeg');
  line(has('ffprobe'), 'ffprobe');
  if (dir) {
    let pw;
    try { pw = createRequire(path.join(path.resolve(dir), 'package.json'))('playwright'); } catch { /* reported below */ }
    line(Boolean(pw), 'playwright resolvable from demo dir', pw ? '' : 'run init, or npm i -D playwright in the demos workspace');
    if (pw) {
      try { const b = await pw.chromium.launch(); await b.close(); line(true, 'chromium launches'); } catch (e) { line(false, 'chromium launches', `npx playwright install chromium (${e.message.split('\n')[0]})`); }
    }
  }
  const auth = process.env.GOOGLE_CLOUD_TTS_API_KEY ? 'GOOGLE_CLOUD_TTS_API_KEY' : 'gcloud application-default credentials';
  try {
    const voice = process.env.GOOGLE_CLOUD_TTS_VOICE_NAME || DEFAULT_VOICE.name;
    const lang = process.env.GOOGLE_CLOUD_TTS_LANGUAGE_CODE || DEFAULT_VOICE.languageCode;
    const res = await fetch(`${TTS_URL}/voices?languageCode=${encodeURIComponent(lang)}`, { headers: ttsHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { voices = [] } = await res.json();
    line(true, `Google TTS reachable via ${auth}`);
    line(voices.some((v) => v.name === voice), `voice ${voice} available`, `${voices.length} ${lang} voices listed`);
  } catch (e) {
    line(false, `Google TTS via ${auth}`, e.message);
  }
  process.exit(ok ? 0 : 1);
}

// `together` overlaps action and narration; the other two orders run them back to back.
function sceneSeconds(order, action, say) {
  return order === 'do-then-say' || order === 'say-then-do' ? action + say : Math.max(action, say);
}

// Action timings measured by the last rehearse/build, keyed to each action's
// source so an edited action is never estimated from a stale measurement.
const actionKey = (scene) => createHash('sha256').update(String(scene.do || '')).digest('hex').slice(0, 16);
const actionTimesFile = (demo) => path.join(demo.buildDir, 'action-times.json');

function saveActionTimes(demo, rec) {
  const times = {};
  for (const scene of demo.cfg.scenes) {
    const t = rec.timeline.find((x) => x.id === scene.id);
    if (t) times[scene.id] = { action: t.action, key: actionKey(scene) };
  }
  fs.mkdirSync(demo.buildDir, { recursive: true });
  fs.writeFileSync(actionTimesFile(demo), JSON.stringify(times, null, 2));
}

function cachedClips(demo) {
  const cached = new Map();
  for (const item of narrationItems(demo)) {
    const file = clipFile(demo, item);
    if (fs.existsSync(file) && has('ffprobe')) cached.set(item.id, { file, duration: probeDuration(file) });
  }
  return cached;
}

async function cmdPlan(dir) {
  const demo = await loadDemo(dir);
  const file = actionTimesFile(demo);
  const measured = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const clips = cachedClips(demo);
  const sayFor = (id, text) => clips.get(id)?.duration ?? estimateSeconds(text);
  let unmeasured = 0;
  const rows = demo.cfg.scenes.map((s) => {
    const m = measured[s.id];
    const known = !s.do || (m && m.key === actionKey(s));
    if (!known) unmeasured++;
    const secs = sceneSeconds(s.order, known && s.do ? m.action : 0, s.say ? sayFor(s.id, s.say) : 0) + (s.gap ?? 0.6);
    return { id: s.id, show: s.show, say: s.say || '_(silent)_', secs, known };
  });
  rows.push({ id: OUTRO_ID, show: 'End card: title, the two outro sentences, link', say: demo.cfg.outro.trim(),
    secs: 0.7 + sayFor(OUTRO_ID, demo.cfg.outro) + (demo.cfg.tail ?? 1.5), known: true });
  const total = rows.reduce((n, r) => n + r.secs, 0);
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const table = rows.map((r, i) => `| ${i + 1} | \`${r.id}\` | ${cell(r.show)} | ${cell(r.say)} | ~${r.secs.toFixed(0)}s${r.known ? '' : '+'} |`);
  const basis = [
    clips.size ? 'narration from voiced clips' : `narration estimated at ${Math.round(WORDS_PER_SECOND * 60)} wpm`,
    unmeasured ? `${unmeasured} scene action(s) not yet rehearsed, marked + (run \`rehearse\`, then \`plan\` again)` : 'action times from the last rehearsal',
  ].join('; ');
  const md = `# ${demo.cfg.title}\n\n${demo.cfg.url}\n\n| # | Scene | On screen | Narration | Est. |\n| --- | --- | --- | --- | --- |\n${table.join('\n')}\n\n**Estimated length: ~${Math.round(total)}s${unmeasured ? '+' : ''}** (${basis}).\n`;
  fs.writeFileSync(path.join(demo.demoDir, 'plan.md'), md);
  console.log(md);
}

async function cmdNarrate(dir) {
  const demo = await loadDemo(dir);
  const clips = await narrate(demo);
  let total = 0;
  for (const [id, c] of clips) { total += c.duration; console.log(`  ${id.padEnd(24)} ${c.duration.toFixed(1)}s  ${c.file}`); }
  console.log(`narration total ${total.toFixed(1)}s`);
}

async function cmdRehearse(dir, argv) {
  const demo = await loadDemo(dir);
  console.log('rehearsing (no recording, narration timed by estimate or cached audio)…');
  const rec = await record(demo, cachedClips(demo), { headed: !argv.includes('--headless'), capture: false });
  saveActionTimes(demo, rec);
  console.log(`rehearsal ok — ~${rec.end.toFixed(0)}s (action times saved for \`plan\`)`);
}

async function cmdBuild(dir, argv) {
  const demo = await loadDemo(dir);
  for (const tool of ['ffmpeg', 'ffprobe']) if (!has(tool)) die(`${tool} not found — brew install ffmpeg`);
  console.log('1/4 narration');
  const clips = await narrate(demo);
  console.log('2/4 recording');
  const rec = await record(demo, clips, { headed: argv.includes('--headed') });
  saveActionTimes(demo, rec);
  fs.mkdirSync(demo.outDir, { recursive: true });
  const outFile = path.join(demo.outDir, `${demo.slug}.mp4`);
  console.log(`3/4 mixing ${rec.frames.length} frames + ${clips.size} clips`);
  mix(demo, rec, clips, outFile);
  console.log('4/4 captions, poster, stills');
  fs.writeFileSync(path.join(demo.outDir, `${demo.slug}.vtt`), captions(rec.timeline));
  fs.writeFileSync(path.join(demo.outDir, 'summary.txt'), `${demo.cfg.title}\n\n${demo.cfg.outro.trim()}\n`);
  const shots = stills(outFile, rec.timeline, path.join(demo.buildDir, 'stills'));
  const posterScene = demo.cfg.poster || demo.cfg.scenes[0].id;
  fs.copyFileSync(path.join(demo.buildDir, 'stills', `${posterScene}.jpg`), path.join(demo.outDir, 'poster.jpg'));
  fs.writeFileSync(path.join(demo.buildDir, 'timeline.json'), JSON.stringify({ end: rec.end, frames: rec.frames.length, timeline: rec.timeline, problems: rec.problems }, null, 2));
  if (!argv.includes('--keep-frames')) fs.rmSync(path.join(demo.buildDir, 'frames'), { recursive: true, force: true });
  const info = verify(outFile);
  console.log(`\n${outFile}\n  ${info.duration.toFixed(1)}s · ${info.video} · ${info.audio} · ${info.sizeMb.toFixed(1)} MB`);
  if (rec.problems.length) console.log(`  ⚠ ${rec.problems.length} page problem(s) during recording — see above and .build/timeline.json`);
  console.log(`  captions ${path.join(demo.outDir, `${demo.slug}.vtt`)}\n  poster   ${path.join(demo.outDir, 'poster.jpg')}\n  stills   ${path.dirname(shots[0])}/ (one per scene — look at them)`);
}

const [cmd, dir, ...rest] = process.argv.slice(2);
loadEnv(process.argv);
const commands = {
  check: () => cmdCheck(dir),
  init: () => (dir ? cmdInit(dir) : die('usage: init <demo-dir>')),
  plan: () => cmdPlan(dir || '.'),
  narrate: () => cmdNarrate(dir || '.'),
  rehearse: () => cmdRehearse(dir || '.', rest),
  build: () => cmdBuild(dir || '.', rest),
};
if (!commands[cmd]) die('usage: demo.mjs <check|init|plan|narrate|rehearse|build> <demo-dir> [flags]');
commands[cmd]().catch((err) => die(process.env.DEMO_DEBUG ? err.stack : err.message));
