# Release computers

The repository uses three dedicated test runners:

- `1helm-linux-phase4`
- `1helm-windows-phase4`
- `1helm-macos-phase4`

They hold no personal data. Each release test clears only its exact 1Helm test
target, installs the draft release, checks the reported version, starts the app,
and requires a healthy setup endpoint. Mac additionally requires the signed,
notarized, stapled application to pass Gatekeeper. Windows runs as the ordinary
runner user because WSL distributions are per-user.
