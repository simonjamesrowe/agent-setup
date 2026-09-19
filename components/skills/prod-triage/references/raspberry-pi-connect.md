# Raspberry Pi Connect access

Use this for Pi host commands in `prod-triage`, `prod-logs`, `prod-deploy` and
`code-review-triage`. Direct SSH is unavailable; Connect provides a browser shell.

1. Open `https://connect.raspberrypi.com` with Playwright MCP. Reuse the signed-in
   profile. Otherwise choose **Sign in with Raspberry Pi ID**. Proposed env names
   for unattended login are `RPI_CONNECT_EMAIL` and `RPI_CONNECT_PASSWORD`, in
   the gitignored workspace `.env` or `~/workspace/simonjamesrowe/env`.
   These are Raspberry Pi ID credentials, separate from Google/Auth0.
2. If credentials are configured, load them without printing them and fill only
   the Raspberry Pi ID form. Use tooling that can consume the secret without
   including its value in tool output. Inspect controls before filling; never
   snapshot populated credential fields. Let Simon handle MFA/passkey challenges.
3. Under **Devices**, select `simon-rowe-dev-server` (or the explicitly configured
   production device). Check **Online** and **Remote shell access is allowed**.
4. Choose **Connect via → Remote shell**. Select the newly opened tab. Focus
   **Terminal input**, type the command through keyboard input and press Enter.
   Do not use `fill()` for a terminal emulator: keystrokes must reach the shell.
5. Establish the host and checkout before running the task's commands:

   ```bash
   hostname && uname -m && cd ~/workspace/simonjamesrowe/simonrowe-dev-monorepo && git rev-parse --short HEAD
   docker compose -f docker-compose.prod.yml ps --format '{{.Service}} {{.State}} {{.Health}}'
   ```

6. Read the rendered terminal output after the command finishes. A typed command
   or a connected terminal alone does not prove execution. Keep commands bounded
   (for example `logs --since 30m --tail 200`) and use read-only checks for an audit.
   Carry out repairs/deployments only within the user's authorized task.

If the device is offline, shell access is disabled, credentials are absent, or
interactive verification blocks access, name that specific blocker. Only then
fall back to a single copy-paste block for Simon to run and return its output.
An expired login needs reauthentication, not a new account or a reinstall.

Verified 2026-09-19: browser remote shell returned hostname, ARM64 architecture,
checkout SHA and compose health for the production device. Env-based unattended
login was not tested; Simon completed sign-in in the browser during the audit.

See [Raspberry Pi's Connect documentation](https://www.raspberrypi.com/documentation/services/connect.html)
for device enrollment and enabling shell access when the device is not yet set up.
