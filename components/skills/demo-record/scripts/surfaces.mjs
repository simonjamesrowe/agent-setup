// A native demo is filmed from two sources at once: the Chromium screencast
// (diagrams, the end card) and the app window (ScreenCaptureKit). Both are
// lists of { file, t } frames stamped with wall-clock seconds, and the runner
// records a switch each time the picture moves from one to the other. This
// merges them into the single frame list the mixer expects.

// switches: [{ t, surface }], in time order; the first covers everything before it.
// sources: { [surface]: [{ file, t }] }, each in time order.
export function mergeSurfaces(sources, switches, end) {
  const merged = [];
  const gaps = [];
  for (let i = 0; i < switches.length; i++) {
    const from = i === 0 ? -Infinity : switches[i].t;
    const to = i + 1 < switches.length ? switches[i + 1].t : end;
    if (!(to > from)) continue;
    const frames = sources[switches[i].surface] || [];
    // What was on that surface when the picture cut to it: its last frame at or
    // before the switch. A surface that only paints on change (both do) has
    // nothing newer to offer until something moves.
    let held = -1;
    for (let j = 0; j < frames.length && frames[j].t <= from; j++) held = j;
    const segment = [];
    if (held >= 0) segment.push(i === 0 ? frames[held] : { file: frames[held].file, t: from });
    for (const f of frames) if (f.t > from && f.t < to) segment.push(f);
    if (segment.length === 0) gaps.push({ surface: switches[i].surface, from, to });
    merged.push(...segment);
  }
  return { frames: merged, gaps };
}
