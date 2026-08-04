# Private Linux dress rehearsal

This Phase 2 environment installs Linux candidates automatically after the
existing `CI` workflow succeeds for a push to trusted `main`. It is private
acceptance infrastructure, not Stable, a public release, or a promotion gate.
The workflow is inert until this code reaches `main` and the uniquely labelled
repository runner is online.

## Trust and installation path

1. The hosted `build` job checks out the exact SHA from the successful `CI`
   `workflow_run`, re-verifies repository, push event, branch, conclusion, and
   checkout SHA, then builds the sealed OCI image and ready-to-run Linux archive.
2. `resources/candidate-build.json` inside the archive and `candidate.json`
   outside it record the same repository, `refs/heads/main`, full commit,
   package version, source state, CI run, build identity, archive SHA-256, and
   sealed OCI SHA-256. Candidates reuse the package version and do not create a
   semantic version, tag, GitHub Release, or public updater entry.
3. GitHub signs artifact provenance on the hosted builder. The self-hosted job
   only downloads that workflow artifact and writes three fixed inbox files.
4. `sudo -n /usr/local/sbin/1helm-candidate-install` (with no arguments) is the only delegated root
   command. The helper accepts no arguments, copies the inbox to a root-only
   transaction directory, validates paths/digests/identities, verifies signed
   provenance for `.github/workflows/candidate.yml` on `main`, and rejects
   attestations from self-hosted builders.

Initial local provisioning proof uses a one-use, mode-0600, root-owned marker
inside the guest so unpublished worktree bytes can exercise the same boundary
without claiming signed GitHub provenance. The helper consumes that marker
before validation; the runner cannot write its directory. Normal automation
has no bypass flag or marker.

Rollback acceptance may use a separately labelled `rollback-fixture` archive
with an embedded controlled startup fault. That source state is accepted only
while the same one-use root marker is present. It cannot pass normal trusted-main
validation or signed workflow provenance, and status must keep the prior healthy
candidate as running after the failed attempt.
5. The helper calls the archive's digest-pinned Linux installer. Existing
   release directories remain immutable; the existing host transaction owns
   runtime/unit changes, service restart, API health, and known-good rollback.

The runner service account has no Proxmox, Stable, production, website, or
release credentials and is not a member of privileged container/runtime groups.
Its root-owned `runner-job-started.sh` start hook rejects every repository,
workflow, job, and event except the
Phase 2 deployment job resulting from successful `CI` for `main`. Ordinary PR
workflows do not carry the unique runner label. The runner is registered with
`--no-default-labels`, so generic `self-hosted`, OS, or architecture selectors
cannot schedule it either.

The long-lived runner has a read-only system filesystem. Its one sudo command
delegates the same fixed, argument-free helper to a transient root systemd unit;
the app installation never runs as part of an arbitrary workflow shell and the
runner retains no general root command or writable host filesystem.

The guest is LAN-private: the application listens on its private guest address,
and no public tunnel, DNS name, forwarding rule, or public ingress is created.
Restrict operator access with the surrounding private LAN/Tailscale and Proxmox
firewall policy; the repository intentionally contains no address or host ID.

## Status

The guest keeps current evidence at
`/var/lib/1helm-candidate/evidence/status.json`. It reports the running candidate
commit/digest/version/build identity, successful CI run, install health/time,
previous candidate, and rollback result/time. Historical attempts are retained
root-only beside it; detailed install logs are root-only under
`/var/log/1helm-candidate`.

Integrate this read-only evidence with Phase 0 without tracking private
coordinates:

```bash
HELM_STATUS_CANDIDATE_URL=http://PRIVATE_GUEST_ADDRESS:8123 \
HELM_STATUS_CANDIDATE_HOST=LOCAL_PROXMOX_SSH_ALIAS \
HELM_STATUS_CANDIDATE_ID=LOCAL_GUEST_ID \
npm run delivery:status
```

Configure all three values locally. The command uses the fixed `pct exec ...
cat /var/lib/1helm-candidate/evidence/status.json` operation; it does not accept
an arbitrary remote command or write anything.

## Teardown and rollback

Do not use these steps as part of normal candidate rollback. Failed installs
already restore the previous healthy candidate in-guest. To disable future
automation while preserving evidence, remove the unique runner label or stop
the runner service in the dedicated guest through the Proxmox console.

For final decommissioning, first verify no candidate job is active, remove the
repository runner registration in GitHub, and archive the root-owned evidence
needed by the owner. Then stop and destroy **only the locally recorded Phase 2
guest ID**, after separately resolving its name and confirming it is the
dedicated dress-rehearsal guest. Never use a range, wildcard, name-only lookup,
the legacy fixture ID, or another existing guest. Removing the guest deletes
its candidates, private app data, runner, logs, and evidence; it does not affect
Stable or the public website. No teardown was performed during Phase 2 delivery.
