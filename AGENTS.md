# Delivery contract for coding agents

The default delivery mode in this repository is **PREVIEW ONLY**. Implement and
verify a small, explicitly requested change, then report it for review.

Unless the owner explicitly requests a stable promotion, do not:

- bump versions or edit release notes for a release;
- create or publish tags, releases, or artifacts;
- deploy the public website or update stable or its release metadata;
- change production data, infrastructure, containers, VMs, or services; or
- broaden the requested scope.

Keep changes focused. Run the narrowest relevant tests while iterating, then run
the full CI contract (`npm run ci`) before merge. Never weaken a check to make a
change pass.

Modify the module that owns the behavior; extract a cohesive seam when that
keeps ordinary work local. Avoid unrelated refactors, and pause before a change
spreads across several domains. Use `npm run architecture:report` to spot legacy
hotspots and ratchet a budget down after making one smaller.

Every handoff must briefly name changed files, checks run and their results,
known risks, rollback steps, and whether stable or any external system was
touched.

Maintainer policy and release mechanics remain authoritative in
[`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) and
[`docs/release-lifecycle.md`](docs/release-lifecycle.md). This file adds the
agent default; it does not replace those documents.
