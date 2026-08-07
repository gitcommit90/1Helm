# Release lifecycle

One exact main commit becomes one GitHub draft. Linux builds one complete,
ready-to-run archive. Mac builds one Developer ID signed, notarized, stapled
DMG and its updater ZIP. The dedicated Linux, Windows/WSL 2, and Apple Silicon
Mac sandboxes independently install those exact files and check fresh install,
exact version, startup, and setup endpoint health. If all three succeed, the
maintainer attaches a digest-qualified Stable manifest and publishes that same
draft as Latest.

There is no parallel candidate store, normalized evidence record, update or
rollback test matrix, promotion bundle, retention handoff, or aggregate job.
The retired Candidate dress rehearsal is disabled and is not a release gate.
Ordinary application tests remain separate from publication.
