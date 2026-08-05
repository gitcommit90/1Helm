# Retained Windows acceptance-host provisioning

These files build the bootstrap ISO for the dedicated Windows 11 Phase 4
acceptance host described in `docs/phase4-platform-acceptance.md`. They were
previously carried only as a pre-built ISO on the hypervisor, so a rebuild could
not be reviewed or reproduced. They are tracked here for that reason.

Nothing here publishes a release, creates a tag, deploys the website, or touches
production data or services.

## What it does

`Autounattend.xml` partitions the disk (GPT, EFI + MSR + NTFS), installs the Pro
image, sets the computer name and UTC timezone, then reseals into **audit mode**
and runs `setup.ps1` during the `auditUser` pass.

`setup.ps1` installs the VirtIO network and serial drivers plus the QEMU guest
agent, enables OpenSSH Server pinned to the operator's public key (supplied at build
time, see below) with password authentication off, disables sleep and hibernate, and records
`C:\1HelmAcceptance\ready.json`. It is idempotent: an existing `ready.json`
makes it exit 0 immediately.

## Build

```sh
./build-unattend-iso.sh 1helm-windows-unattend.iso /path/to/operator_key.pub
```

The operator public key is **not** committed: this repository is public, and
publishing which key is authorized as Administrator on the acceptance host is
needless disclosure. Pass it at build time (or via
`HELM_ACCEPTANCE_AUTHORIZED_KEY`); the build stages it as `authorized_key.pub`
on the ISO and `setup.ps1` refuses to continue without it. `.gitignore` keeps a
local copy out of git.

Two constraints are load-bearing:

- `-iso-level 4` — at genisoimage's default level the ISO9660 namespace
  truncates `Autounattend.xml` to `AUTOUNAT.XML`, which Windows Setup does not
  recognize as an answer file.
- Volume label `ONEHELM` — the `auditUser` pass locates `setup.ps1` with
  `Get-Volume -FileSystemLabel ONEHELM`.

## Host VM shape

The acceptance workflow restores an accepted clean snapshot before every job, so
the VM must actually be able to snapshot. Proxmox always creates the **TPM state
volume as raw**, and a raw volume on directory storage blocks snapshots for the
whole VM even when every other disk is qcow2. Place the disks as qcow2 and put
the small `tpmstate0` volume on snapshot-capable storage (thin-LVM), which keeps
TPM 2.0 and Secure Boot intact so no Windows 11 requirement bypass is needed.

Verify before installing anything:

```sh
qm snapshot <vmid> probe && qm delsnapshot <vmid> probe
```

## Windows 11 25H2 answer-file caveat

On build 26200 (25H2) the new setup engine (`setuphost.exe`) does **not**
auto-apply `Autounattend.xml` from a secondary disc, and `setup.exe /unattend:`
is ignored. The answer file is readable from WinPE — it simply is not consumed,
so setup falls through to the interactive product-key page.

Working alternative on affected media: from the WinPE shell (Shift+F10),
partition with `diskpart`, apply the image with
`dism /apply-image /imagefile:<media>:\sources\install.wim /index:6 /applydir:W:\`,
copy `Autounattend.xml` to `W:\Windows\Panther\unattend.xml`, then
`bcdboot W:\Windows /s S: /f UEFI`. First boot still runs `specialize`,
`oobeSystem` and `auditUser`, so the computer name, audit reseal and
`setup.ps1` all still apply.

Note that WinPE on this media has no `curl`, no `taskkill`, and no configured
network, so stage anything you need on the bootstrap ISO itself.
