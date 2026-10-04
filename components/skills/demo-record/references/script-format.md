# `script.mjs` format

A demo is one ES module exporting a plain object. It imports nothing: the
runner passes Playwright objects and helpers into each action. `node $DEMO plan`
and `build` validate it and fail with a list of every problem found.

```js
export default {
  title: 'Coparent — shared calendar',        // end card heading
  url: 'http://localhost:5173',                // opened before the clock starts
  link: 'coparent.app',                        // end card link (default: url's host)
  // slug: 'coparent-calendar',                // output name (default: directory name)
  // viewport: { width: 1920, height: 1080 },  // = the video resolution
  // deviceScaleFactor: 2,                     // 2 → 3840x2160 frames, sharper text, 4x the frames
  // colorScheme: 'dark',
  // voice: { speakingRate: 1.05 },          // site voice by default; name + languageCode only change together
  pronounce: { 'simonrowe.dev': 'simon rowe dot dev', OIDC: 'O I D C' },
  // storageState: 'auth.json',               // signed-in sessions (any number of sites), relative to the demo dir
  // ignoreProblems: ['sentry.io'],            // substrings of third-party noise to drop from page-problem warnings
  setup: async ({ page }) => {                 // trimmed from the video
    await page.getByRole('button', { name: 'Accept cookies' }).click();
  },
  // actionTimeoutMs: 20000,                   // default Playwright timeout per action
  // poster: 'calendar',                       // scene id for poster.jpg (default: first scene)
  // tail: 1.5,                                // seconds held after the outro narration

  scenes: [
    {
      id: 'calendar',                          // lower-kebab-case, unique; 'outro' is reserved
      show: 'Month view; cursor opens next Friday',  // plain English for the approval table
      say: 'Both parents see the same month at a glance.',
      order: 'together',                       // default; see below
      gap: 0.6,                                // seconds of breathing room after the scene
      do: async ({ page, cursor, wait, scroll, scrollTo, highlight }) => {
        await cursor.click(page.getByRole('gridcell', { name: /Friday/ }));
        await page.getByRole('dialog').waitFor();
      },
    },
  ],

  outro: 'That was the shared calendar in Coparent. It keeps both households on one plan without a single group chat.',
};
```

## Scene timing

`order` decides where the narration sits relative to the action, and so how
long the scene lasts:

| `order` | Scene length | Use it for |
| --- | --- | --- |
| `together` (default) | `max(action, narration) + gap` | Narrating while the thing happens: clicking, typing, scrolling |
| `do-then-say` | `action + narration + gap` | Getting somewhere first, then describing it: navigation, a slow load, an answer streaming in |
| `say-then-do` | `narration + action + gap` | Setting up a payoff: "watch what happens when I submit" followed by the submit |

`plan` applies the same formulas. Action times come from the last `rehearse`
(or `build`), and a scene whose action has changed since then is marked `+`
in the estimate until it is rehearsed again.

A scene without `say` is silent and lasts as long as its action. Keep silent
stretches under about two seconds.

## Action helpers

Every `do` (and `setup`) receives:

| Helper | Does |
| --- | --- |
| `page`, `context` | The Playwright page and browser context |
| `cursor.move(target)` | Glides the visible cursor to the element's centre |
| `cursor.click(target)` | Glides the cursor over, pauses briefly, then clicks |
| `cursor.type(target, text, { delay })` | Clicks, then types at a human pace (55ms per key by default) |
| `cursor.hover(target)` | Same as `move` |
| `scroll(pixels)` | Smooth wheel scroll; negative scrolls up |
| `scrollTo(target)` | Smoothly centres an element |
| `highlight(target, seconds)` | Draws an amber outline for emphasis |
| `wait(seconds)` | Pause |

`target` is a Playwright locator (prefer `page.getByRole(...)` /
`getByLabel` / `getByTestId`) or a CSS selector string. Move the cursor with
`cursor.*` rather than `locator.click()`: a bare click teleports, and the
viewer loses track of what happened.

## Crossing sites

One demo can move between products, and the recording is one continuous tab
throughout. Get to the next site the way a viewer would expect:

- **Follow a real link** with `cursor.click(...)`, then `await page.waitForURL('https://linear.app/**')`.
  Links with `target="_blank"` and `window.open` calls load in the same tab.
- **Jump directly** with `await page.goto('https://linear.app/…')`. It is an
  instant cut, so narrate the change of scene ("over in Linear, …").

The cursor reappears at its last position on each new page. Browser back works
too: `await page.goBack()`.

## Diagrams

A scene can switch to a hand-drawn Excalidraw diagram and walk through it,
highlighting one section at a time. Diagrams live in `diagrams/<name>.json`
beside `script.mjs`, and play in the same recorded tab as everything else.

```js
{ id: 'arch', show: 'Architecture diagram, whole view', say: '…',
  do: async ({ diagram }) => { await diagram.show('architecture'); } },
{ id: 'ingest', show: 'Focus: the ingestion path', say: '…',
  do: async ({ diagram }) => { await diagram.focus('ingestion'); } },
{ id: 'back', show: 'Back to the product', order: 'do-then-say', say: '…',
  do: async ({ page, diagram }) => { await diagram.reset(); await page.goto('https://…'); } },
```

| Helper | Does |
| --- | --- |
| `diagram.show(name)` | Renders `diagrams/<name>.json` full-screen, fitted to the viewport |
| `diagram.focus(targets, opts)` | Veils everything else, re-draws the targets crisp on top, sketches an amber outline around each, and glides the camera onto them |
| `diagram.reset()` | Clears the focus and returns to the whole view |

`targets` is one or an array of element ids, `groupIds` or frame names. Arrows
that join two focused elements light up with them. Pass `opts` to adjust:
`{ zoom: false }` keeps the camera still, `{ arrows: false }` leaves arrows
dimmed, `{ outline: false }` skips the sketch, and `dim` (0 to 1, default
0.78) and `maxZoom` (default 1.8) tune the effect. A demo can open on a
diagram with `url: 'diagram:<name>'`, and then needs an explicit `link` for
the end card.

**File format.** Either an array of Excalidraw element skeletons, which is the
format to author, or a real `.excalidraw` export (`{ "elements": […] }`) drawn by
hand at excalidraw.com, rendered exactly as drawn. Skeletons get the house style
automatically: Excalifont, rough strokes, rounded rectangles, and
**cross-hatch** fill on any shape with a `backgroundColor`.

```json
[
  { "type": "text", "id": "title", "x": 300, "y": -80, "text": "The software factory", "fontSize": 36 },
  { "type": "rectangle", "id": "github", "x": 0, "y": 0, "width": 200, "height": 90,
    "backgroundColor": "#a5d8ff", "groupIds": ["triggers"], "label": { "text": "GitHub\npull requests", "fontSize": 20 } },
  { "type": "rectangle", "id": "temporal", "x": 340, "y": 0, "width": 220, "height": 90,
    "backgroundColor": "#fff3bf", "label": { "text": "Temporal", "fontSize": 22 } },
  { "type": "arrow", "id": "a1", "x": 200, "y": 45, "points": [[0, 0], [140, 0]],
    "start": { "id": "github" }, "end": { "id": "temporal" }, "label": { "text": "webhook", "fontSize": 18 } }
]
```

Style rules that keep a diagram readable at 1080p:

- **Pastel fills only**: `#a5d8ff` blue (inputs, sources), `#b2f2bb` green
  (services, outputs), `#d0bfff` purple (processing), `#ffd8a8` orange
  (external), `#fff3bf` yellow (orchestration, decisions), `#c3fae8` teal
  (storage), `#ffc9c9` red (alerts, risk), `#eebefa` pink (analytics).
- **Sections are groups.** Give every element in a section the same
  `groupIds` entry and focus it by that name. Excalidraw frames also work as
  targets, but they render as plain grey boxes, not hand-drawn ones.
- Meaningful ids (`github`, `temporal`), since the script focuses by them.
- Boxes at least 160×80, labels at least 18px and the title at least 32px;
  keep 60px or more between boxes so arrows and their labels have room.
- Bind every arrow with `start`/`end` so it follows its boxes and lights up
  with them on focus.
- No emoji; Excalifont does not carry them.

Preview while authoring. Each command writes a 1920×1080 PNG to `.build/`:

```bash
node $DEMO diagram <demo-dir> <name>                     # whole view
node $DEMO diagram <demo-dir> <name> --focus triggers    # one walkthrough beat
```

Diagram rendering needs Excalidraw, React and esbuild in the demos workspace.
`init` installs them; the renderer is bundled once per demo into `.build/` and
served, with Excalidraw's own fonts, from a local server that exists only for
the length of the take.

## Native macOS apps

A demo can film a desktop app (Tauri, Electron, AppKit) instead of, or as
well as, a website. Add a `native` block and the runner attaches to the app,
sizes its window, and records that part of the screen with ScreenCaptureKit
while the browser stays headless for diagrams and the end card. The two
streams are cut together wherever the picture switches.

```js
export default {
  title: "Clinician's Veil — de-identified on the Mac",
  url: 'native',                                // open on the app, not a website
  link: 'simonrowe.dev/portfolio/clinicians-veil',  // required: 'native' has no host
  native: {
    app: "Clinician's Veil",                    // name or bundle id
    path: "/Applications/Clinician's Veil.app", // launched if not already running
    // window: { width: 1440, height: 810 },    // points; must match the viewport's aspect ratio
  },
  scenes: [
    { id: 'open', show: 'Patients list', say: '…',
      do: async ({ app }) => {
        await app.cursor.click({ role: 'button', name: 'New note' });
        await app.waitFor({ role: 'textbox', name: 'Source text' });
      } },
    { id: 'diagram', show: 'Architecture diagram', say: '…',
      do: async ({ diagram }) => { await diagram.show('architecture'); } },   // cuts to the browser
    { id: 'back', show: 'Back in the app', say: '…',
      do: async ({ app }) => { await app.show(); } },                         // cuts back
  ],
  outro: '…',
};
```

Scenes receive `app` alongside the browser helpers:

| Helper | Does |
| --- | --- |
| `app.show()` | Cuts the video to the app and brings it to the front |
| `app.cursor.move(target)` / `.hover` | Glides the real pointer to the element's centre |
| `app.cursor.click(target, { count })` | Glides over, pauses, clicks (with a ripple) |
| `app.cursor.type(target, text, { delay })` | Clicks, then types at a human pace |
| `app.keyboard.type(text)` / `.press('Cmd+Shift+G')` | Types into, or sends a key combination to, whatever has focus |
| `app.paste(text)` | Pastes through the clipboard, then restores what was on it |
| `app.scroll(pixels)` / `app.scrollTo(target)` | Wheel scroll under the pointer / scroll an element into view |
| `app.draw(target, strokes, { duration })` | Pen strokes inside an element (a signature pad, a canvas); each stroke is `[x, y]` points from 0 to 1 across the element, smoothed into a curve |
| `app.selectText(target, phrase)` | Drags across a phrase inside the element's text, for apps that act on a mouse selection |
| `app.highlight(target, seconds, { text })` | Amber outline drawn in an overlay above the app; with `text`, around just that phrase, scrolled into view |
| `app.waitFor(target, { timeout, gone })` | Waits for an element to appear (or disappear) |
| `app.find(target)` / `app.text(target)` / `app.exists(target)` | Frame, accessible text, or presence |
| `app.chooseFile(path)` / `app.saveFile(path)` | Waits for the open or save panel, types the path into Go to Folder, confirms, and waits for it to close |
| `browser.show()` | Cuts to the browser tab (after a `page.goto`) |

Any `app` input or highlight cuts the picture to the app; `diagram.*` and
the end card cut to the browser. Lookups (`find`, `waitFor`, `text`) do not
cut, so a scene can wait on the app while a diagram is showing.

A `target` is an object found through the Accessibility tree:
`{ role, name, exact, id, className, subrole, index }`. `role` takes the
Playwright names (`button`, `link`, `textbox`, `checkbox`, `radio`, `tab`,
`combobox`, `heading`, `text`, `image`, `row`, `cell`, `list`, `group`,
`menuitem`) or a raw AX role (`AXSheet`). `name` matches the element's
title, description, value or placeholder: a case-insensitive substring, an
exact string with `exact: true`, or a RegExp. In a web view `id` and
`className` match the DOM element's id and classes, which helps where a
button has only an icon. `index` picks the nth match.

Things that differ from browser scenes:

- **It is the real screen and the real pointer.** Do not touch the mouse or
  keyboard during `rehearse` or `build`: the helper refuses to send input
  unless the app is frontmost, and stops the take if the pointer moves on
  its own. Turn on Do Not Disturb, since anything that appears over the
  window's area is filmed.
- **The Mac stays awake.** The runner holds `caffeinate` for the length of a
  native take; a locked screen is reported as such, since nothing can be
  brought to the front behind the lock screen.
- **Two permissions**, both for the app that runs the command (the terminal
  or agent host): Screen & System Audio Recording, and Accessibility.
  `node $DEMO check <dir> --prompt` adds it to both lists in System Settings;
  switch them on there, then quit and reopen that app. Turn them off again
  afterwards if you do not want that app to keep them.
- **No page problems are reported for the app.** Look at every still.
- **The window is sized in points.** 1440x810 fits a 14-inch MacBook Pro and
  is captured from 2880x1620 Retina pixels down to the 1920x1080 video.
- The helper (`scripts/native/DemoNative.swift`) is compiled once per change
  with `swiftc` into `~/Library/Caches/demo-record/`.

## Sounds: other voices, played aloud

A scene sometimes needs a second voice that the product itself hears: a
dictation feature transcribing speech, a voice assistant answering. Declare it
under `sounds` and play it from a scene with `play(name)`:

```js
sounds: {
  'phone-note': {
    say: 'Spoke with Ruth this afternoon. Sleep is better since the routine changed.',
    // voice: { name: 'en-GB-Chirp3-HD-Aoede', languageCode: 'en-GB' },  // default: the narration voice
  },
},
scenes: [
  { id: 'dictate', show: 'Dictates the phone note', order: 'do-then-say', say: 'Whisper wrote that, on this Mac.',
    do: async ({ app, play }) => {
      await app.cursor.click({ role: 'button', name: 'Dictate' });
      await play('phone-note');
      await app.keyboard.press('Escape');
    } },
],
```

Sounds are voiced with Google TTS alongside the narration and cached the same
way. `play` sends one through the Mac's speakers, so a microphone in the room
hears it, and waits until it finishes. The build mixes the same clip into the
video at the moment it played and adds it to the captions, so the viewer hears
what the product heard. Keep the scene's own narration out of the way, for
example with `order: 'do-then-say'`, or the two voices talk over each other.
The room has to be quiet, and the speaker volume up.

## Outro

`outro` must be **exactly two sentences**: what was demoed, then why it matters.
The build refuses anything else. It is narrated over a full-screen end card
(title, the two sentences, `link`), written to `out/summary.txt`, and it is
the blurb for the website listing.

## Signed-in demos

Capture a session once, outside the recording, and point `storageState` at it:

```bash
cd ~/workspace/simonjamesrowe/demos && npx playwright codegen --save-storage=<slug>/auth.json <first-login-url>
```

Sign in by hand in the window that opens. For a demo that crosses sites, navigate
the same window to each one and sign in there too, since one `auth.json` holds
every origin's cookies. Then close the window. `auth.json` holds live
session cookies, so keep it out of git (the workspace `.gitignore` written by
`init` excludes it). Password logins that can be scripted go in `setup`,
reading credentials from env var names and never inlining the values.

## Narration style

Write for the ear, in first person as Simon: short sentences, one idea each,
roughly 2.6 words per second of screen time. Describe the outcome rather
than the click ("the invite lands in both calendars", not "I click Save").
Spell out anything a voice would stumble on through `pronounce`, and keep
the written form in `say` so captions stay correct.
