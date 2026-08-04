# Artifact size and split delivery

Phase 5 separates the large Linux/Windows channel-computer image from ordinary
application releases without relaxing any byte-identity or runtime gate.

## What users download

The normal Linux and Windows/WSL install path downloads
`1Helm-<version>-linux-node.tgz`. That archive is ready to run: it contains the
server, built browser assets, production dependencies, native add-ons, lifecycle
scripts, and an exact channel-image manifest. It does **not** contain the OCI
archive itself.

The installer then resolves the manifest's immutable URL, checks its contract
version and host architecture, downloads the image only when that SHA-256 is not
already retained, verifies byte count and SHA-256, and stores it below
`/var/lib/1helm-oci-v1/shared-images/sha256/<digest>`. A normal application-only
update that references the same digest reuses those bytes. Every retained prior
application release continues to reference its image digest, so rollback does
not depend on a new download.

For a disconnected machine, use
`1Helm-<version>-linux-node-offline.tgz`. It contains the exact same application
tree and the exact image bytes named by its embedded manifest. Copy that one
archive to the machine and pass it to `install.sh`; no channel-image network
fetch is required. Existing v0.0.41-style complete archives remain supported by
the explicit legacy branch.

If the image manifest is absent, malformed, for another architecture, or does
not match the downloaded/embedded bytes, installation stops before the runtime
contract changes. Recovery is to retry online, provide the complete offline
bundle, or reinstall the prior verified complete release. No fallback image is
invented.

## Measured local result

The deterministic v0.0.41 complete Linux artifact baseline is 401,045,903 bytes.
Its embedded sealed OCI archive is 203,846,656 bytes. The Phase 5 local build
produced:

- online Linux application: 149,436,110 bytes;
- complete offline bundle: 350,656,134 bytes;
- shared sealed OCI archive: 203,846,656 bytes;
- packaged production dependencies: 280,851,053 unpacked bytes;
- packaged client assets: 25,497,670 unpacked bytes.

A cold online installation downloads 353,282,766 bytes across the application
and shared image, 47,763,137 bytes (11.91%) less than the v0.0.41 complete
archive. The application artifact itself is 251,609,793 bytes smaller (62.74%);
an application-only update with the unchanged image downloads only that
149,436,110-byte artifact and avoids transferring the 203,846,656-byte image
again. The offline bundle remains complete and is 50,389,769 bytes smaller
(12.56%) than the old archive due to the runtime allowlist and
production-dependency slimming.

Run `npm run artifacts:report` to regenerate the machine-readable JSON and
concise text report. Inputs may be overridden with `--linux-app`,
`--linux-offline`, `--oci`, `--mac-dmg`, `--mac-zip`, `--vendored`, and
`--client`. Missing Mac or Linux outputs are recorded as `missing`, not treated
as zero-byte artifacts. General deterministic baselines and regression ceilings
live in `config/artifact-budgets.json`; reports never record hostnames, machine
identities, or private filesystem paths.

## Packaging and cache auditability

`config/linux-runtime-package.json` is the source allowlist for the Linux
runtime. `npm ci --omit=dev` remains the production dependency authority. The
packager removes only named documentation, test/example/cache directories,
TypeScript declarations, and source maps from the staged production dependency
tree, then requires and fingerprints every native add-on. It does not change the
lockfile or dependencies and never builds on the customer host.

Production dependency cache identity covers the exact lockfile SHA-256, runtime
packaging-manifest SHA-256, Node ABI, Linux architecture, and native builder
image digest. Channel-image cache identity covers architecture, the pinned base
image digest, Containerfile SHA-256, and complete tracked container-context
SHA-256. Candidate manifests state whether each exact cache was reused; the
canonical digest-addressed image manifest stays identical across reused
candidates. Hosted candidate builds use these full keys with no prefix
fallback. A mismatched key or cache manifest is not reusable.

`node scripts/channel-image-gc-report.mjs` reports referenced and unreferenced
digest stores. Phase 5 always emits `action: "retain"` and has no deletion path;
garbage collection is deliberately report-only.
