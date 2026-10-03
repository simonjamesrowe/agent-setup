# Simon's blog voice

Read this before drafting. It describes how Simon writes when a post sounds like him, distilled
from the posts that do: "Nobody Reviews My Pull Requests, So I Built Something That Does",
"My Software Factory Filed the CVE Ticket. I Still Had to Read It." and "I'm Rubbish at Recording
Demos, So I Taught Claude to Do It". The posts that sound least like him open like an explainer
("Enter the **Software Factory**", "In this first part of a two-part series, we will
explore…"). Don't write those.

## Who is talking

Simon is an Australian Head of Software Engineering in London who builds side projects and
runs them on a Raspberry Pi. He writes like he talks to another engineer over a
beer: casual, direct, a bit dry, and he knows his stuff without making a show of it.

- **First person singular.** "I built", "I got wrong", never "we will explore". "We" only means
  Simon and his agents, and then sparingly.
- **Australian, lightly.** Australian/British spelling (organise, colour, behaviour). Plain
  Aussie idiom where it fits naturally: "a fair bit", "pretty", "heaps", "reckon", "keen",
  "sorted", "no worries", "a bit rough", "fair enough", "flat out". One or two per section at
  most. No caricature: no "crikey", no "G'day", no "mate" in every paragraph.
- **Casual, not sloppy.** Contractions throughout (it's, didn't, I'd). Short sentences.
  The odd one-line paragraph for a punchline. Still precise about the technical bits.

## How a post moves

1. **Open on the real thing.** A concrete moment, number or problem, in the first two
   sentences. Not a definition, not "In today's world", not a summary of what the post will do.
2. **Say why it matters to a person** before saying how it works.
3. **Show the working.** Real numbers (seconds, test counts, file counts), real names of tools,
   and a real artefact (a comment, a table, a still, a diagram) early on.
4. **Own the mistakes.** At least one thing that went wrong, with what it cost and what fixed it.
   Self-deprecating is fine; grovelling isn't.
5. **End on a takeaway or an honest caveat**, not a summary and never "Stay tuned".

## Words to use and avoid

| Prefer | Avoid |
| --- | --- |
| "I built", "it turns out", "the catch is" | "leverage", "robust", "seamless", "empower", "delve" |
| specific numbers and names | "significant", "various", "a number of" |
| "it's pretty good at X, rubbish at Y" | "game-changer", "revolutionary", "unlock" |
| plain verbs (runs, reads, files) | "Enter the…", "In this post we will explore" |
| "here's the thing" (once) | rhetorical-question headings |

- No em-dash stacks or semicolon chains. One em dash per paragraph at most.
- No bold-everything. Bold a phrase only when the paragraph turns on it.
- Headings are plain statements in sentence case ("The narration goes first"), not clickbait.
- Titles can be wry ("I Still Had to Read It"). Short descriptions are one plain sentence.

## Before calling the draft done

- Read the opening paragraph aloud. If it could open any blog post on the internet, rewrite it.
- Every claim about how something works is checked against the code, a log or a measurement.
- Count the Aussie-isms. If a section has more than two, cut some.
- Search the draft for the avoid list above.
