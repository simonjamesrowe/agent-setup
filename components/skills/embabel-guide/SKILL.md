---
name: embabel-guide
description: Run the Embabel docs MCP server (embabel/guide) locally and register it, for authoring Embabel agent code on the JVM. Use when writing or debugging Embabel agents, goals, actions or conditions and the framework's own docs would help.
---

# Embabel Guide: The Embabel Docs MCP Server

`embabel/guide` is a self-hosted Spring Boot application that serves
RAG-backed MCP tools over the Embabel Agent Framework's own documentation,
graph-backed by Neo4j. There is no hosted version of this — no remote
endpoint you can point at — you build and run the container yourself, and
every query it answers costs an LLM call, so it costs tokens.

It is worth the setup because the org's own backend already depends on
Embabel: `AbstractIntegrationTest` in the monorepo
(`backend/src/test/java/com/simonrowe/AbstractIntegrationTest.java`) imports
`com.embabel.agent.api.common.Ai` and mocks it with `@MockitoBean protected
Ai ai;` so integration tests never make a live Embabel call. Embabel is a
real, load-bearing dependency, not a speculative one — its own docs are
worth having on tap when working on the code that depends on it.

## When to use / when not to

Reach for this when authoring or debugging:

- Embabel agents, GOAP-style goals, actions or conditions.
- Tools an Embabel agent exposes over MCP.
- Anything where the question is "what does the Embabel framework itself
  say about this API/pattern", not "what does Spring say".

Don't bother for general Spring Boot or Spring Framework questions — the
`spring-tools` MCP server and the `javadocs` MCP server answer those more
cheaply and need no server of your own running. This skill is specifically
for Embabel's own documentation corpus.

## Prerequisites

- Docker running, with `docker compose` v2 available.
- A JDK to build the jar with. The `pom` targets `java.version` 21 and the
  build below ran on a local Temurin 21.
- A free host port `1337` (the default MCP port — see Gotchas for Conductor
  port contention), plus Neo4j's `7474`/`7687`/`7473`.
- Neo4j, which the compose file brings up for you (see First run) — no
  separate Neo4j install needed for the Docker path.
- An LLM API key for anything needing a completion, exported as one of
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY` or
  `DEEPSEEK_API_KEY` (auto-detected in that order). Source the value from
  `~/workspace/simonjamesrowe/env` — never inline the key itself, in a
  command, a committed compose `.env`, or this skill. It is *not* needed to
  start the server or to ingest and search the corpus; see Health check.

## First run

Three steps, in this order. None of them can be skipped.

```bash
# 1. Clone. Any directory works; ~/workspace/<org>/<repo> is the house layout,
#    and `git clone` creates the parent directories for you.
git clone https://github.com/embabel/guide.git ~/workspace/embabel/guide
cd ~/workspace/embabel/guide   # already cloned? just `git pull` here

# 2. Build the jar. The Dockerfile does NOT compile anything — see below.
./mvnw -B -DskipTests package
cp target/guide-0.1.0-SNAPSHOT.jar guide-app.jar

# 3. Start Neo4j and guide. BOTH profiles are required — see below.
docker compose --profile neo4j --profile java up --build -d
```

**Both profiles, always.** `guide` lives in compose profile `java` and
`neo4j` lives in profile `neo4j`, and compose does not enable a dependency's
profile for you. With `--profile java` alone every compose verb — `config`,
`up` and `down` alike — fails before starting anything:

```
service "guide" depends on undefined service "neo4j": invalid compose project
```

With both profiles the ordering is what you'd want: `neo4j` Started →
Healthy, then `guide` Started.

**The jar is not optional.** `--build` cannot work from a fresh clone on its
own. The `Dockerfile` has a single `FROM eclipse-temurin:25-jre-jammy`, a
header comment reading "Expects guide-app.jar to be pre-built and placed in
this directory", and `COPY guide-app.jar app.jar`. There is no Maven stage in
it, so without step 2 the build dies at that COPY. Upstream's README still
describes a multi-stage build that compiles in-container — that text is
stale; the `Dockerfile` in the repo is what actually runs. `.dockerignore`
excludes `target/`, which is why the jar has to be *copied* to the
build-context root rather than referenced where Maven left it; both
`guide-app.jar` and `target/` are gitignored, so the clone stays clean. The
runtime image is Temurin 25 because the `ENTRYPOINT` passes JDK 25-only
flags; the jar itself is Java 21 bytecode and runs on any 21+ JRE.

**Expect the first run to be slow.** Timings from one cold-Docker-cache run
on an arm64 Mac:

- `./mvnw -B -DskipTests package` — about 10 seconds, but on an already-warm
  `~/.m2` and `~/.gradle`. A cold Maven cache must first fetch a large
  dependency tree from Maven Central and `repo.embabel.com` (anonymous, no
  credentials). That cost was **not measured here** — assume minutes.
- `docker compose ... up --build -d` — 14m12s wall clock, nearly all of it
  network: the Neo4j image pull, then the image build (base image 124s,
  `apt-get install curl` 64s, the ONNX embedding-model download 112s, the
  jar COPY 1s).
- `guide` then logged `Started GuideApplication in 72.4 seconds`.

On that run `guide` crashed twice before starting on the third attempt: it
clones the reference repositories listed in `references.yml` during context
startup, and two of those clones failed with `SSLHandshakeException: Remote
host terminated the handshake` — a single failed clone aborts the whole
application context. The service is `restart: unless-stopped`, so it retried
itself and came up about 3.5 minutes after `up` returned, with no
intervention. Don't read the first stack trace as a broken install.

If port `1337` is taken, compose maps `${GUIDE_PORT:-1337}:1337`, so
`GUIDE_PORT=1338 docker compose --profile neo4j --profile java up --build -d`
should move the endpoint to `http://localhost:1338/sse`. (Read from
`compose.yaml`; **not exercised here**.)

**Checking the LLM key reached the container.** Only `OPENAI_API_KEY` is
wired into the `guide` service's environment block, even though
`.env.example` documents four. Confirm what actually landed:

```bash
docker compose exec guide env | grep API_KEY
```

This works, and — unlike `up`/`down`/`config` — works without the profile
flags. On this run, with no key set anywhere, it printed exactly one line,
`OPENAI_API_KEY=` with an empty value: compose sets that variable whether or
not you exported it, and the other three provider keys never reach the
container at all. If you rely on a provider other than OpenAI, this is the
check that tells you your key never arrived.

To supply a key, export it from the env file before step 3:

```bash
export OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' ~/workspace/simonjamesrowe/env | cut -d= -f2-)"
```

**Unverified:** this run was deliberately done with no key at all, so the
export line above is documented from the env-file convention but was not
exercised.

## Ingesting the docs corpus

A freshly-started stack has *nothing in it*. `guide.reload-content-on-startup`
is `false` in `application.yml`, the compose `guide` service does not override
it, and the compose path ships no seeded database — so no ingestion happens at
boot. Straight after `up`:

```bash
curl -s http://localhost:1337/api/v1/data/stats
# {"chunkCount":0,"documentCount":0,"contentElementCount":0,...}
```

and an MCP vector-search call against that server returned `0 results:`.

Ingestion is a separate, explicit step:

```bash
curl -X POST http://localhost:1337/api/v1/data/load-references
```

That returned HTTP 200 after 74.5 seconds with the list of URLs it loaded,
after which the same stats call read
`{"chunkCount":1712,"documentCount":23,"contentElementCount":2892,...}` and
vector search returned real, scored, relevant chunks. It needs **no LLM API
key** — chunk embedding uses the local ONNX `all-MiniLM-L6-v2` model baked
into the image at build time.

`./scripts/fresh-ingest.sh` wipes and re-ingests, but runs the app on your
host through `./mvnw` rather than in the container, so it is not the tool for
the Docker path. (Read from the script; **not run here**.)

## Health check

```bash
curl -i --max-time 3 http://localhost:1337/sse
```

Verified response: `HTTP/1.1 200`, `Content-Type: text/event-stream`, and an
`event:endpoint` line carrying a `sessionId`. **`curl` then exits 28,
"Operation timed out" — and that is the success case, not a failure.** `/sse`
is a long-lived stream, so `--max-time` always cuts it off after the headers
have already printed. Judge the headers, not the exit code.

Two failure shapes worth telling apart:

- `curl: (52) Empty reply from server` — Docker has published port `1337` but
  the JVM behind it isn't listening yet. This is what the first minute after
  `up` looks like, and what a restarting container looks like — *not*
  connection refused. Check `docker compose logs -f guide`.
- A healthy `200` but `chunkCount: 0` from `/api/v1/data/stats` — the server
  is fine and has nothing to search. See Ingesting the docs corpus.

**Running without an LLM key is a real, usable state.** With no key set, the
app started normally and logged its available models as:

```
Available LLMs:
	name: setup-required, provider: none
	name: all-MiniLM-L6-v2, provider: onnx
```

Retrieval still worked in that state — the MCP tool list came back with all
ten tools and vector search returned scored chunks, on local embeddings
alone. What you don't get is anything needing a completion. If searches
return content but written answers never arrive, check the key before
suspecting the corpus.

## Registering the MCP server

This server is opt-in, not installed by default, because a dead server
nobody started would otherwise be configured on every machine. Enable it
with:

```bash
npx @simonjamesrowe/agent-setup --with embabel-guide
```

That registers, at user scope, for each detected coding agent:

```
npx -y mcp-remote http://localhost:1337/sse --transport sse-only
```

The `-y` is load-bearing: without it npx can stop to confirm the `mcp-remote`
install, and an MCP client launching this over non-TTY stdio can never answer
that prompt — the server just fails to start, looking like a `guide` fault.
Upstream's own documented client configs all use the `-y` form.

`mcp-remote` is a stdio bridge: it's what lets an agent that only speaks
stdio MCP talk to `guide`'s SSE endpoint. Once registered, the tools appear
under whatever prefix `guide.toolPrefix` is set to in the server's own
configuration — it is `@DefaultValue("")`, so by default there is no prefix
and tools keep their own names. Listing them against the running server
returned ten, all unprefixed: four `docs_docs_*` retrieval tools
(`vectorSearch`, `textSearch`, `broadenChunk`, `zoomOut`), three
`embabel_agent_find*` signature lookups, and three session/utility tools.

## Shutting down

```bash
cd ~/workspace/embabel/guide
docker compose --profile neo4j --profile java down --remove-orphans
```

Both profiles again: `docker compose --profile java down --remove-orphans`
fails with the same `depends on undefined service "neo4j"` error and tears
down nothing at all. With both profiles, `guide` and `neo4j` are removed
along with the `guide_embabel-network` network.

Add `-v` to also drop the four Neo4j volumes compose created
(`guide_neo4j_data`, `_logs`, `_import`, `_plugins`). Keep them and the
ingested corpus survives a restart; drop them and you must re-run
`load-references` after the next `up`.

After this, the MCP server registration you added above is still in place —
it will simply fail to connect until `guide` is brought back up. That's the
expected, correct state when you're not using it, not a broken install. Bring
it back with the same `docker compose --profile neo4j --profile java up
--build -d` from First run; the jar and images already exist, so it is fast.

## Gotchas

- **Conductor port contention.** Multiple Conductor workspaces can each try
  to bind `1337` (and Neo4j's `7474`/`7687`) for their own `embabel/guide`
  checkout. Only one can hold the port at a time. See `local-env` for the
  general pattern of finding and stopping whichever workspace holds a
  contended port before starting your own stack.
- **Start the server before the agent, not after.** `mcp-remote` connects
  when the agent starts; if `guide` isn't listening yet, the agent will show
  the server as failed and won't retry on its own. Get `guide` healthy first,
  then start or restart the agent.
- **An empty corpus, not a cold one, is why early answers are thin.** Nothing
  is ingested at boot on the Docker path, so a freshly-started `guide` returns
  *zero* results rather than sparse ones. Run
  `POST /api/v1/data/load-references` and check `chunkCount` before concluding
  the setup is broken — see Ingesting the docs corpus.
- **Only `OPENAI_API_KEY` is passed through by the compose file today** —
  see First run. If you're relying on a different provider, verify the key
  actually landed in the container rather than assuming the `.env.example`
  list is what compose wires up.
- **This costs real LLM tokens per query** against whichever provider key
  you supplied — it is not free to leave running and querying continuously.

## Related skills

- `local-env` — the house pattern for diagnosing and resolving Conductor
  workspace port contention, which applies directly to `guide`'s fixed
  `1337`/`7474`/`7687` ports.
- `spring-boot-upgrade` — Embabel's Spring Boot 4 compatibility is one of
  the open blockers tracked there; this skill is where you'd go to actually
  ask Embabel's own docs about it.
- `backend-test` — documents how the monorepo mocks Embabel's `Ai` bean in
  `AbstractIntegrationTest`, which is the dependency this skill's setup is
  justified by.
