# Release check

1Helm has one release workflow. It answers only what matters for a fresh user:
do the exact release files install, report the intended version, start, and
answer the setup health endpoint on Linux, Windows through WSL 2, and Apple
Silicon Mac?

Normal pushes run ordinary CI. To release one exact main commit, set the
repository variable `HELM_RELEASE_SHA` to its full SHA and rerun that commit's
successful CI job. The release workflow creates one empty draft, builds and
uploads the Linux archive, builds/signs/notarizes and uploads the Mac files,
and tests those same draft bytes on the three dedicated computers. Only the
final job makes the draft public and marks it Latest.

The workflow deliberately has no prior-version update, rollback, retained-data,
keepalive-identity, candidate manifest, evidence JSON, promotion bundle,
temporary Actions artifact, or aggregate-result gate. Those concerns remain in
the actual product where needed; they are not release qualifications.

If a job fails, inspect that job. Do not add a second result job, automatically
retry it, or turn a failed upload of optional evidence into another failure.
