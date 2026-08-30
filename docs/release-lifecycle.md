# Release lifecycle

One exact product commit moves through seven independently triggered,
GitHub-hosted stages: Source CI; Linux build; Mac signing/notarization; artifact
acceptance; candidate assembly; publication; and public verification. Every
transition consumes an explicit successful producer run ID and retained evidence
bound to the version, product commit, artifact digests, and workflow provenance.

Product identity and pipeline identity are separate. A docs, acceptance,
assembly, publication, or verification repair may advance `main` without
invalidating a retained candidate that was previously admitted to `main`.
Downstream stages accept an exact 40-character product commit that is an ancestor
of current `main`; they do not require it to remain the tip. Rebuild a platform
artifact only when product, packaging, signing inputs, bytes, or evidence changed.

Linux produces the complete ready-to-run archive. The hosted Mac stage produces
the Developer ID signed, Apple-notarized, stapled DMG and updater ZIP. Hosted
acceptance verifies the exact retained bytes and source identity. Windows has no
separate artifact because it consumes the Linux archive; assembly records hosted
Windows evidence or an explicit hosted-run waiver until a dedicated hosted lane
exists.

Captain-owned LXC, VM, WSL, Mac, the live 1Helm installation, and `1helm.com` are
not release gates and must not be accessed as an implicit fallback. Hardware
validation or deployment happens only when the Captain explicitly requests that
separate work.
