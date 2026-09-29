// Hand-drawn Excalidraw diagrams inside a demo recording.
//
// A diagram is `diagrams/<name>.json` in the demo directory: either an array of
// Excalidraw element skeletons (house style applied: Excalifont, pastel
// cross-hatch fills, rough strokes) or a real `.excalidraw` export
// (`{ elements, files }`, rendered exactly as drawn). Excalidraw's own
// exportToSvg renders it in the recorded tab, served from a local HTTP server
// together with the fonts bundled in @excalidraw/excalidraw, so a recording
// never depends on a CDN. Walkthroughs dim everything but the focused section,
// glide the camera onto it and sketch a rough outline around it.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const NAME = /^[a-z0-9-]+$/;
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.css': 'text/css', '.html': 'text/html' };

export const DIAGRAM_DEPS = ['@excalidraw/excalidraw@^0.18', 'react@^19', 'react-dom@^19', 'esbuild'];

function resolveDeps(demoDir) {
  const req = createRequire(path.join(demoDir, 'package.json'));
  let entry;
  try {
    entry = req.resolve('@excalidraw/excalidraw');
    req.resolve('esbuild');
  } catch {
    throw new Error(`diagram support is not installed. In the demos workspace run:\n  npm i -D ${DIAGRAM_DEPS.join(' ')}`);
  }
  // The package's exports map hides package.json, so walk up from its entry point.
  let root = path.dirname(entry);
  while (!fs.existsSync(path.join(root, 'package.json'))) root = path.dirname(root);
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return { esbuild: req('esbuild'), assets: path.join(root, 'dist', 'prod'), version, resolveDir: path.dirname(path.dirname(root)) };
}

export function diagramDepsInstalled(demoDir) {
  try { resolveDeps(demoDir); return true; } catch { return false; }
}

async function bundle(deps, buildDir) {
  const out = path.join(buildDir, `excalidraw-${deps.version}.js`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(buildDir, { recursive: true });
  await deps.esbuild.build({
    stdin: {
      contents: `export { exportToSvg, convertToExcalidrawElements, getCommonBounds, FONT_FAMILY } from '@excalidraw/excalidraw';
                 export { default as rough } from 'roughjs/bin/rough';`,
      resolveDir: deps.resolveDir,
      loader: 'js',
    },
    bundle: true, format: 'iife', globalName: 'ExcalidrawLib', outfile: out, minify: true, logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.css': 'empty', '.woff2': 'empty' },
  });
  return out;
}

// Serves the renderer, Excalidraw's fonts and the demo's diagrams on 127.0.0.1.
export async function startDiagramServer(demoDir, buildDir) {
  const deps = resolveDeps(demoDir);
  const lib = await bundle(deps, buildDir);
  const diagramsDir = path.join(demoDir, 'diagrams');
  const send = (res, status, body, type = 'text/plain') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/lib.js') return send(res, 200, fs.readFileSync(lib), TYPES['.js']);
    if (parts[0] === 'diagram' && NAME.test(parts[1] || '')) return send(res, 200, PAGE.replace('__NAME__', parts[1]), TYPES['.html']);
    if (parts[0] === 'data' && NAME.test(parts[1] || '')) {
      const file = path.join(diagramsDir, `${parts[1]}.json`);
      return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file), TYPES['.json']) : send(res, 404, `no diagrams/${parts[1]}.json`);
    }
    if (parts[0] === 'assets') {
      // Resolve inside the Excalidraw dist only; anything escaping it is refused.
      const file = path.resolve(deps.assets, ...parts.slice(1).map(decodeURIComponent));
      if (!file.startsWith(deps.assets + path.sep) || !fs.existsSync(file)) return send(res, 404, 'not found');
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    return send(res, 404, 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Action helpers: `diagram.show(name)`, `diagram.focus(targets, opts)`, `diagram.reset()`.
export function diagramHelpers(page, getServer, sleep) {
  const call = async (fn, arg) => {
    const ok = await page.evaluate(() => Boolean(window.__diagram)).catch(() => false);
    if (!ok) throw new Error('no diagram on screen — call diagram.show(name) first');
    return page.evaluate(fn, arg);
  };
  return {
    async show(name) {
      if (!NAME.test(name)) throw new Error(`diagram name '${name}' must be lower-kebab-case (diagrams/<name>.json)`);
      const { base } = await getServer();
      await page.goto(`${base}/diagram/${name}`);
      await page.waitForFunction(() => window.__diagram && (window.__diagram.ready || window.__diagram.error), null, { timeout: 30000 });
      const error = await page.evaluate(() => window.__diagram.error);
      if (error) throw new Error(`diagram '${name}': ${error}`);
      await sleep(0.5);
    },
    async focus(targets, opts = {}) {
      await call(([t, o]) => window.__diagram.focus(t, o), [targets, opts]);
      await sleep(1.0);
    },
    async reset() {
      await call(() => window.__diagram.reset());
      await sleep(1.0);
    },
  };
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>diagram</title>
<style>
  html, body { margin: 0; height: 100%; background: #ffffff; overflow: hidden; }
  #cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform 1000ms cubic-bezier(0.45, 0, 0.2, 1); }
  #cam > svg { display: block; }
  #spot { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; transition: opacity 450ms ease; }
  #spot path.sketch { transition: stroke-dashoffset 700ms ease-out; }
  /* Diagrams are walked by highlighting, not pointing: hide the demo cursor. */
  #__demo_cursor { display: none !important; }
</style>
<script>window.EXCALIDRAW_ASSET_PATH = '/assets/';</script>
<script src="/lib.js"></script>
</head><body><div id="cam"></div>
<script>
(async () => {
  const state = { ready: false, error: null };
  window.__diagram = state;
  try {
    const X = window.ExcalidrawLib;
    const FONT = X.FONT_FAMILY.Excalifont;
    // House style for skeletons: hand-drawn strokes, Excalifont, pastel cross-hatch fills.
    const house = (els) => els.map((el) => {
      const e = { ...el };
      if (['rectangle', 'ellipse', 'diamond'].includes(e.type)) {
        e.roughness ??= 1; e.strokeWidth ??= 2;
        if (e.backgroundColor && e.backgroundColor !== 'transparent') e.fillStyle ??= 'cross-hatch';
        if (e.type === 'rectangle') e.roundness ??= { type: 3 };
      }
      if (e.type === 'arrow' || e.type === 'line') { e.roughness ??= 1; e.strokeWidth ??= 2; }
      if (e.type === 'text') e.fontFamily ??= FONT;
      if (e.label) e.label = { fontFamily: FONT, ...e.label };
      return e;
    });
    const raw = await (await fetch('/data/__NAME__')).json();
    const elements = Array.isArray(raw)
      ? X.convertToExcalidrawElements(house(raw), { regenerateIds: false })
      : (raw.elements || []).filter((e) => !e.isDeleted);
    if (!elements.length) throw new Error('diagram has no elements');
    const PAD = 40;
    const svg = await X.exportToSvg({
      elements, files: raw.files || {}, exportPadding: PAD,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
    });
    await document.fonts.ready;
    const cam = document.getElementById('cam');
    cam.appendChild(svg);
    const W = Number(svg.getAttribute('width')), H = Number(svg.getAttribute('height'));
    const [minX, minY] = X.getCommonBounds(elements);
    const box = (els) => {
      const [x1, y1, x2, y2] = X.getCommonBounds(els);
      return { x: x1 - minX + PAD, y: y1 - minY + PAD, w: x2 - x1, h: y2 - y1 };
    };
    const NS = 'http://www.w3.org/2000/svg';
    // The spotlight layer rides on the camera: a white veil over the whole
    // diagram, the focused elements re-rendered crisp on top of it (same
    // elements, same seeds, so they match exactly), then a sketched outline.
    const spot = document.createElement('div');
    spot.id = 'spot';
    Object.assign(spot.style, { width: W + 'px', height: H + 'px' });
    cam.appendChild(spot);

    const vw = innerWidth, vh = innerHeight;
    const aim = (b, maxScale) => {
      const s = Math.min((vw * 0.86) / b.w, (vh * 0.8) / b.h, maxScale);
      const tx = vw / 2 - (b.x + b.w / 2) * s, ty = vh / 2 - (b.y + b.h / 2) * s;
      cam.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    };
    const overview = () => aim({ x: 0, y: 0, w: W, h: H }, 2);
    cam.style.transition = 'none'; overview(); cam.getBoundingClientRect(); cam.style.transition = '';

    // Each target (element id, group id, or frame name/id) is one section; a
    // section carries its frame children and bound labels. Arrows joining two
    // focused elements light up with them unless { arrows: false }.
    const withLabels = (els) => { const ids = new Set(els.map((e) => e.id)); return [...els, ...elements.filter((e) => e.containerId && ids.has(e.containerId))]; };
    const resolve = (targets, arrows) => {
      const sections = [].concat(targets).map((t) => {
        const hit = elements.filter((e) => e.id === t || (e.type === 'frame' && e.name === t) || (e.groupIds || []).includes(t));
        if (!hit.length) throw new Error('no diagram element, group or frame named: ' + t);
        const frames = new Set(hit.filter((e) => e.type === 'frame').map((e) => e.id));
        return withLabels([...hit, ...elements.filter((e) => e.frameId && frames.has(e.frameId))]);
      });
      const all = new Set(sections.flat());
      const ids = new Set([...all].map((e) => e.id));
      if (arrows !== false) {
        const links = elements.filter((e) => e.type === 'arrow' && ids.has(e.startBinding?.elementId) && ids.has(e.endBinding?.elementId));
        for (const e of withLabels(links)) all.add(e);
      }
      // Keep diagram order so z-order matches the full render.
      return { sections, all: elements.filter((e) => all.has(e)) };
    };

    const layer = (el, x, y) => { Object.assign(el.style, { position: 'absolute', left: x + 'px', top: y + 'px' }); spot.appendChild(el); return el; };
    state.focus = async (targets, opts = {}) => {
      const { sections, all } = resolve(targets, opts.arrows);
      spot.style.opacity = '0';
      spot.replaceChildren();
      const veil = document.createElement('div');
      Object.assign(veil.style, { width: W + 'px', height: H + 'px', background: '#ffffff', opacity: String(opts.dim ?? 0.78) });
      layer(veil, 0, 0);
      const lit = await X.exportToSvg({
        elements: all, files: raw.files || {}, exportPadding: PAD,
        appState: { exportBackground: false, exportWithDarkMode: false },
      });
      const [sx, sy] = X.getCommonBounds(all);
      layer(lit, sx - minX, sy - minY);
      if (opts.outline !== false) {
        const sketch = document.createElementNS(NS, 'svg');
        sketch.setAttribute('width', W); sketch.setAttribute('height', H);
        layer(sketch, 0, 0);
        const rc = X.rough.svg(sketch);
        const m = 18;
        for (const section of sections) {
          const b = box(section);
          const g = rc.rectangle(b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m, { stroke: opts.color || '#f08c00', strokeWidth: 3.5, roughness: 1.4, bowing: 1.2, seed: 7 });
          for (const p of g.querySelectorAll('path')) {
            const len = p.getTotalLength();
            p.classList.add('sketch');
            p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
          }
          sketch.appendChild(g);
        }
      }
      requestAnimationFrame(() => {
        spot.style.opacity = '1';
        for (const p of spot.querySelectorAll('path.sketch')) p.style.strokeDashoffset = '0';
      });
      if (opts.zoom === false) return;
      const b = box(all);
      aim({ x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 }, opts.maxZoom ?? 1.8);
    };
    state.reset = () => { spot.style.opacity = '0'; overview(); };
    state.ready = true;
  } catch (err) {
    state.error = String(err && err.message || err);
  }
})();
</script></body></html>`;
