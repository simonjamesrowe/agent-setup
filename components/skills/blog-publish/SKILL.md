---
name: blog-publish
description: Create and publish first-party articles on simonrowe.dev through the admin CMS. Use when researching, drafting, illustrating, uploading, editing, or verifying a new Simon Rowe blog post.
---

# Publish A Blog Article

Create first-party articles as reviewed editorial content, then publish them through the
simonrowe.dev admin CMS. Do not seed blog documents with Mongock or write directly to MongoDB.

Keep a local Markdown draft and editable diagram sources in the monorepo so the published
article can be revised without reverse-engineering CMS content.

Paths below are relative to the simonrowe.dev monorepo workspace.

## 1. Establish the editorial brief

Before drafting, identify:

- the central argument and intended reader;
- the concrete change, project, or experience that makes the article timely;
- related posts that should be linked rather than repeated;
- claims that need current primary sources or direct evidence;
- whether the article needs explanatory diagrams.

Inspect the implementation, pull requests, existing posts, and relevant repository context.
Use web search for current external references. Prefer primary sources and link claims close to
the supporting material. Do not invent implementation details to make the narrative smoother.

## 2. Draft locally

Write the canonical draft under `docs/blogs/<slug>.md`. Use ordinary Markdown supported by the
site renderer:

- start with the opening paragraph rather than repeating the CMS title as an H1;
- use H2 headings for the main structure and H3 only when a section genuinely needs it;
- keep paragraphs compact and use lists for sequences or crisp comparisons;
- use fenced code blocks with a language when syntax highlighting is useful;
- give every image descriptive alt text;
- use absolute public paths for uploaded media in the final draft.

Aim for a clear personal argument rather than a changelog. Explain why the work matters, how it
operates, which constraints shaped it, and what remains unresolved.

Create a short CMS description independently from the introduction. It should explain the
article's value in one sentence and work on a preview card.

## 3. Choose the featured image

Use web search to find an editorial photograph or illustration that represents the subject and
fits the visual style of existing blog cards. Prefer reputable free-image sources such as
Unsplash or Pexels and verify the licence on the individual asset page.

The featured image is the article hero and listing preview. Apply these rules:

- **Do not use an Excalidraw, draw.io, Mermaid, architecture, process, or flow diagram as the
  featured image.** Diagrams belong inside the article body.
- Prefer a strong photographic or editorial composition with a clear focal point.
- Avoid generic AI imagery, illegible code montages, logos, screenshots, and images dominated by
  text.
- Check the crop at both wide hero and compact card proportions. Keep the subject useful when
  the sides or top and bottom are cropped.
- Download a practical web-sized JPEG, WebP, or PNG rather than an unnecessarily large original.
- Record the source page and creator while working, and include attribution when the licence
  requires it.

Inspect the image locally before uploading. Reject a technically relevant image if the crop,
lighting, or visual tone does not work with the site.

## 4. Create diagrams only when they clarify the argument

Use Excalidraw or draw.io for relationships, loops, layers, or workflows that are materially
harder to understand in prose. Keep the editable source under `docs/diagrams/` and export an SVG
for publication.

Use diagrams as inline figures after the paragraph that introduces the concept. Keep labels
short, use the article's vocabulary, and make the SVG readable on mobile and in dark mode.

Upload each diagram through the CMS media workflow, then replace the draft's local path with the
returned `/uploads/...` path. Keep the editable source and a local SVG export even though the
published article references CMS media.

## 5. Publish through the admin CMS

Only mutate production when the user has explicitly asked to publish or update the article.
Authenticate at `https://www.simonrowe.dev/admin` using credentials from the configured env
files. Never ask for, print, log, or commit credential values.

Use the browser-driven CMS workflow:

1. Open **Content** and create a new blog entry.
2. Set the title, short description, content type, tags, related skills, and published state.
3. Upload the editorial featured image with the featured-image control.
4. Upload inline media through the editor or media library.
5. Insert the final Markdown body with its `/uploads/...` image paths.
6. Save the entry and capture its public ID or URL.

Do not add a Mongock change unit, seed script, or raw database write for editorial publishing.
Those mechanisms are for reproducible application data changes, not ordinary CMS content.

The MDX editor can escape Markdown when a whole document is injected into its rich-text surface.
After saving, inspect the returned or rendered content. If headings appear as literal `##`, links
show their brackets, or image syntax is visible, update the entry through the authenticated admin
API in the same browser session with the original raw Markdown. Preserve all metadata and media
paths, and do not expose the access token.

## 6. Verify the public result

Open both the public article and `/blogs` after publishing. Confirm:

- both routes return HTTP 200;
- the article appears on the blog index with the correct title and description;
- the preview and hero use the editorial featured image, not an inline diagram;
- headings, lists, tables, links, and code blocks render as intended;
- every image is complete and has a non-zero natural width;
- diagrams remain inline at the intended point in the narrative;
- tags, skills, author, date, and content type are correct;
- the page title and article H1 match the CMS title.

Take a viewport screenshot of the published article when browser verification is part of the
task. Correct rendering or metadata problems before reporting completion.

## 7. Preserve the handoff

Report the public URL, publishing state, verification performed, and the local draft/diagram
paths. Keep temporary downloaded featured images in a gitignored workspace directory unless the
repository explicitly needs to own them.

Before committing local artifacts, run `git diff --check` and validate editable Excalidraw files
with `jq empty`. Do not commit credentials, browser state, downloaded temporary media, or an
editorial data migration.

## Gotchas

- The featured image and the first inline image serve different jobs; do not reuse a diagram for
  both merely because it already exists.
- A successful CMS response does not prove Markdown rendered correctly; always inspect the public
  article.
- A visible `<img>` element does not prove the asset loaded; check its completion state and
  natural dimensions.
- Upload media before finalising Markdown paths. Local `/images/...` paths are not automatically
  rewritten by the CMS.
- Preserve tags and skills when correcting an existing post through the admin API.
- Do not publish a draft merely because it exists locally; production publication requires an
  explicit request.
