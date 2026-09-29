---
name: demo-record
description: Build a narrated product demo video from an approved demo script — Google Cloud TTS voice-over, a full-viewport Playwright recording, and an ffmpeg mix into a finished MP4 with captions and poster. Use when a demo script is approved and needs recording, a demo needs re-recording after tweaks, or a narrated walkthrough video of a web app is wanted.
---

# Record A Narrated Demo

One command turns a demo directory into a finished video. The runner is
`scripts/demo.mjs` in this skill's directory; below it is `$DEMO`:

```bash
DEMO=<this skill's directory>/scripts/demo.mjs   # e.g. ~/.claude/skills/demo-record/scripts/demo.mjs
```

It works narration-first: every scene's voice-over is synthesised before the
browser opens, so the recorder knows how long to hold each scene
(`max(action, narration)`), and each clip is mixed in at the wall-clock moment
its scene actually started. Frames come from Chromium's screencast at the full
viewport (1920×1080 by default, no browser chrome), not Playwright's built-in
recorder, which encodes at 1 Mbps and blurs text.

Demos live in `~/workspace/simonjamesrowe/demos/<slug>/`: `brief.md` and
`script.mjs` are the source; `.build/` and `out/` are regenerable.

## Prerequisites

- **An approved script.** `script.mjs` comes out of `demo-plan`, including
  Simon's sign-off on the plan table. With no approval in this conversation,
  run `demo-plan` first. Recording is cheap to redo; narration Simon never
  agreed to is not.
- `ffmpeg` and `ffprobe` on `PATH` (`brew install ffmpeg`).
- Google TTS credentials. The runner loads `~/workspace/simonjamesrowe/env`
  itself (override with `--env-file <path>`) and uses `GOOGLE_CLOUD_TTS_API_KEY`,
  falling back to gcloud application-default credentials with
  `GOOGLE_CLOUD_TTS_PROJECT_ID` as the quota project. The default voice is
  `GOOGLE_CLOUD_TTS_VOICE_NAME` (the site's narration voice, `en-GB-Chirp3-HD-Charon`).

## Workflow

### 1. Pre-flight

```bash
node $DEMO check ~/workspace/simonjamesrowe/demos/<slug>
```

Every line must be `✓`: ffmpeg, Playwright resolvable from the demo directory,
Chromium launches, TTS reachable, voice available. `init` (run by `demo-plan`)
installs Playwright into the demos workspace; if it is missing, run
`npm i -D playwright && npx playwright install chromium` in
`~/workspace/simonjamesrowe/demos`.

### 2. Build

```bash
node $DEMO build ~/workspace/simonjamesrowe/demos/<slug>
```

The build runs four stages (narration, recording, mixing, then captions and
stills) and prints each scene as it completes. Add `--headed` to watch the
browser. A failing scene aborts the build and names the scene with a
screenshot at `.build/failure-<scene>.png`. Fix the action in `script.mjs`
and re-run; narration is cached, so only changed lines are re-voiced.

### 3. Verify, then deliver

The build is done only when all of these hold:

- The summary line shows `h264 1920x1080 · aac` and a plausible duration
  (the plan's estimate plus any waits the actions add).
- **No `⚠ page problem` lines.** These are HTTP 4xx/5xx responses, failed
  requests and page errors captured while recording. A broken image or error
  toast that ends up in a published demo is the worst outcome. Fix the
  environment (`prod-triage`, or record against `local-env`), then rebuild.
- **Every still in `.build/stills/` looked at**: one frame per scene plus the
  end card. Check for spinners, empty states, cookie banners, a cursor parked
  over the content, and a two-sentence end card that reads correctly.
- Spot-check sync: `.build/timeline.json` has each scene's `audioStart`. The
  narration should begin within about 0.5s of it. Measure with
  `ffmpeg -i out/<slug>.mp4 -af silencedetect=n=-40dB:d=0.3 -f null -`.

Then hand Simon the deliverables in `out/`:

| File | Use |
| --- | --- |
| `<slug>.mp4` | H.264/AAC, `+faststart`, −16 LUFS, ready for a web `<video>` |
| `<slug>.vtt` | WebVTT captions from the written narration |
| `poster.jpg` | Poster frame (first scene, or `poster: '<scene-id>'`) |
| `summary.txt` | Title plus the two outro sentences, for the page's description |

### 4. Tweak loop

Feedback on a built video maps to one edit in `script.mjs`, followed by a rebuild:

- Wording → edit `say` (only that scene is re-voiced).
- A mispronounced word → add it to `pronounce` (voice-only; captions keep the spelling).
- Pacing → `gap`, `order`, `wait(…)` inside `do`, or `voice.speakingRate`.
- Something on screen → the scene's `do`. Run `node $DEMO rehearse <dir>` to watch
  the actions in a headed browser without spending on TTS or encoding.

Listen to narration alone with `node $DEMO narrate <dir>`. It prints each
clip's path and duration; play one with `afplay <clip>.wav`.

## Script format

The full `script.mjs` contract (scene fields, the action helpers, signed-in
demos, the outro rule) is in
[`references/script-format.md`](references/script-format.md). Read it before
editing any scene.

## Gotchas

- **Everything plays in one tab.** A demo can cross any number of sites, from
  Linear to simonrowe.dev to GitHub, by following links or calling
  `page.goto(url)`. Links, forms and `window.open` calls that would open a new
  tab load in place instead, and a popup that still escapes is closed and its
  URL loaded in the recorded tab (logged as `↪ popup … loaded in the recorded tab`).
  An app that genuinely needs two windows at once cannot be recorded.
- **Third-party sites are noisy.** Another product's analytics and telemetry
  4xx/5xx show up as page problems. Silence the ones that are not yours with
  `ignoreProblems`, and never silence your own product's.
- **LLM-backed features vary between takes.** Wait on the element that proves
  the answer arrived (`locator.waitFor()`), not a fixed sleep,
  and narrate over the wait so the video never sits silent on a spinner.
- **Long silences mean the action outlasted the narration.** The scene holds
  until both finish. Either narrate the wait or shorten it.
- **Setup is trimmed.** Anything in `setup` (sign-in, dismissing banners,
  seeding state) runs before the clock starts and never appears in the video.
- **Prod is a live audience.** A demo that submits forms or sends messages
  against `https://simonrowe.dev` has real effects (the contact form emails
  Simon). Record side-effecting flows against `local-env`.

## Related skills

- `demo-plan` — the grilling, brief and approved script this skill consumes.
- `local-env` — a local stack to record against, with `prod-data-restore` for real data.
- `prod-triage` — when a recording surfaces errors on the live site.
