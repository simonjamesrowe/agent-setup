---
name: demo-plan
description: Plan a narrated product demo video: grill Simon on the demo's aim, audience and key messages, write the brief, explore the product, and draft a scene-by-scene script for his approval. Use when Simon wants to record a demo of something he has built, a demo needs its story worked out, or a demo script needs drafting or revising before recording.
---

# Plan A Demo

A demo succeeds or fails on its story, not its recording. This skill produces
two approved artefacts in `~/workspace/simonjamesrowe/demos/<slug>/`:
`brief.md` (why the demo exists) and `script.mjs` (what is shown and said,
scene by scene). `demo-record` turns them into the video.

The runner lives in the sibling skill, and below it is `$DEMO`:

```bash
DEMO=<skills directory>/demo-record/scripts/demo.mjs   # e.g. ~/.claude/skills/demo-record/scripts/demo.mjs
```

## Workflow

### 1. Grill for the brief

Interview Simon in rounds with the `grilling` skill (or, without it, the same
way: ask every question whose prerequisites are answered, then wait). Each
round builds on the last. Push back on vague answers. "Show what it does" is
not an aim, and a list of six messages is really zero.

The tree, roughly in dependency order:

- **Product**: what it is, and where it runs (URL; prod or `local-env`; which
  data), plus every other site the story passes through (Linear, GitHub, …).
- **Audience**: who watches (hiring managers, engineers, prospective users)
  and what they already know.
- **Aim**: the single thing a viewer should believe or do afterwards.
- **Key messages**: at most three, each tied to something visible on screen.
  A message with no on-screen moment is cut or rethought.
- **The moment**: the one interaction that makes the demo worth watching,
  and where it lands in the running order.
- **Out of scope**: features to leave out, even impressive ones.
- **Constraints**: target length (default 60–120s), sign-in needed,
  side effects (emails sent, records created), flaky or slow steps
  (LLM answers, cold starts), and a sensible slug.
- **Outro**: the closing two sentences. The first says what was demoed, the
  second why it matters. They become the end card and the website blurb, so
  draft them with Simon rather than for him.

Done when every heading above has an answer Simon gave or explicitly
confirmed. An answer you inferred does not count.

### 2. Write the brief and scaffold

```bash
node $DEMO init ~/workspace/simonjamesrowe/demos/<slug>
```

`init` creates `script.mjs` from a template and, first time only, sets up the
demos workspace (Playwright, Chromium, `.gitignore`). Write `brief.md` beside
it with one short section per heading from step 1, in Simon's words.

### 3. Walk the product

Drive the real flow with browser automation (the Playwright MCP server)
against the environment the brief names, exactly as the demo will, and follow
it across every site it touches (Linear, GitHub, the product itself) in one
tab. Record:

- the accessible role and name, label, or test id for every element the demo touches;
- how long each step takes, and any step whose result varies between runs;
- every side effect and every banner, modal or empty state in the way;
- which sites need a signed-in session (captured once into `auth.json`; see the script format);
- anything broken (4xx/5xx, console errors). Stop and tell Simon: a demo
  of a broken page is not worth recording.

### 4. Draft the script

Fill in `script.mjs` following `demo-record`'s
[`references/script-format.md`](../demo-record/references/script-format.md).
Shape it as a story:

- Open with the problem or the hook in one or two sentences. Skip "Hi, I'm Simon".
- Give each key message at least one scene where it is visibly true, with its
  narration landing on that moment.
- Put "the moment" roughly two-thirds of the way through.
- Put sign-in and dismissing banners in `setup`; they are trimmed.
- End with the brief's two-sentence `outro`, verbatim.

Then generate the approval table and rehearse the actions:

```bash
node $DEMO plan ~/workspace/simonjamesrowe/demos/<slug>       # writes plan.md
node $DEMO rehearse ~/workspace/simonjamesrowe/demos/<slug> --headless
```

The draft is ready once `rehearse` passes every scene and the estimated
length fits the brief.

### 5. Approval gate

Show Simon the `plan.md` table (scene, on screen, narration, seconds), the
estimated length, and a line per key message naming the scene that carries
it. Ask him to approve or change it. Apply each tweak, re-run `plan` (and
`rehearse` when an action changed), and show the table again.

Offer a voice check before the full build: `node $DEMO narrate <dir>` voices
every line (cached for the build) so Simon can play a clip or two with `afplay`.

The gate closes only on Simon's explicit approval of the current table in
this conversation. Then continue with `demo-record`.

## Related skills

- `demo-record` — builds, verifies and delivers the video from the approved script.
- `grilling` — the interview loop used in step 1.
- `local-env` — the environment for demos with side effects or unreleased features.
