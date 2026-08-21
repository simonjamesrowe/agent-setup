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
- A free host port `1337` (the default MCP port — see Gotchas for Conductor
  port contention).
- Neo4j, which the compose file brings up for you (see First run below) — no
  separate Neo4j install needed for the Docker path.
- An LLM API key, exported as one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `MISTRAL_API_KEY` or `DEEPSEEK_API_KEY` (the server auto-detects whichever
  is set, checked in that order). Source the value from
  `~/workspace/simonjamesrowe/env` — never inline the key itself, in a
  command, a compose `.env` file committed to a repo, or this skill.

## First run

```bash
git clone https://github.com/embabel/guide.git ~/workspace/embabel/guide
# or: cd ~/workspace/embabel/guide && git pull

cd ~/workspace/embabel/guide
export OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' ~/workspace/simonjamesrowe/env | cut -d= -f2-)"
docker compose --profile java up --build -d
```

That one command starts both `neo4j` and `guide` (the Java application) —
`guide` depends on `neo4j` reaching a healthy state, so compose brings it up
first even though the two live in different compose profiles. First build
compiles the app from source inside the container (multi-stage Maven build),
so expect roughly 2-3 minutes before `guide` is even listening; after that,
the docs corpus itself takes further time to index (see Health check).

If port `1337` is taken, override it: `GUIDE_PORT=1338 docker compose
--profile java up --build -d` — the MCP endpoint then becomes
`http://localhost:1338/sse`.

Only `OPENAI_API_KEY` is wired through the compose file's `guide` service
environment block today. If you're using one of the other three providers,
confirm your key actually reaches the container (`docker compose exec guide
env | grep API_KEY`) rather than assuming compose passed it through — the
`.env.example` documents all four, but the container environment mapping in
`compose.yaml` currently only lists `OPENAI_API_KEY`.

## Health check

```bash
curl -i --max-time 3 http://localhost:1337/sse
```

Look for `Content-Type: text/event-stream` and an `event:endpoint` line in
the response — that means the MCP server is up and serving. A connection
refused or timeout means the container isn't listening yet (still building)
or crashed; check `docker compose logs -f guide`.

"Up" is not the same as "fully indexed". A server that answers `/sse` but
has just started can still return thin, low-quality RAG results on the
first few queries while it finishes indexing the documentation corpus
against Neo4j. If early answers look sparse, wait a bit and retry before
concluding something is broken — see Gotchas.

## Registering the MCP server

This server is opt-in, not installed by default, because a dead server
nobody started would otherwise be configured on every machine. Enable it
with:

```bash
npx @simonjamesrowe/agent-setup --with embabel-guide
```

That registers, at user scope, for each detected coding agent:

```
npx mcp-remote http://localhost:1337/sse --transport sse-only
```

`mcp-remote` is a stdio bridge: it's what lets an agent that only speaks
stdio MCP talk to `guide`'s SSE endpoint. Once registered, the tools appear
under whatever prefix `guide.toolPrefix` is set to in the server's own
configuration — by default that prefix is empty, so tools keep their
original names (for example, a documentation vector-search tool shows up
unprefixed rather than namespaced).

## Shutting down

```bash
cd ~/workspace/embabel/guide
docker compose --profile java down --remove-orphans
```

After this, the MCP server registration you added above is still in place —
it will simply fail to connect until `guide` is brought back up. That's the
expected, correct state when you're not actively using it, not a broken
install. Bring it back with the same `docker compose --profile java up
--build -d` from First run.

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
- **Cold Neo4j means thin answers.** The first few queries after a fresh
  `docker compose --profile java up` can return sparse or low-relevance
  results while the graph is still indexing — that's expected, not a sign
  the setup is broken. Recheck after the health check settles.
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
