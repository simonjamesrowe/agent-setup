---
name: content-source-add
description: Add a new content-aggregation source (blog/news/events scraper) to simonrowe.dev. Use when adding a site to aggregate, fixing a broken scraper, or backfilling articles from a source.
---

# Add A Content Aggregation Source

News and events on simonrowe.dev are aggregated from external sites. A
`content_sources` document names a site and a strategy; `ContentAggregationAgent`
scrapes each active source, classifies each item with an LLM, downloads its
image and saves an `aggregated_articles` or `aggregated_events` document.

There is **no admin "add source" form and no POST endpoint** — the admin API only
lists and updates existing sources. A new source is added by a **Mongock change
unit**, which also lets you backfill history in the same commit.

Paths below are relative to `~/workspace/simonjamesrowe/simonrowe-dev-monorepo`.

## When to use

- Adding a blog, news site, or events calendar to the aggregation feed.
- A source has stopped producing items (`lastError` set, or `lastFetchedAt`
  advancing with nothing new saved).
- Backfilling older articles from a source already seeded.
- Investigating missing images or wrong dates on `/news-events`.

## Prerequisites

- Local stack up and backend runnable — see `local-env`.
- An OpenAI key in `backend/.env` (env var name `OPENAI_API_KEY`): every scraped
  item is classified/summarised by `gpt-4o-mini` via the Embabel `Ai` API. With
  no key, items still save but fall back to title-as-summary.
- Familiarity with `mongock-migration` — the change unit conventions (id, order,
  guard clause, rollback, test) are defined there and not repeated here.

## Workflow

### 1. Pick the strategy

`ScraperFactory.scrape(source)` switches on `scrapeStrategy` and reads **one**
URL field per strategy. Getting the pairing wrong yields a silent zero-item
scrape.

| `scrapeStrategy` | Reads | Implementation | Use for |
| --- | --- | --- | --- |
| `RSS` | `feedUrl` | `RssScraper` (rome) | Any site with a feed — **always prefer this** |
| `SITEMAP_HTML` | `sitemapUrl` | `SitemapHtmlScraper.scrape` | No feed, but a `sitemap.xml` listing articles |
| `HTML_LISTING` | `baseUrl` | `SitemapHtmlScraper.scrapeListingPage` | No feed or sitemap; a `/blog` index page |
| `HTML` | `baseUrl` | `SitemapHtmlScraper.scrapeEventsPage` | Events listing pages |
| `LUMA` | `feedUrl` (a lu.ma calendar id) | `LumaApiScraper` | lu.ma calendars |

`sourceType` is `BLOG`, `NEWS` or `EVENTS`. It matters twice: `RSS` sets
`isEvent` on scraped items when the type is `EVENTS`, and `processScrapedItem`
routes to `processEvent` if the LLM says event **or** `sourceType == EVENTS`
**or** the scraper flagged it.

### 2. Probe the site before writing any code

```bash
curl -sS https://example.com/feed.xml | head -40           # RSS/Atom present?
curl -sS https://example.com/sitemap.xml | grep -c '<loc>' # sitemap entries
curl -sS -A 'Mozilla/5.0' https://example.com/blog | grep -o 'href="[^"]*"' | sort -u | head -40
```

For `SITEMAP_HTML` and `HTML_LISTING`, article URLs must pass the scraper's
filters or you get zero items:

- `looksLikeArticle` (sitemap): path needs **2+ segments**, must contain a
  `blog`/`news`/`article`/`post` segment, must not *end* in `blog`, `news`,
  `article`, `post`, `category`, `tag`, `author`, `page`, `developers`,
  `newsletter`, and must not be a localised prefix (`/de/`, `/ja/`, …).
- `isArticleLink` (listing): same host as the listing page, 2+ path segments,
  no `#`, no `?page=`, not the listing URL itself, and the path **must start
  with the listing's own section** (`/blog` listing only accepts `/blog/…`).

Both cap at `MAX_ARTICLES = 20` per run, sleep 1s between requests, time out at
15s and send a hard-coded Chrome user agent. Sites that block that UA fail here.

### 3. Write the seed + backfill change unit

`V011SeedAndBackfillDanVegaBlog` is the reference. It guards on
`findByName`, saves the source, then calls
`ContentAggregationAgent.backfillSource(saved, since)` inside a `try/catch` that
logs and swallows — a failed pre-population must never break app boot.

```java
@ChangeUnit(id = "seed-and-backfill-<slug>", order = "0NN", author = "simonrowe")
public class V0NNSeedAndBackfill<Name> {

  @Execution
  public void execution(final ContentSourceRepository contentSourceRepository,
      final ContentAggregationAgent aggregationAgent) {
    if (contentSourceRepository.findByName("<Name>").isPresent()) {
      return;
    }
    ContentSource saved = contentSourceRepository.save(new ContentSource(
        null,               // id
        "<Name>",           // name — unique index
        "https://example.com/blog",   // baseUrl
        null,               // feedUrl      (set for RSS / LUMA)
        null,               // sitemapUrl   (set for SITEMAP_HTML)
        ContentSource.SourceType.BLOG,
        ContentSource.ScrapeStrategy.HTML_LISTING,
        true,               // active
        null, null));       // lastFetchedAt, lastError
    try {
      aggregationAgent.backfillSource(saved, Instant.now().minus(30, ChronoUnit.DAYS));
    } catch (Exception e) {
      log.error("<Name> backfill failed; leaving source for scheduled run", e);
    }
  }

  @RollbackExecution
  public void rollback(final ContentSourceRepository repo) {
    repo.findByName("<Name>").ifPresent(repo::delete);
  }
}
```

`backfillSource` skips items whose scraped `publishedDate` is before the cutoff;
items with **no** date are processed (they fall back to the fetch date). Both
seeding and backfill are idempotent — dedup is on `originalUrl`.

The equivalent raw document shape (as in `scripts/seed-content-sources.js`,
which is legacy reference material, not the supported path):

```js
{ name, baseUrl, feedUrl, sitemapUrl, sourceType, scrapeStrategy,
  active: true, lastFetchedAt: null, lastError: null }
```

### 4. Test it

```bash
./gradlew :backend:test --tests '*ScraperFactoryTest' \
  --tests '*SitemapHtmlScraperTest' --tests '*RssScraperTest' \
  --tests '*ContentAggregationAgentTest' --tests '*V0NN*'
```

Add a change-unit test alongside the existing ones (`mongock-migration` covers
the pattern), and if you touched a scraper add a case to
`SitemapHtmlScraperTest` — `isArticleLink` is package-private precisely so it
can be asserted directly. Full gate and Checkstyle: `backend-test`.

### 5. Run it locally

Booting the backend runs Mongock, so the change unit seeds and backfills:

```bash
docker compose up -d --wait && ./scripts/start-backend.sh
```

Watch for `Seeded …`, `Backfilling N items from …`, `Saved article: …`. To
re-run aggregation for **all** active sources without a restart, use the admin
UI (`http://localhost:5173/admin/aggregated-content` → trigger aggregation,
needs the `DEV_PORTAL_ADMIN` role) or the endpoint it calls:

```
POST /api/admin/aggregation/trigger    # all active sources, async
POST /api/admin/aggregation/import     # {"url": "..."} single page
```

`/admin/content-sources` lists sources and toggles `active`; the API also accepts
`feedUrl` and `sitemapUrl` on `PUT /api/admin/content-sources/{id}`. Nothing
else about a source is editable at runtime.

Otherwise the scheduler picks it up: `aggregation.schedule.cron` is
`0 0 */6 * * *` (6-hourly) and the digest job is `0 0 8 * * MON`.

### 6. Verify the documents — images and dates

Both have regressed before, so check them explicitly:

```bash
docker compose exec -T mongodb mongosh simonrowe --quiet --eval '
  db.content_sources.find({}, {name:1, scrapeStrategy:1, active:1, lastFetchedAt:1, lastError:1}).pretty();
  db.aggregated_articles.countDocuments({sourceName: "<Name>"});
  db.aggregated_articles.find({sourceName: "<Name>"},
    {title:1, publishedDate:1, imageUrl:1, visible:1}).sort({publishedDate:-1}).limit(5).pretty();
  db.aggregated_articles.countDocuments({sourceName: "<Name>", imageUrl: null});
  db.aggregated_articles.countDocuments({sourceName: "<Name>", publishedDate: null});'
```

Both trailing counts must be `0`.

- **Images**: `SITEMAP_HTML`/`HTML_LISTING` read `og:image` then the first
  suitable `<img>`; `LUMA` uses `cover_url`; **`RSS` carries no image at all**,
  so those articles go through `BlogImageGenerationService` instead.
  `ExternalImageDownloader` only accepts `jpg/jpeg/png/gif/webp/avif`, ≤5 MB,
  10s timeout, then `MediaVariantResolver` rewrites the path to the best of
  `large`/`medium`/`small`/`thumbnail`. A null `imageUrl` means download *and*
  generation both failed — check the backend log for that article's title.
- **Dates**: `publishedDate` is resolved scraper → LLM (`classification.publishedDate`)
  → a second fetch of the detail page → `fetchedAt` as last resort. Nulls used to
  be fatal because the news page sorts `publishedDate` descending and MongoDB
  sorts missing values last, burying them past the page size (see
  `V010BackfillArticlePublishedDates`).

### 7. Verify rendering

```bash
curl -sS 'http://localhost:8080/api/news?size=5&source=<Name>' | head -c 600
curl -sS 'http://localhost:8080/api/events?size=5' | head -c 600
```

`/api/events` defaults to an **upcoming-only** listing, so a backfilled source
whose events are all in the past returns `[]` here even when the documents
saved correctly — that is the default working as intended, not a broken
scrape. Add `?upcoming=false` to see past events too:

```bash
curl -sS 'http://localhost:8080/api/events?size=5&upcoming=false' | head -c 600
```

Then the page itself: with browser automation (Playwright MCP in Claude Code)
open `http://localhost:5173/news-events`, confirm the new source's cards appear
with an image, a sensible date and a working outbound link, and screenshot it.
Otherwise print those steps and ask Simon to confirm.

Saving also publishes a Kafka `ContentChangeEvent`, which drives the search
index and embeddings — so the new articles become reachable from chat and search
without a manual re-index.

### 8. Fixing a broken source

`runAggregation` isolates each source in a `try/catch`: success writes
`lastFetchedAt`, failure writes `e.getMessage()` into `lastError` and moves on.
So one dead site never blocks the others, and `lastError` is the first thing to
read.

Order of diagnosis: `lastError` on the document → backend log lines for
`Failed to scrape …` / `Fetched 0 items from …` → re-probe the URL by hand with
the scraper's user agent → re-check the URL filters in step 2 → consider
repointing the source to a different strategy (`V009RepointClaudeBlogToListing`
is the precedent: `SITEMAP_HTML` → `HTML_LISTING` in a change unit).

## Gotchas

- **`scripts/seed-content-sources.sh` does not work with compose-generated
  container names.** It requires a container literally named `mongodb` and exits
  `ERROR: MongoDB container 'mongodb' is not running`. Use
  `docker compose exec -T mongodb mongosh …`, or better, a change unit.
- **A strategy/URL mismatch fails silently.** `RSS` with only `sitemapUrl` set
  passes `null` to the feed reader, logs one error and returns zero items.
- **`MAX_ARTICLES = 20`** applies per scrape for the HTML strategies, so a
  backfill window wider than the newest 20 posts cannot be honoured. Deep
  history needs repeated runs or a dedicated import.
- **`normalizeUrl` only runs on manual `importFromUrl`.** Scheduled dedup
  compares the raw scraped URL, so a site that starts appending query strings
  will re-save the same article.
- **The `HTML` events strategy has a hard-coded `tessl.io` branch.** Another
  events page falls to `scrapeGenericEvents`, which is a much looser heuristic —
  verify item counts rather than assuming.
- **Items under 50 characters of content skip the LLM** entirely and get the
  title as their summary. Feeds that publish title-only entries look
  low-quality for this reason, not because classification failed.
- **`active: false` is invisible everywhere but the admin table.** A source that
  "does nothing" may simply be deactivated.
- **The unique index is on `name`.** Two change units seeding the same display
  name collide at boot (`V012MergeDanVegaSources` exists to clean up exactly
  that).

## Related skills

- `mongock-migration` — change unit conventions, tests, and ordering.
- `backend-test` — running the scraper tests, Checkstyle, coverage.
- `local-env` — bringing up MongoDB/Kafka/Elasticsearch and the backend.
- `chat-e2e-verify` — aggregated news/events also surface as chat widgets.
- `prod-logs` — reading `Failed to process source` from the production backend.
