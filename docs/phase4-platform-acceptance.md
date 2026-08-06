# The three dress-rehearsal computers

The exact machine addresses and operator access stay in host-local instructions,
not in this public repository. The repository knows only the dedicated runner
labels:

- `1helm-linux-phase4` — the disposable Linux systemd host;
- `1helm-windows-phase4` — the dedicated Windows 11 VM and ordinary WSL user;
- `1helm-macos-phase4` — the dedicated non-admin Apple Silicon account.

Each runner must be dedicated to 1Helm testing and contain no production or
personal data. The Mac and Windows job-start hooks allow only the trusted
`Candidate dress rehearsal` workflow resulting from successful CI on `main`.
The Linux runner service runs as root because its entire purpose is testing the
root-owned Linux installer and systemd service inside the disposable test LXC.

The acceptance contract is intentionally literal:

1. install current public Stable;
2. update to the exact candidate bytes;
3. start and answer the local setup endpoint;
4. preserve a byte-identical durable data marker;
5. recover from a cold start;
6. uninstall only 1Helm and leave unrelated state alone.

Mac also requires a valid Developer ID signature, Apple notarization ticket,
stapling, and Gatekeeper acceptance. Windows has no separate artifact; it tests
the same Linux build through WSL 2 and proves that the limited-user keepalive
recovers it. The one-time Windows WSL feature/UAC/restart provisioning record is
machine setup, not a per-release result.

If a platform script exits successfully, that platform passed. If it exits
nonzero or its runner is offline, the rehearsal fails. No post-processing step
can turn either answer into something else.

Cleanup is scoped to the exact 1Helm test names. Never unregister another WSL
distribution, remove another Mac user's app, or point the Linux lane at a
non-test computer.
