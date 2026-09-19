---
name: langfuse-verify
description: Verify Langfuse LLM trace plumbing for simonrowe.dev end to end. Use when checking whether chat/agent calls produce traces, or after observability changes.
---

# Verify Langfuse traces

Identify the target environment first. Read `docker-compose.yml` or
`docker-compose.prod.yml`, the matching Alloy config, backend observation config
and `scripts/verify-langfuse-trace.sh` in that checkout.

Both local and production now run Langfuse v3. Local Alloy receives host-backend
OTLP on port 4317 and forwards to local Langfuse on port 3000. Its config is
`config/alloy/config.local.alloy`; production uses `config/alloy/config.alloy`.
Local tracing is supported. Local Alloy deliberately does not ship logs to Loki.

## Verify

1. Start the local stack with `local-env`, or inspect production health using
   `prod-triage`. Check Langfuse, worker, Postgres, ClickHouse, Redis, MinIO and
   Alloy. A reachable UI alone does not prove trace ingestion.
2. Load `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` from env without printing
   them. Use keys belonging to the target project. For UI access, reuse the
   Google/Auth0 browser session and verify the admin role/project membership.
3. Send one on-topic chat message in that same environment; record its time and
   session. Use `chat-e2e-verify` if the chat surface itself needs checking.
4. Run the verification script with an explicit host. The default is production,
   so leaving it unset during a local check can produce a false pass:

   ```bash
   LANGFUSE_HOST=http://localhost:3000 scripts/verify-langfuse-trace.sh --since-minutes 5
   # Or, for a production check:
   LANGFUSE_HOST=https://langfuse.simonrowe.dev scripts/verify-langfuse-trace.sh --since-minutes 5
   ```

5. Inspect the new trace and match the generated turn. When checking session
   grouping or captured text, use the script's `--expect-session` / `--expect-io`
   options and verify the UI result. A pre-existing trace only proves past ingest.

## Diagnose missing traces

Check in this order: target host/project → containers → Alloy export errors →
backend exporter endpoint → project-key alignment → Alloy filter → ingest delay.
Wait about a minute before concluding ingest failed. Use `prod-logs` for production
or bounded compose logs locally.

The filter keeps Spring AI attributes and `langfuse.trace.name` for parent chat
turns. Ordinary HTTP/database spans are intentionally excluded. Preserve the
Micrometer-to-OpenTelemetry bridge when changing dependencies.

Content capture is controlled by `LANGFUSE_CONTENT_CAPTURE_ENABLED`; the current
runbook records it enabled, reversing the old disabled policy. Inspect effective
configuration before expecting prompt/completion text, and keep captured visitor
content out of diagnostic output. A missing cost with token usage present can
mean the model price is unconfigured rather than failed tracing.

Read `docs/runbooks/langfuse-observability.md` for bootstrap and failure details,
checking its historical notes against the current code. Report target host,
trace/session evidence and any unverified part of the pipeline.
