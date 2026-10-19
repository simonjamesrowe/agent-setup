---
name: honeycomb-verify
description: Verify deployed Honeycomb traces through Playwright MCP and record evidence. Use when checking Honeycomb after deployment, changing the telemetry pipeline, or diagnosing missing spans.
---

# Verify Honeycomb after deployment

Read the target checkout's `docs/runbooks/honeycomb-observability.md` and deployed
Alloy configuration. Follow `prod-deploy` for release checks and `prod-triage` for
Pi access; this check does not deploy or restart services. Use **Playwright MCP**
for the Honeycomb UI, reusing the existing Google session. Honeycomb MCP can
supplement queries but does not replace the requested browser verification.

## Establish the target

1. Record the intended release SHA, running-release evidence, UTC start time,
   backend origin, Honeycomb team, region and environment. Production requires
   production evidence; local synthetic traces in `test` cannot satisfy this gate.
2. Inspect effective enablement, sampling percentage and capture deadline without
   printing keys or whole container environments. Confirm the ingest key belongs
   to the intended environment through its metadata, never by displaying it.
   Expected disabled/expired export is `NOT RUN`; unexpectedly disabled export
   is `FAIL`. Do not enable export, extend expiry or change sampling merely to
   obtain a pass outside the authorized deployment/capture scope.
3. In Honeycomb, confirm the selected team/environment and Free plan. Record
   current account usage and the capture's budget/deadline. Follow the runbook's
   stop threshold; sampling is not a hard monthly cap. Never accept an upgrade.

## Generate and find fresh evidence

1. Use Playwright's request context for a harmless public backend GET, normally
   `/api/blogs`. Generate a unique W3C trace ID and parent span ID; send
   `traceparent: 00-<32 lowercase hex>-<16 lowercase hex>-01`. Record IDs, UTC
   time, route and HTTP status, not response bodies or authentication headers.
   Example inside the Playwright MCP code runner:

   ```javascript
   async (page) => {
     const { traceId, parentId } = await page.evaluate(() => ({
       traceId: crypto.randomUUID().replaceAll('-', ''),
       parentId: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
     }));
     const started = new Date().toISOString();
     const response = await page.request.get('https://api.simonrowe.dev/api/blogs', {
       headers: { traceparent: `00-${traceId}-${parentId}-01` },
       maxRedirects: 0, timeout: 15000,
     });
     const status = response.status();
     await response.dispose();
     return { traceId, parentId, started, status };
   }
   ```

   Substitute the confirmed backend origin for non-production checks. This is an
   HTTP backend probe, not proof of browser SDK instrumentation. The supplied
   remote parent has no exported span; do not call that expected absence broken.
2. Through the Honeycomb UI, query the recorded time window and service, then
   filter on the exact trace ID. Inspect the current dataset's trace-ID field
   instead of assuming its spelling. Allow up to two minutes for ingest, polling
   at bounded intervals. Do not accept an unrelated recent trace as the probe.
3. At less than 100% sampling the collector can drop a trace even with `01`.
   If needed, generate at most 30 probes total, at least one second apart, with
   distinct IDs. Stop on the first verified trace. At 10%, all 30 can still be
   dropped (about 4% probability): no result is `INCONCLUSIVE` unless exporter
   errors or other direct evidence establishes failure. A brief authorized 100%
   capture removes this sampling uncertainty; never silently change the policy.
   If the authorized capture changes sampling, restore the prior configuration
   on success or failure and preserve the original absolute deadline.
   At 100%, missing traces after the bounded wait are `FAIL` and need diagnosis.

## Inspect the trace and sibling pipeline

- Match the exact trace ID, fresh timestamp, backend service, environment,
  route template, method, successful response status and plausible duration.
  Verify the server span's parent ID equals the probe's supplied parent ID.
  Check route-derived `app.module` and `SampleRate` against effective sampling.
- Open span details in the UI. Compare attributes, names, events and status text
  with the deployed allowlist. Honeycomb-generated metadata is separate from
  exported attributes. Record field names only if unexpected sensitive content
  appears; do not copy that content into screenshots, logs or reports.
- For a pipeline change, also run `langfuse-verify` against the same environment
  with one harmless portfolio chat turn. Find that turn's trace in Honeycomb and
  inspect an actual parent/child pair: shared trace ID and child `parent_id`
  matching the parent's span ID. Preserve Langfuse's existing content policy.
  A sampled-out chat is `INCONCLUSIVE` for this subcheck; do not repeatedly call
  the model to overcome sampling. Use an authorized brief 100% capture when
  both-pipeline evidence is required. A single HTTP span cannot pass parent/child
  verification. The pilot deliberately excludes linked spans; record that limit.
- Inspect bounded Alloy export errors and accepted/sent/failed counters via the
  production runbook. Compare usage before/after capture. A healthy container,
  successful OAuth grant or old trace is insufficient. At expiry, check the gate
  configuration and counters, allowing queued/in-flight exports; absence of a
  sampled trace alone does not prove the expiry gate works.

## Record the result

Save `.context/honeycomb-verification-<UTC timestamp>.md` with target SHA and
running-release evidence, environment, probe time/IDs/status, trace URL, checked
fields, sampling/deadline/usage, parent-child and Langfuse results where required,
limitations, and a sanitized Playwright screenshot under `.context/`.
Do not assume `service.version` is a Git SHA; report release attribution separately
when the deployed instrumentation does not provide it.

Use `PASS` only when every required subcheck has fresh matching evidence. Use
`FAIL` for observed wrong fields, leaks, broken parentage or export failures;
`INCONCLUSIVE` for sampling/access/missing evidence; `NOT RUN` for intentionally
off capture. Include per-subcheck results; an incomplete pipeline-change check
cannot be reported as an overall pass. If an automated caller wraps this skill,
exit non-zero for `FAIL` or `INCONCLUSIVE`, and keep `NOT RUN` distinct from pass.
Link evidence in the deployment report and state what still needs verification.
