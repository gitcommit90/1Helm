# Delivery contract for coding agents

## Host instances (read this first — do not confuse them)

This machine runs **more than one** 1Helm install. Ordinary feature work has
exactly one target. Mixing them up is a serious failure.

| Role | Path / service | Port | What agents may do |
|------|----------------|------|--------------------|
| **Local instance (default target)** | `/root/1Helm` source → serve / promote assets into **`/opt/1helm/current`** (`1helm.service`) | **8123** | Edit, build, and put client/server changes here so the owner can try them. This is the install that is “serving correctly” for day-to-day use. |
| **App Review (FORBIDDEN for ordinary work)** | `/opt/1helm-review` (`1helm-review.service`), often `review.1helm.com` | **8140** | **Do not touch.** Do not edit, copy assets into, restart, redeploy, restamp, or “fix” this install unless the owner **explicitly** names App Review / `1helm-review` / port 8140 and asks for that work. |

**Never** treat App Review as the local instance. **Never** “helpfully” sync
`/root/1Helm` builds into `/opt/1helm-review`. If a change is missing in the
browser, verify you are on **8123 / `/opt/1helm`**, not review.

After building client assets in `/root/1Helm` (`npm run build:js`, `build:css`,
`build:stamp`), deliver them to the **local** install only, e.g. install into
`/opt/1helm/current/public/` (and restart only if server code requires it). Leave
`/opt/1helm-review` alone.

## Default: local instance first

This machine's working tree (`/root/1Helm`) is the owner's personal 1Helm source.
The running local app the owner feels is **`/opt/1helm` on port 8123** — not
App Review. Treat that path as the normal place to build and try changes—not a
sterile preview sandbox that must wait for a PR circus before anything is real.

**Default delivery mode is LOCAL.** When the owner opens a session here and asks
for a change:

1. Edit this repository in place (`/root/1Helm`).
2. Keep the change small and focused on what they asked for.
3. Run the narrowest useful checks while iterating so the instance stays
   trustworthy.
4. Deliver the result to the **local** running install (`/opt/1helm`, port
   **8123**) so the owner can use and feel it. **Not** App Review.
5. After the change is polished here, promote **that same work** to public only
   when the owner asks to ship (see below).

Most requests are no-brainer additions and fixes. Do not invent multi-day
process, draft-PR theater, acceptance ledgers, or release machinery for ordinary
local work.

## What local mode means

- Modify the module that owns the behavior. Extract a cohesive seam when that
  keeps ordinary work local. Avoid unrelated refactors.
- Prefer the shortest path from request → working local instance on **8123**.
- Restart or rebuild whatever **`/opt/1helm`** needs so the owner can try the
  change without a scavenger hunt. Do not restart or rewrite App Review.
- Use `npm run architecture:report` when a change risks growing a hotspot; do
  not turn architecture cleanup into a prerequisite for small features.
- Never weaken a check to force a pass.
- Do not broaden scope beyond the request.

## Do not ship publicly by default

Local success is not automatic public release. Unless the owner explicitly asks
to ship, promote, publish, or release, do **not**:

- bump versions or edit release notes for a release;
- create or publish tags, releases, or artifacts;
- deploy the public website or update stable or its release metadata;
- change production data, shared infrastructure, containers, VMs, or services
  beyond this local instance; or
- run the multi-platform public release path.

Public release mechanics remain in
[`docs/GOVERNANCE.md`](docs/GOVERNANCE.md),
[`docs/release-lifecycle.md`](docs/release-lifecycle.md), and host-local
`RELEASE-RUNBOOK.local.md` / `AGENTS.override.md`. Those apply when promoting
polished local work—not as the default for every edit.

## When the owner says ship

Phrases like **ship it**, **release it**, **make it public**, **promote to
stable**, or **push this live** mean: take the polished local work and make it
what the public gets, following the release docs and host-local runbook.

Before that handoff:

- run the full CI contract (`npm run ci`) on the commit being promoted;
- keep user-visible notes accurate under `CHANGELOG.md`;
- record durable product decisions in `docs/VISION.md` when they matter;
- report what changed, what was verified, risks, rollback, and whether stable or
  any external system was touched.

## Handoff (every session)

Briefly name:

- changed files;
- checks run and results;
- how to try it on the local instance (if not obvious);
- known risks and rollback;
- whether anything public, stable, or external was touched (default: no).
