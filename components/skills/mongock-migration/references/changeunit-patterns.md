# Change Unit Patterns (extracted from the repo)

Every excerpt below is real code from
`~/workspace/simonjamesrowe/simonrowe-dev-monorepo`, from these files:

- `backend/src/main/java/com/simonrowe/migration/changeunits/V014MakeFavouritesGlobal.java`
- `backend/src/main/java/com/simonrowe/migration/changeunits/V013CreateFavouritesUniqueIndex.java`
- `backend/src/main/java/com/simonrowe/migration/changeunits/V012MergeDanVegaSources.java`
- `backend/src/main/java/com/simonrowe/migration/changeunits/V011SeedAndBackfillDanVegaBlog.java`
- `backend/src/main/java/com/simonrowe/migration/changeunits/V010BackfillArticlePublishedDates.java`
- `backend/src/main/java/com/simonrowe/migration/MongockConfig.java`
- `backend/src/test/java/com/simonrowe/migration/changeunits/V014MakeFavouritesGlobalTest.java`
- `backend/src/test/java/com/simonrowe/migration/changeunits/V012MergeDanVegaSourcesTest.java`
- `backend/src/test/java/com/simonrowe/migration/changeunits/V011SeedAndBackfillDanVegaBlogIntegrationTest.java`
- `backend/src/test/java/com/simonrowe/AbstractIntegrationTest.java`
- `backend/src/test/java/com/simonrowe/SharedMongoContainer.java`

Re-read the two highest-order change units before writing a new one; this file is
a snapshot up to order `014`.

## 1. Wiring

`MongockConfig` is the only enabling code. Nothing else needs touching when you
add a change unit — the package is scanned.

```java
/**
 * Enables Mongock, which runs the change units under
 * {@code com.simonrowe.migration.changeunits} on application startup. Each change
 * unit is tracked in MongoDB and executed at most once. Can be turned off with
 * {@code MONGOCK_ENABLED=false}.
 */
@Configuration
@EnableMongock
public class MongockConfig {
}
```

`backend/src/main/resources/application.yml`:

```yaml
mongock:
  enabled: ${MONGOCK_ENABLED:true}
  migration-scan-package:
    - com.simonrowe.migration.changeunits
```

Mongock version is `5.5.1` (`gradle/libs.versions.toml`), with
`io.mongock:mongock-springboot-v3` + `io.mongock:mongodb-springdata-v4-driver`.

## 2. Class shape and naming

Filename/class `V<order><PascalCaseSummary>`, annotation id in
`kebab-case`, `order` as a zero-padded 3-digit string, `author` always
`simonrowe`:

```java
@ChangeUnit(id = "make-favourites-global", order = "014", author = "simonrowe")
public class V014MakeFavouritesGlobal {

  private static final String COLLECTION = "favourites";
  private static final String OLD_UNIQUE_INDEX = "idx_user_type_content";
  private static final String UNIQUE_INDEX = "idx_type_content";
  private static final String LIST_INDEX = "idx_type_created";
```

Imports are always the annotation trio:

```java
import io.mongock.api.annotations.ChangeUnit;
import io.mongock.api.annotations.Execution;
import io.mongock.api.annotations.RollbackExecution;
```

Collection names and index names are `private static final String` constants, not
inline literals — the test asserts against the same names.

Class Javadoc states **what changes, why, and explicitly that it is idempotent**.
Verbatim from `V014`:

```java
/**
 * Migrates the {@code favourites} collection from per-user storage to a globally shared set.
 * Drops the per-user unique index, deduplicates rows so a piece of content appears once
 * regardless of who favourited it (keeping the earliest favourite), removes the now-unused
 * {@code userId} field, and creates the global indexes: a unique {@code (type, contentId)}
 * index for idempotency and a {@code (type, createdAt)} index that covers the sorted listing
 * query. Spring Data auto-index-creation is disabled, so indexes must be created explicitly.
 * Every step is idempotent, making this change unit safe to re-run.
 */
```

## 3. Dependency injection into `@Execution`

Method name is `execution`, and Mongock resolves params from the Spring context.
Params are `final` in 14 of the 15 existing change units — house style, not a
checkstyle-enforced rule. Three flavours actually used:

`MongoTemplate` for raw collection / index work (`V014`, `V013`):

```java
  @Execution
  public void execution(final MongoTemplate mongoTemplate) {
    dropIndexIfExists(mongoTemplate, OLD_UNIQUE_INDEX);
    deduplicateByTypeAndContent(mongoTemplate);
    mongoTemplate.getCollection(COLLECTION)
        .updateMany(new Document(), new Document("$unset", new Document("userId", "")));
    mongoTemplate.indexOps(COLLECTION).createIndex(new Index()
        .named(UNIQUE_INDEX)
        .on("type", Sort.Direction.ASC)
        .on("contentId", Sort.Direction.ASC)
        .unique());
```

A Spring Data repository for document-level rewrites (`V012`, `V010BackfillArticlePublishedDates`):

```java
  @Execution
  public void execution(final AggregatedArticleRepository articleRepository) {
```

A domain service or agent bean when the migration reuses application logic
(`V011` injects the Embabel `@Agent`, `V010PruneBackupsToRetentionLimit` injects
`BackupRetentionService`):

```java
  @Execution
  public void execution(
      final ContentSourceRepository contentSourceRepository,
      final ContentAggregationAgent aggregationAgent) {
```

## 4. Guard-clause idempotency

The repo's non-negotiable rule: **check before write, and return early**. Every
change unit must survive being replayed against an already-migrated database
(fresh local volume, restored backup, rolled-back history).

Existence guard with an early `return` and a log line (`V011`):

```java
    if (contentSourceRepository.findByName("Dan Vega").isPresent()) {
      log.info("Dan Vega source already present; skipping seed and backfill");
      return;
    }
```

Empty-work guard (`V012`):

```java
    List<AggregatedArticle> legacy =
        articleRepository.findBySourceName(LEGACY_SOURCE_NAME);
    if (legacy.isEmpty()) {
      log.info("No '{}' articles found; nothing to merge", LEGACY_SOURCE_NAME);
      return;
    }
```

Per-document `continue` guard so only unmigrated rows are touched
(`V010BackfillArticlePublishedDates`):

```java
    for (AggregatedArticle article : articles) {
      if (article.publishedDate() != null) {
        continue;
      }
      Instant fallback =
          article.fetchedAt() != null ? article.fetchedAt() : Instant.now();
```

Existence check before an index drop, so a re-run does not throw (`V014`):

```java
  private void dropIndexIfExists(final MongoTemplate mongoTemplate, final String indexName) {
    final boolean exists = mongoTemplate.indexOps(COLLECTION).getIndexInfo().stream()
        .anyMatch(info -> indexName.equals(info.getName()));
    if (exists) {
      mongoTemplate.indexOps(COLLECTION).dropIndex(indexName);
    }
  }
```

Deterministic dedupe — sort by a stable key, keep the first, delete the rest, so a
second run finds nothing to delete (`V014`):

```java
  /** Keeps the earliest favourite per {@code (type, contentId)} and deletes the rest. */
  private void deduplicateByTypeAndContent(final MongoTemplate mongoTemplate) {
    final MongoCollection<Document> collection = mongoTemplate.getCollection(COLLECTION);
    final Set<String> seen = new HashSet<>();
    for (final Document doc : collection.find().sort(new Document("createdAt", 1))) {
      final String key = doc.getString("type") + "|" + doc.getString("contentId");
      if (!seen.add(key)) {
        collection.deleteOne(new Document("_id", doc.get("_id")));
      }
    }
  }
```

Never-fail-boot wrapper for anything touching network or an LLM (`V011`) — a
failed enrichment must not abort startup:

```java
    try {
      aggregationAgent.backfillSource(saved, since);
    } catch (Exception e) {
      // A failed pre-population must never break app boot; the scheduled
      // aggregation job will pick up the source on its next run.
      log.error("Dan Vega backfill failed; leaving source for scheduled run", e);
    }
```

Log the count of what was changed, with `private static final Logger log =
LoggerFactory.getLogger(<Class>.class)`:

```java
    log.info("Re-tagged {} '{}' articles as '{}'",
        legacy.size(), LEGACY_SOURCE_NAME, CANONICAL_SOURCE_NAME);
```

## 5. `@RollbackExecution` is mandatory

Mongock requires the method; the repo's convention is that it either genuinely
inverts the change or carries a comment saying why there is nothing to undo.

Real inverse — restore the previous index shape (`V014`):

```java
  @RollbackExecution
  public void rollback(final MongoTemplate mongoTemplate) {
    dropIndexIfExists(mongoTemplate, UNIQUE_INDEX);
    dropIndexIfExists(mongoTemplate, LIST_INDEX);
    mongoTemplate.indexOps(COLLECTION).createIndex(new Index()
        .named(OLD_UNIQUE_INDEX)
        .on("userId", Sort.Direction.ASC)
        .on("type", Sort.Direction.ASC)
        .on("contentId", Sort.Direction.ASC)
        .unique());
  }
```

Simple inverse (`V013` drops what it created, `V011` deletes what it seeded):

```java
  @RollbackExecution
  public void rollback(final MongoTemplate mongoTemplate) {
    mongoTemplate.indexOps(COLLECTION).dropIndex(INDEX_NAME);
  }
```

```java
  @RollbackExecution
  public void rollback(final ContentSourceRepository contentSourceRepository) {
    contentSourceRepository.findByName("Dan Vega")
        .ifPresent(contentSourceRepository::delete);
  }
```

Documented no-op — note the parameter list can be empty:

```java
  @RollbackExecution
  public void rollback() {
    // Data re-tagging operation; nothing to roll back.
  }
```

```java
  @RollbackExecution
  public void rollback() {
    // Additive backfill of a previously-null field; nothing to roll back.
  }
```

## 6. Test pattern A — real MongoDB, change unit driven directly

The default. `mongock.enabled: false` in `backend/src/test/resources/application-test.yml`
means the change unit does **not** run at boot, so the test instantiates it with
`new` and calls `execution(...)` itself. Abridged, `V014MakeFavouritesGlobalTest`
(the `favourite(...)` document-builder helper is omitted — copy it from the real
file):

```java
/**
 * Exercises the per-user → global migration against a real MongoDB. Mongock is disabled in
 * tests, so the change unit is driven directly.
 */
class V014MakeFavouritesGlobalTest extends AbstractIntegrationTest {

  private static final String COLLECTION = "favourites";

  @Autowired
  private MongoTemplate mongoTemplate;

  private final V014MakeFavouritesGlobal changeUnit = new V014MakeFavouritesGlobal();

  @BeforeEach
  @AfterEach
  void dropCollection() {
    mongoTemplate.getCollection(COLLECTION).drop();
  }

  @Test
  void deduplicatesAcrossUsersKeepingEarliestAndUnsetsUserId() {
    mongoTemplate.getCollection(COLLECTION).insertMany(List.of(
        favourite("auth0|a", "NEWS", "a-1", Instant.parse("2026-07-02T10:00:00Z")),
        favourite("auth0|b", "NEWS", "a-1", Instant.parse("2026-07-01T10:00:00Z")),
        favourite("auth0|a", "EVENT", "e-1", Instant.parse("2026-07-03T10:00:00Z"))));

    changeUnit.execution(mongoTemplate);

    final List<Document> remaining =
        mongoTemplate.getCollection(COLLECTION).find().into(new ArrayList<>());
    assertThat(remaining).hasSize(2);
    assertThat(remaining).allSatisfy(doc -> assertThat(doc.get("userId")).isNull());
    ...
  }

  @Test
  void createsGlobalIndexesEnforcingUniqueTypeAndContent() {
    changeUnit.execution(mongoTemplate);

    mongoTemplate.getCollection(COLLECTION)
        .insertOne(favourite(null, "NEWS", "a-1", Instant.parse("2026-07-01T10:00:00Z")));

    assertThatThrownBy(() -> mongoTemplate.getCollection(COLLECTION)
        .insertOne(favourite(null, "NEWS", "a-1", Instant.parse("2026-07-05T10:00:00Z"))))
        .isInstanceOf(MongoWriteException.class);

    final List<String> indexNames = mongoTemplate.indexOps(COLLECTION).getIndexInfo().stream()
        .map(info -> info.getName())
        .toList();
    assertThat(indexNames).contains("idx_type_content", "idx_type_created");
  }
```

Key points:

- `extends AbstractIntegrationTest` — that base is `@SpringBootTest`,
  `@ActiveProfiles("test")`, `@AutoConfigureMockMvc`, and it `@MockitoBean`s
  `JwtDecoder`, `ElasticsearchOperations`, `VectorStore`, `BlogSearchRepository`,
  `ImageVariantGenerator`, `ContentChangePublisher` and Embabel's `Ai`. Mongo comes
  from `SharedMongoContainer` (`new MongoDBContainer("mongo:8")`, one static
  instance for the whole suite) via `@DynamicPropertySource`.
- **`@BeforeEach` *and* `@AfterEach` on the same teardown method.** Mandatory: the
  Testcontainer MongoDB is shared by every test class, so leftover documents and
  leftover *indexes* break unrelated tests.
- Assert on the real effects: surviving document count, that `userId` is gone,
  which `createdAt` survived, and that the unique index actually rejects a
  duplicate (`MongoWriteException`).

## 7. Test pattern B — pure Mockito, no Spring, no container

Use it when the change unit takes a repository and the logic is a straight
transformation. Abridged, `V012MergeDanVegaSourcesTest` (the `article(...)`
document-builder helper is omitted — copy it from the real file):

```java
@ExtendWith(MockitoExtension.class)
class V012MergeDanVegaSourcesTest {

  @Mock private AggregatedArticleRepository articleRepository;

  private final V012MergeDanVegaSources changeUnit = new V012MergeDanVegaSources();

  @Test
  void reTagsLegacyArticlesToCanonicalSource() {
    when(articleRepository.findBySourceName("danvega.dev"))
        .thenReturn(List.of(article("a", "danvega.dev"), article("b", "danvega.dev")));

    changeUnit.execution(articleRepository);

    ArgumentCaptor<AggregatedArticle> captor =
        ArgumentCaptor.forClass(AggregatedArticle.class);
    verify(articleRepository, org.mockito.Mockito.times(2)).save(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(AggregatedArticle::sourceName)
        .containsOnly("Dan Vega");
  }

  @Test
  void doesNothingWhenNoLegacyArticles() {
    when(articleRepository.findBySourceName("danvega.dev"))
        .thenReturn(List.of());

    changeUnit.execution(articleRepository);

    verify(articleRepository, never()).save(org.mockito.ArgumentMatchers.any());
  }
}
```

The second test is the important one: **the guard clause gets its own test** —
`verify(..., never()).save(...)` proves the no-op path.

## 8. Test pattern C — boot with Mongock actually enabled

Only needed when the risk is *startup wiring* (injecting an unusual bean into
`@Execution`) rather than the data transformation.
`V011SeedAndBackfillDanVegaBlogIntegrationTest` — note the class Javadoc explains
every choice:

```java
/**
 * Boots a real Spring context with Mongock enabled (overriding the suite-wide
 * {@code mongock.enabled=false}) to prove that the {@code V011} change unit — which
 * injects the Embabel {@code @Agent} {@link com.simonrowe.agents.ContentAggregationAgent}
 * into a Mongock {@code @Execution} — wires up and runs at application boot without
 * failing startup, which is V011's central requirement.
 *
 * <p>The network is never touched: {@link ScraperFactory} is replaced with a mock
 * that returns an empty list, so the guarded backfill processes nothing and no
 * articles are written. This class uses its own context (the distinct
 * {@code @TestPropertySource} makes it a separate cache key), so enabling Mongock
 * here does not affect the other integration tests. Seeded {@code content_sources}
 * and any aggregated documents are removed in teardown so nothing leaks into the
 * shared Testcontainers MongoDB used by the rest of the suite.
 */
@TestPropertySource(properties = "mongock.enabled=true")
class V011SeedAndBackfillDanVegaBlogIntegrationTest extends AbstractIntegrationTest {

  @MockitoBean
  private ScraperFactory scraperFactory;

  @Autowired
  private ContentSourceRepository contentSourceRepository;

  @Autowired
  private AggregatedArticleRepository aggregatedArticleRepository;

  @Autowired
  private AggregatedEventRepository aggregatedEventRepository;

  @BeforeEach
  void stubScraper() {
    // Mockito already returns an empty list for unstubbed collection-returning
    // methods (which is what applied during the boot-time Mongock run); this makes
    // the network-free contract explicit for any post-boot interaction.
    when(scraperFactory.scrape(any())).thenReturn(List.of());
  }

  @AfterEach
  void tearDown() {
    contentSourceRepository.deleteAll();
    aggregatedArticleRepository.deleteAll();
    aggregatedEventRepository.deleteAll();
  }

  @Test
  void seedsDanVegaSourceAtBootWithoutWritingArticles() {
    Optional<ContentSource> danVega = contentSourceRepository.findByName("Dan Vega");

    assertThat(danVega).isPresent();
    assertThat(danVega.get().scrapeStrategy())
        .isEqualTo(ContentSource.ScrapeStrategy.HTML_LISTING);
    assertThat(aggregatedArticleRepository.count()).isZero();
  }
}
```

Three things to copy:

1. `@TestPropertySource(properties = "mongock.enabled=true")` — the override, and
   also what forces a **separate Spring context** so the rest of the suite still
   runs with Mongock off.
2. `@MockitoBean` on the network-touching collaborator (`ScraperFactory`) so the
   boot-time execution cannot reach the internet. Mockito's default empty-list
   return is what applies *during* boot — the `@BeforeEach` stub only documents it.
3. `@AfterEach` `deleteAll()` on every repository the boot run could have written,
   because the change unit ran before the test method and the container is shared.

## 9. Choosing a pattern

| The change unit… | Pattern |
| --- | --- |
| does index work or raw `MongoTemplate` document surgery | A (`V014`) |
| transforms documents via a repository | B (`V012`), plus A if index/shape matters |
| injects a service/agent and the risk is boot wiring | C (`V011`) |

`com/simonrowe/migration/**` is on the JaCoCo exclusion list in
`backend/build.gradle.kts`, so a change unit does not move the coverage number —
which is exactly why the convention has to be enforced by habit and review
rather than by the gate.
