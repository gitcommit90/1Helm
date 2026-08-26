# GitHub-hosted release stages

A release is a set of independently retained proofs for one immutable `version + commit`, not one disposable workflow run.

## Stage contract

1. **Source CI** (`ci.yml`) runs cheap source checks first and retains `source-ci-<commit>` for 90 days.
2. **Linux build** consumes a successful Source CI run ID and retains the package plus `linux-build-evidence.json`.
3. **Mac build and notarize** consumes the same Source CI identity and retains the DMG, updater ZIP, digests, Apple submission IDs/statuses, and `mac-build-evidence.json`.
4. **Artifact acceptance** downloads exact build artifacts by producer run ID. Its `platform` input can run `linux`, `mac`, or `both`, so one failed acceptance lane does not rerun the other and neither lane rebuilds packages.
5. **Assemble candidate** downloads independently successful Linux and Mac acceptance runs, verifies every digest and source identity, creates Stable metadata, retains a candidate bundle, and creates or refreshes a draft GitHub release.
6. **Publish** downloads one successful assembly by run ID, byte-compares it with the draft assets, and only then makes that draft Latest. It builds and signs nothing.
7. **Public verification** checks GitHub Latest, Stable metadata, public routes, and ranged downloads. It builds and signs nothing.

Every downstream stage accepts explicit producer run IDs. This is intentional: a successful expensive stage remains reusable after a later workflow or test fails. Workflow artifacts are retained for 90 days.

## Recovery rule

Rerun only the stage whose proof is absent or invalid. Reuse prior run IDs when their evidence has the same exact version, commit, and artifact digests.

A Mac rebuild is required when the source commit, embedded version, packaging/signing procedure, certificate, or artifact bytes change, or when validation proves the artifact defective. It is not required for failures in Linux/Windows acceptance, candidate assembly, publication, site deployment, or public verification.

## Publication boundary

The Publish workflow publishes GitHub assets and Stable metadata. The current `1helm.com` deployment still has its own infrastructure boundary; Public verification intentionally fails if that endpoint has not been deployed to the same version. Moving that site off ProxUI is separate from—and not hidden inside—the artifact pipeline.
