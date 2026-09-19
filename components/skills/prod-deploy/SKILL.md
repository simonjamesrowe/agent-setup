---
name: prod-deploy
description: Deploy simonrowe.dev to production: merge, watch the Publish workflow, restart on the Pi, smoke-test. Use when shipping merged changes to prod or checking whether prod runs the latest build.
---

# Deploy and verify production

Read the target checkout's `docs/runbooks/deploy.md` and
`docs/runbooks/software-factory-manual-actions.md`. Normal deployment is now
Publish → software-factory webhook → Temporal deploy workflow → deployer on the
Pi. The backend no longer has a Docker socket or `/data-operations/redeploy`.

## Verify the normal deployment

1. If a PR still needs review or merge disposition, use `pr-review-loop`.
2. Identify the intended merge SHA and its **Publish** workflow run. Watch that
   run, not merely the newest run, which may belong to another commit.
3. Inspect the matching deploy in **Admin → Software Factory** or Temporal.
   Wait for verification to finish. Publish success proves image availability,
   not that the Pi runs it. A maintenance page can be expected mid-deploy;
   rollback failure or a stuck maintenance page needs `prod-triage`.
4. Use [Raspberry Pi Connect](../prod-triage/references/raspberry-pi-connect.md)
   for host checks. Read the deploy record and check the running images and
   checkout against the target SHA. Distinguish container image IDs from registry
   manifest digests; do not compare those different identifier types directly.
5. Check `https://www.simonrowe.dev` and a real API route such as
   `https://api.simonrowe.dev/api/blogs`, then the changed feature in a browser.
   The bare domain's redirect and the frontend GET `/mcp` SPA route do not prove
   backend health. Actuator is on an internal management port, not the public API.

## Manual recovery or redeploy

Use the admin workflow's guarded redeploy action for the running release, or the
current host script when the task requires host recovery. Inspect ongoing deploys
first; do not start a second deployment over one already running.

```bash
cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo
./scripts/status-prod.sh
```

For an authorized manual deploy, read `scripts/restart-prod.sh` and the deploy
runbook before running it. The bare script does not synchronize the checkout;
config changes need an intentional checkout update as well as an image update.
Inspect nginx/upstream health before a restart. Current nginx uses runtime DNS;
older deployments may still have static upstream resolution.

The **deployer does not recreate itself**. After changes to `software-factory/`
or `Dockerfile.software-factory`, follow the runbook's separate deployer update
once it is idle. Pinning an image in env can also prevent a service advancing.

Report the intended SHA, Publish result, deploy result, running-release evidence
and smoke-test result. Do not mark a deploy successful solely from a completed
image build or an accepted admin request.
