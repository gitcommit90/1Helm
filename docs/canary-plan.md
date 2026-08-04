# Delivery canary plan

## Phase 0 boundary

Phase 0 creates documentation and read-only visibility only. It does not
create or modify infrastructure, containers, VMs, services, deployment targets,
releases, stable metadata, or production data.

LXC 112 on `pve2` remains unchanged as the legacy **v0.0.38 updater fixture**.
It is evidence for the prior-version update path, not a general-purpose canary.
No experiment, candidate install, reset, or cleanup may repurpose it.

## Phase 2 private dress rehearsal

Phase 2 was separately approved. It creates one fresh, unprivileged LXC with its
own identity, storage, private network address, and lifecycle. It does not share
production data, credentials, release metadata, or the legacy fixture. The
guest ID, address, and hypervisor access stay in local operator configuration,
not this public repository.

After `CI` succeeds for a push to trusted `main`, `Candidate dress rehearsal`
checks out that exact CI SHA on a GitHub-hosted builder. It builds the sealed OCI
image and ready-to-run Linux archive without a version bump or GitHub Release,
embeds source/build identity, emits a digest manifest, signs GitHub artifact
provenance, and retains all evidence as a workflow artifact. Only then does its
deployment job select the uniquely labelled repository runner in the dedicated
guest.

The runner cannot install arbitrary bytes. A fixed root-owned command copies
the fixed inbox files, requires signed provenance from the trusted candidate
workflow on `main`, rejects self-hosted provenance, and requires the outer
manifest, embedded identity, archive digest, source SHA, version, and sealed OCI
digest to agree. It then reuses the immutable release store, service health
check, and automatic rollback in the Linux installer. The status record contains:

- canary role, hypervisor/guest identity, and health endpoint;
- current version and candidate version;
- exact source commit plus artifact name and SHA-256 digest;
- service and application health, check time, result, and any uncertainty;
- CI workflow/run result and candidate build identity;
- install health and time; and
- previous candidate plus rollback result/time.

Unknown metadata must be reported as unknown, never inferred from a nearby
checkout, tag, or responding port.

## Rollback gate

The dedicated guest starts from a documented clean baseline. Each accepted
candidate becomes an immutable, digest-named release directory. Before changing
the current symlink or host contract, the existing Linux transaction snapshots
the prior current release, runtime files, units, and unit state. A failed or
uncertain service/API health check restores that exact prior contract and proves
the restored service healthy. The candidate evidence records both failure and
rollback outcome. This is application rollback inside the dedicated guest; no
Proxmox snapshot, Stable change, or LXC 112 action is part of the automation.
