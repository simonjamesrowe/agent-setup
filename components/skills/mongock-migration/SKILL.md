---
name: mongock-migration
description: Create a Mongock change unit for simonrowe.dev data changes with the repo's idempotency and test patterns. Use when data needs migrating, backfilling, deduping, or seeding — any time an ad-hoc script is tempting.
---

# Write A Mongock Change Unit

**Every data change to simonrowe.dev ships as a Mongock change unit.** They live in
`backend/src/main/java/com/simonrowe/migration/changeunits/`, Mongock runs them on
application startup (each at most once, tracked in MongoDB), and that means the
same change applies to local, to a restored backup, and to prod on the next
deploy — with no one remembering to run anything.

The rule exists because the alternative has burned this repo before: `scripts/`
still contains one-off `*.js` seed scripts from the Strapi era that nobody can
tell you the state of. A `mongosh` one-liner is not reproducible, is not reviewed,
is not tested, and does not exist on prod.

## When to use

- Backfilling a new or previously-null field on existing documents.
- Deduping, re-tagging or reshaping documents after a model change.
- Creating a MongoDB index — **required**, because Spring Data
  auto-index-creation is disabled, so `@CompoundIndex` / `@Indexed` annotations on
  entities are *not* applied automatically.
- Seeding reference data (a content source, a config document).
- A one-time baseline cleanup that ongoing application logic will maintain from
  then on.
- Any time you are about to write `mongosh`, a `scripts/*.js` file, or "I'll just
  run this by hand on the Pi". That is the trigger.

**Not** for: restoring a whole database (`prod-data-restore`), or a change that
Spring Data would do naturally on write.

## Prerequisites

- Repo at `~/workspace/simonjamesrowe/simonrowe-dev-monorepo` (or a Conductor
  workspace clone). Java 21, Docker for tests.
- Docker + the local stack for the end-to-end verification in step 6 — see
  `local-env`. Not needed for the tests themselves (`backend-test`).
- Read [references/changeunit-patterns.md](references/changeunit-patterns.md)
  first. It holds the real annotations, guard-clause idempotency patterns,
  `@RollbackExecution` variants and all three test patterns, quoted from
  `V010`–`V014` and their tests.

## Workflow

### 1. Read the two most recent change units

Conventions live in the code, not in docs, and they drift. Always start here:

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo
ls backend/src/main/java/com/simonrowe/migration/changeunits/
grep -h '@ChangeUnit' backend/src/main/java/com/simonrowe/migration/changeunits/*.java | sort -t'"' -k4
```

Open the two highest orders and their tests. At the time of writing the tip is
`V014MakeFavouritesGlobal` (order `014`, with `V014MakeFavouritesGlobalTest`) and
`V013CreateFavouritesUniqueIndex` (order `013`). Copy the shape of whichever is
closest to your change.

### 2. Pick the id, order and class name

```java
@ChangeUnit(id = "make-favourites-global", order = "014", author = "simonrowe")
public class V014MakeFavouritesGlobal {
```

- `order` — the next zero-padded 3-digit string. **Check it is unused**: there are
  already two change units at order `010`
  (`V010BackfillArticlePublishedDates`, `V010PruneBackupsToRetentionLimit`), which
  Mongock tolerates because `id` is the uniqueness key, but the relative order of
  those two is then undefined. Don't add a third collision.
- `id` — kebab-case, unique forever. **It is the tracking key.** Renaming an id
  after it has run anywhere makes Mongock treat it as a brand-new change unit and
  re-execute it. Never rename a shipped id; write a new change unit instead.
- Class/file name — `V<order><PascalCaseSummary>`, matching the id.
- `author` — `simonrowe`.

Write a class-level Javadoc that says what changes, **why**, and states explicitly
that it is idempotent. That last sentence is the repo's convention and it is what
a reviewer looks for.

### 3. Write `@Execution` with a guard clause

Method name `execution`, `final` parameters, injected from the Spring context:
`MongoTemplate` for index/document surgery, a Spring Data repository for
document rewrites, or a service/agent bean when reusing application logic.

The one rule that matters: **check before you write, and return early.** The
change unit must be safe to replay, because it will be — on a fresh local volume,
after a restore, after a rollback. Patterns, all real, in
[references/changeunit-patterns.md](references/changeunit-patterns.md) §4:

- existence guard + `log.info(...)` + `return` (`V011`)
- empty-work guard on a query result (`V012`)
- per-document `if (field != null) continue;` (`V010BackfillArticlePublishedDates`)
- `dropIndexIfExists` helper that inspects `getIndexInfo()` before dropping (`V014`)
- deterministic dedupe: sort by a stable key, keep the first, delete the rest (`V014`)
- `try/catch (Exception)` + `log.error` around anything hitting network or an LLM,
  so a failure cannot abort application boot (`V011`)

Log a count of what changed, via `private static final Logger log =
LoggerFactory.getLogger(<Class>.class)`. That log line is how you verify the run
in step 6.

### 4. Write `@RollbackExecution`

Mongock requires it. Either genuinely invert the change (`V014` restores the old
index, `V013` drops the index it created, `V011` deletes the source it seeded), or
leave an explicit comment saying why nothing needs undoing:

```java
  @RollbackExecution
  public void rollback() {
    // Additive backfill of a previously-null field; nothing to roll back.
  }
```

An empty, uncommented rollback is a review finding, not a convention.

### 5. Test it

`mongock.enabled: false` in `backend/src/test/resources/application-test.yml`, so
change units do **not** run during the suite. Pick a pattern
([references/changeunit-patterns.md](references/changeunit-patterns.md) §6–§9):

- **A — real MongoDB, driven directly** (default; `V014MakeFavouritesGlobalTest`):
  `extends AbstractIntegrationTest`, `@Autowired MongoTemplate`,
  `new V014MakeFavouritesGlobal()`, call `changeUnit.execution(mongoTemplate)`, and
  put the collection drop on **both `@BeforeEach` and `@AfterEach`** — the
  Testcontainers MongoDB is shared by the whole suite, so leftover documents *and
  leftover indexes* break unrelated classes.
- **B — pure Mockito, no Spring** (`V012MergeDanVegaSourcesTest`):
  `@ExtendWith(MockitoExtension.class)`, `@Mock` the repository, `ArgumentCaptor`
  on `save`. Fast. Always include the guard-clause test:
  `verify(repo, never()).save(any())`.
- **C — boot with Mongock on** (`V011SeedAndBackfillDanVegaBlogIntegrationTest`):
  `@TestPropertySource(properties = "mongock.enabled=true")` (which also isolates
  the Spring context so the rest of the suite keeps Mongock off), `@MockitoBean`
  the network-touching collaborator, `@AfterEach deleteAll()` every repository the
  boot run could have written. Only worth it when the risk is startup wiring.

Also add a test that proves **re-running is a no-op** — call `execution(...)`
twice and assert the state is unchanged. That is the property the whole design
depends on.

```bash
./gradlew :backend:test --tests '*V0<NN>*Test'
./gradlew :backend:checkstyleMain :backend:checkstyleTest
```

`com/simonrowe/migration/**` is JaCoCo-excluded, so the coverage gate will not
notice a missing test. Write it anyway.

### 6. Verify against the local stack

Bring the stack up (`local-env`) and restart the backend so Mongock runs:

```bash
docker compose up -d --wait
./scripts/start-backend.sh
```

Watch the boot log for the Mongock banner, your change unit's id, and your own
`log.info` count line. Then inspect the tracking collections and the data:

```bash
docker compose exec mongodb mongosh simonrowe --quiet --eval 'db.getCollectionNames()'
```

Mongock 5 stores history and the lock in its default collections
(`mongockChangeLog` and `mongockLock` — nothing in `application.yml` overrides
them; confirm from the list above):

```bash
docker compose exec mongodb mongosh simonrowe --quiet --eval \
  'db.mongockChangeLog.find({}, {changeId:1, state:1, author:1, timestamp:1}).sort({timestamp:-1}).limit(5).toArray()'
docker compose exec mongodb mongosh simonrowe --quiet --eval 'db.mongockLock.find().toArray()'
```

Your `changeId` should be there with an `EXECUTED` state. Then confirm the data
shape itself — documents, and indexes if you created any:

```bash
docker compose exec mongodb mongosh simonrowe --quiet --eval \
  'db.favourites.getIndexes()'
docker compose exec mongodb mongosh simonrowe --quiet --eval \
  'db.favourites.find().limit(3).toArray()'
```

**Then prove idempotency for real**: restart the backend a second time. The change
unit must be skipped (already in the history), and if you deliberately delete its
history row and restart, it must run again cleanly and change nothing.

### 7. Ship it

Commit the change unit and its test together; the pre-commit hook runs checkstyle,
the suite and coverage (`backend-test`). Once merged, `prod-deploy` publishes the
image and the change unit runs on the Pi at the next backend start — that is the
whole point. Watch the boot log there (`prod-logs`) to confirm it executed.

## Gotchas

- **A failing change unit aborts application startup.** Mongock throws and Spring
  Boot does not come up — on prod that is an outage. This is why network/LLM work
  is wrapped in `try/catch` (`V011`) and why guards come before writes.
- **Never rename or re-order a shipped `id`.** The id is the tracking key; a rename
  re-executes the change unit everywhere. Order changes on already-executed units
  are ignored.
- **Never edit a change unit that has already run.** Its history row says
  `EXECUTED` and it will not run again, so your edit silently applies nowhere.
  Write `V<next>` instead.
- **Indexes are only ever created by change units.** Spring Data
  auto-index-creation is off, so `@CompoundIndex`/`@Indexed` on an entity does
  nothing at runtime. If you added an index annotation, you also owe a change
  unit — that is exactly what `V013` and `V014` are.
- **A unique index will throw on creation if the existing data violates it.**
  Dedupe first, in the same change unit, in that order (`V014`:
  `dropIndexIfExists` → `deduplicateByTypeAndContent` → `createIndex`).
- **A stale `mongockLock` blocks startup.** If a previous boot was killed
  mid-migration the lock document can outlive it; Mongock will wait and then fail
  to acquire. Inspect `db.mongockLock.find()` and delete the row only once you are
  certain no other instance is running.
- **`mongock.enabled: false` in the test profile** means a change unit that
  compiles and is never called by a test is completely unexercised. Only pattern C
  runs it at boot.
- **Order collision at `010` already exists** — two change units share it. Don't
  copy that; check the existing orders before choosing yours.
- **`MONGOCK_ENABLED=false`** is the escape hatch for booting the backend without
  migrations (e.g. debugging against a restored database). Use it locally, never as
  a fix for a broken change unit.
- **Two change units, one deploy** is fine and normal; they run in `order`
  sequence. Just make sure the later one does not assume the earlier one's data if
  it might be replayed alone.

## Related skills

- `backend-test` — running the change-unit test, checkstyle and the coverage gate.
- `local-env` — bringing up MongoDB and restarting the backend to trigger a run.
- `prod-data-restore` — a restore drops and re-inserts collections, so change
  units get replayed against the restored data; that is the idempotency scenario.
- `prod-deploy` — how the change unit reaches prod and runs there.
- `prod-logs` — confirming the change unit executed on prod.
