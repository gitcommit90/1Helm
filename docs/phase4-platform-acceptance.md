# Phase 4 cross-platform candidate acceptance

1. Build the ready-to-run online Linux TGZ, complete offline TGZ, and immutable
   digest-addressed channel image on the hosted builder and retain their
   GitHub-hosted provenance attestation.
2. Build the Apple Silicon DMG and updater ZIP on the dedicated Mac runner;
   Developer ID-sign, notarize, staple, and Gatekeeper-check both exact
   payloads. Missing Apple credentials or runner capacity blocks the matrix.
3. Run Linux, macOS, and Windows 11 acceptance concurrently after their exact
   bytes exist. Each job rechecks repository, workflow, push event, main ref,
   candidate SHA, CI run, and candidate run before repository code executes.
4. Retain normalized JSON with exact online/offline artifact SHA-256 and byte
   counts plus channel-image architecture, contract version, and SHA-256, candidate
   and CI run identities, machine/runner identity, check timestamps, state
   digests, and rollback or scoped-uninstall outcome. Windows binds behavior to
   the Linux online/offline pair and shared image contract, and publishes no
   Windows artifact or signing claim.
5. Assemble Phase 3's promotion bundle only after all builds, the private Linux
   dress rehearsal, and all three acceptance records pass. The assembler copies
   retained bytes and cannot build. Missing, failed, skipped, or unavailable
   lanes remain blockers in the retained candidate matrix status.

## One-time dedicated runners

Register repository-scoped runners with `--no-default-labels` and exactly one
label: `1helm-macos-phase4` or `1helm-windows-phase4`. Do not put Proxmox,
Stable, website, production, or broad repository-write credentials on either
machine. The runner account is a dedicated ordinary user with no production
data, no broad `sudo`/administrator membership, and no other workloads.

Install the root-owned `ops/platform-acceptance/runner-job-started.sh` on macOS
or the administrator-owned native PowerShell
`ops/platform-acceptance/runner-job-started.ps1` on Windows as
`ACTIONS_RUNNER_HOOK_JOB_STARTED`. The hook accepts only `gitcommit90/1Helm`, the Candidate dress
rehearsal workflow, its allowlisted job, a successful CI `push` to trusted
`main`, and the exact SHA. Do not set the enabling variables until the label,
hook, account isolation, and prerequisites below have been inspected:

- repository variable `HELM_PHASE4_MACOS_ENABLED=1` enables the Mac build and
  acceptance jobs;
- repository variable `HELM_PHASE4_WINDOWS_ENABLED=1` enables Windows
  acceptance.

Leaving either variable absent is the safe default: the lane is skipped by
GitHub but recorded as **blocked**, and no complete promotion artifact exists.
Registration tokens are one-use and transient; never save one in an image,
shell profile, workflow, or repository file.

### macOS runner and credentials

Use an Apple Silicon Mac retained solely for release acceptance. Install the
repository runner, Node 22, Xcode command-line tools, and the pinned npm
dependencies. In the dedicated account's login keychain install:

- one Developer ID Application certificate/private key;
- `APPLE_TEAM_ID` and optionally `APPLE_SIGN_IDENTITY` as runner service
  environment values;
- an `APPLE_NOTARY_PROFILE` created with `xcrun notarytool store-credentials`.

The workflow intentionally does not use GitHub repository secrets for signing:
the secure credential and private key remain on the retained Mac. Configure the
runner service to unlock only that dedicated user's keychain before a job and
lock it in a job-completed hook; do not store the keychain password in the
repository, runner labels, workflow environment, or shell history. The account's
`~/Library/Application Support/1Helm-OCI-v1` must be absent before every job;
residue is a hard failure. The job validates signature, notarization ticket,
staple, Gatekeeper, exact versions/digests, clean launch/loopback health, updater
ZIP replacement from the latest digest-qualified prior Stable DMG, and
Application Support identity. Signing requirements are never downgraded to
ad-hoc signing.

### Windows 11 runner and reboot resume

Use a dedicated Windows 11 x64 VM/account with no production data. The runner
is non-elevated. The one-time operator proof starts from both WSL optional
features disabled, invokes the tracked installer from an ordinary PowerShell
window, records the single UAC approval, expected restart, and same-user resume,
then stores an administrator-owned, user-readable
`C:\ProgramData\1Helm-Phase4\provisioning-evidence.json`:

```json
{
  "schema": 1,
  "kind": "1helm-windows-runner-provisioning",
  "features_initially_disabled": true,
  "single_uac": true,
  "restart_required": true,
  "same_user_resume": true,
  "keepalive_after_sign_in": true,
  "service_active": true,
  "localhost_health": true,
  "snapshot_baseline": true,
  "dedicated": true,
  "production_data": false
}
```

After that real provisioning exercise, use the scoped uninstaller, confirm the
named product distribution and install root are absent, and capture the clean,
WSL-enabled dedicated-VM snapshot used before every acceptance job. The runner
registration, hook, pinned rootfs, and the administrator-owned provisioning
record remain; 1Helm product state does not.

Also stage the pinned Ubuntu rootfs at
`C:\ProgramData\1Helm-Phase4\ubuntu-noble-wsl-amd64.rootfs.tar.gz`.

The workflow does not claim an in-job Windows reboot: a self-hosted job cannot
honestly survive one. Instead, it records the allowed snapshot-assisted
equivalent. The provisioner restores the accepted clean snapshot before the
job routes; the exact candidate job then stops the same-user limited logon
keepalive, cold-stops only its named WSL distribution, restarts that keepalive,
and requires systemd, localhost health, and retained state to recover. The JSON
record names this mode `snapshot-assisted-equivalent`; it never labels the
exercise as a real reboot. The administrator-owned record separately preserves
the one-time real disabled-features/UAC/restart/same-user-resume proof.

Windows uses the repository's tracked `install.ps1`, `install.sh`, keepalive,
and `uninstall.ps1` with documented local candidate inputs, so it is a private
site-equivalent path without touching the public website. It creates an
unrelated WSL control distribution and proves uninstall retains it. It never
claims Windows artifact creation or signing.

### Retained host provisioning

`ops/platform-acceptance/windows-host/` tracks the bootstrap media for this host:
the answer file, the first-boot driver/guest-agent/OpenSSH setup, and a
reproducible ISO build. Its README records two host constraints that are easy to
get wrong. Proxmox always creates the TPM state volume as raw, and a raw volume
on directory storage blocks snapshots for the entire VM even when every other
disk is qcow2 — so the acceptance host cannot honour "restore the accepted clean
snapshot before routing" unless that small volume sits on snapshot-capable
storage. Verify with `qm snapshot <vmid> probe` before provisioning. Separately,
Windows 11 25H2 (build 26200) does not auto-apply an answer file from secondary
media and ignores `setup.exe /unattend:`; the README documents the offline
`dism /apply-image` path that still runs the specialize, oobeSystem and
auditUser passes.

## Recovery and teardown

First disable the applicable repository variable so new jobs cannot route.
Wait for any active job to finish, archive only the retained JSON and exact
candidate artifacts needed by the owner, then remove the repo runner
registration and stop its service. Remove only the dedicated account/VM after
confirming its identity; never use a wildcard or a shared host.

Mac cleanup quits the test app and removes transient app copies and Application
Support after success; the dedicated Application Support directory is retained
on failure for diagnosis and must be removed before re-enabling the runner. Windows cleanup
uses the scoped product uninstaller for the exact `1helm-phase4` distribution
and separately unregisters only its named unrelated test control. If teardown
is interrupted, leave the runner disabled and inspect both exact names before
retrying. Linux hosted runners are ephemeral; the Phase 2 private runner and
its retained evidence are not teardown targets for Phase 4.

No Phase 4 automation publishes Stable, creates a tag/Release, deploys the
website, or changes production data/services.
