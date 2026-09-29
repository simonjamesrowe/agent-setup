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
  // voice: { name: 'en-GB-Chirp3-HD-Charon', languageCode: 'en-GB', speakingRate: 1.05 },
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
